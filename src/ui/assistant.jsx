import { Icon } from './icons.jsx';
import { Btn, IconBtn, Drawer } from './common.jsx';
import { Md, useAiAvailable, AiUnavailable } from './ai-ui.jsx';
import { closeDrawer, openDrawer, toast } from './state.js';
import { aiChat, aiErrorText, isHardAiError, AI_DISCLAIMER } from '../ai.js';
import { createProject, addFunding, addCost, addConstraint, addMilestone } from '../actions.js';
import { getState } from '../store.js';
import { PROJECT_KINDS, CONSTRAINT_KINDS, FUNDING_TYPES } from '../catalog.js';
import { isISO } from '../util.js';

const { useState, useRef, useEffect } = React;

const SUGGESTIONS = [
  'Was muss ich nach dem Hauskauf gesetzlich nachrüsten – und bis wann?',
  'In welcher Reihenfolge sollte ich mein Haus sanieren?',
  'Lohnt sich eine PV-Anlage auf meinem Dach?',
  'Welche Förderung bekomme ich für eine Wärmepumpe?',
  'Was kostet eine Fassadendämmung bei meinem Haus ungefähr?',
];

let memory = []; // survives closing the drawer within this visit

function makeTools(log) {
  const projectExists = (id) => !!getState().projects[String(id)];
  return [
    {
      name: 'create_project',
      description: 'Legt ein neues Modernisierungsprojekt an. Gibt die neue Projekt-ID zurück.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: PROJECT_KINDS.map((k) => k.key) },
          start: { type: 'string', description: 'YYYY-MM-DD' },
          end: { type: 'string', description: 'YYYY-MM-DD' },
          priority: { type: 'number', description: '1 hoch, 2 mittel, 3 niedrig' },
          notes: { type: 'string' },
        },
        required: ['title', 'kind'],
      },
      execute(input) {
        const id = createProject({
          title: String(input.title || 'Neues Projekt').slice(0, 120),
          kind: String(input.kind || 'sonstiges'),
          start: isISO(input.start) ? input.start : undefined,
          end: isISO(input.end) ? input.end : undefined,
          priority: [1, 2, 3].includes(Number(input.priority)) ? Number(input.priority) : 2,
          notes: String(input.notes || '').slice(0, 2000),
        });
        log({ kind: 'project', id, text: `Projekt angelegt: ${input.title}` });
        return { id, title: input.title };
      },
    },
    {
      name: 'add_funding',
      description: 'Erfasst ein Förderprogramm an einem bestehenden Projekt (projectId aus den Hausdaten oder aus create_project).',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          program: { type: 'string' },
          provider: { type: 'string' },
          type: { type: 'string', enum: FUNDING_TYPES.map((t) => t.key) },
          rate: { type: 'number', description: 'Fördersatz in Prozent' },
          amount: { type: 'number', description: 'geschätzter Betrag in Euro' },
          deadline: { type: 'string', description: 'Antrag bis YYYY-MM-DD' },
          notes: { type: 'string' },
        },
        required: ['projectId', 'program'],
      },
      execute(input) {
        if (!projectExists(input.projectId)) throw new Error('Unbekannte projectId');
        addFunding(String(input.projectId), { ...input, program: String(input.program), deadline: isISO(input.deadline) ? input.deadline : null, source: 'ki', status: 'pruefen' });
        log({ kind: 'project', id: input.projectId, text: `Förderung erfasst: ${input.program}` });
        return 'ok';
      },
    },
    {
      name: 'add_cost_item',
      description: 'Fügt einem Projekt eine geschätzte Kostenposition hinzu.',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, label: { type: 'string' }, estimate: { type: 'number' } }, required: ['projectId', 'label', 'estimate'] },
      execute(input) {
        if (!projectExists(input.projectId)) throw new Error('Unbekannte projectId');
        addCost(String(input.projectId), { label: String(input.label), estimate: Number(input.estimate) || null });
        log({ kind: 'project', id: input.projectId, text: `Kostenposition: ${input.label}` });
        return 'ok';
      },
    },
    {
      name: 'add_constraint',
      description: 'Fügt einem Projekt eine Rahmenbedingung oder Aufgabe hinzu (z. B. Genehmigung, Pflicht, Witterung).',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, text: { type: 'string' }, kind: { type: 'string', enum: CONSTRAINT_KINDS.map((k) => k.key) } }, required: ['projectId', 'text'] },
      execute(input) {
        if (!projectExists(input.projectId)) throw new Error('Unbekannte projectId');
        addConstraint(String(input.projectId), String(input.text), String(input.kind || 'organisatorisch'));
        log({ kind: 'project', id: input.projectId, text: `Rahmenbedingung: ${input.text}` });
        return 'ok';
      },
    },
    {
      name: 'add_milestone',
      description: 'Fügt einem Projekt einen Termin oder Meilenstein hinzu.',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, title: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['projectId', 'title'] },
      execute(input) {
        if (!projectExists(input.projectId)) throw new Error('Unbekannte projectId');
        addMilestone(String(input.projectId), String(input.title), isISO(input.date) ? input.date : null);
        log({ kind: 'project', id: input.projectId, text: `Meilenstein: ${input.title}` });
        return 'ok';
      },
    },
  ];
}

export function AssistantDrawer({ data }) {
  const avail = useAiAvailable();
  const [msgs, setMsgs] = useState(memory);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hard, setHard] = useState(false);
  const ctl = useRef(null);
  const end = useRef(null);
  useEffect(() => {
    memory = msgs;
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs]);
  useEffect(() => () => ctl.current?.abort(), []);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    const history = [...msgs.filter((m) => m.role !== 'tool'), { role: 'user', content: q }];
    const aiIdx = msgs.length + 1;
    setMsgs((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '', pending: true }]);
    setBusy(true);
    const c = new AbortController();
    ctl.current = c;
    const toolLog = [];
    const log = (entry) => {
      toolLog.push(entry);
      setMsgs((m) => {
        const copy = [...m];
        copy.splice(copy.length - 1, 0, { role: 'tool', ...entry });
        return copy;
      });
    };
    try {
      const turns = history.map((m) => ({ role: m.role, content: m.content })).filter((m) => m.content);
      const { text: answer } = await aiChat(turns, getState(), {
        signal: c.signal,
        tools: makeTools(log),
        onText: ({ text: t }) => setMsgs((m) => m.map((x, i) => (i === m.length - 1 && x.pending ? { ...x, content: t } : x))),
      });
      setMsgs((m) => m.map((x, i) => (i === m.length - 1 && x.pending ? { role: 'assistant', content: answer } : x)));
    } catch (e) {
      if (isHardAiError(e)) setHard(true);
      setMsgs((m) =>
        m.map((x, i) =>
          i === m.length - 1 && x.pending ? { role: 'assistant', content: (e.text ? e.text + '\n\n' : '') + (e.code === 'cancelled' ? '_Abgebrochen._' : aiErrorText(e)), error: e.code !== 'cancelled' } : x,
        ),
      );
    } finally {
      setBusy(false);
      void aiIdx;
    }
  };

  return (
    <Drawer
      eyebrow="KI-Assistent"
      title="Frag deine Hausakte"
      icon="sparkles"
      onClose={closeDrawer}
      subtitle="Kennt dein Haus, deine Bauteile, Verbräuche und Projekte"
      footer={
        avail === false || hard ? (
          <AiUnavailable />
        ) : (
          <div className="chat-input" style={{ flex: 1 }}>
            <textarea
              id="chat-input"
              className="input"
              rows={2}
              placeholder="z. B. Welche Förderung gibt es für neue Fenster?"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {busy ? <IconBtn icon="stop" label="Stoppen" onClick={() => ctl.current?.abort()} /> : <IconBtn icon="send" label="Senden" onClick={() => send()} />}
          </div>
        )
      }
    >
      <div className="chat">
        {!msgs.length ? (
          <>
            <div className="msg msg-ai">
              <p>Hallo! Ich kenne die Daten deiner Hausakte und helfe dir bei Förderung, Reihenfolge, Kosten und Pflichten rund um die Modernisierung.</p>
              <p>Ich kann auch Projekte, Förderungen, Kostenpositionen und Termine für dich anlegen.</p>
            </div>
            <div className="suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)} disabled={avail === false}>
                  {s}
                </button>
              ))}
            </div>
          </>
        ) : null}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="msg msg-user">
              {m.content}
            </div>
          ) : m.role === 'tool' ? (
            <button key={i} className="msg-tool" onClick={() => m.id && openDrawer({ type: 'project', id: m.id })} style={{ border: 0 }}>
              <Icon name="check" size={13} /> {m.text}
            </button>
          ) : (
            <div key={i} className="msg msg-ai" style={m.error ? { borderColor: 'var(--danger)' } : undefined}>
              {m.pending && !m.content ? (
                <span className="ai-thinking">
                  <span className="dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  denkt nach …
                </span>
              ) : (
                <Md text={m.content} />
              )}
            </div>
          ),
        )}
        {msgs.length ? (
          <div className="ai-note">
            <Icon name="info" size={13} />
            <span>{AI_DISCLAIMER}</span>
          </div>
        ) : null}
        {msgs.length && !busy ? (
          <div>
            <Btn small kind="ghost" icon="trash" onClick={() => setMsgs([])}>
              Unterhaltung leeren
            </Btn>
          </div>
        ) : null}
        <div ref={end} />
      </div>
    </Drawer>
  );
}
