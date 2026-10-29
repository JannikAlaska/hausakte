import { Icon } from './icons.jsx';
import { Btn, IconBtn, Drawer } from './common.jsx';
import { Md, useAiAvailable, AiUnavailable } from './ai-ui.jsx';
import { closeDrawer, openDrawer, toast } from './state.js';
import { aiChat, aiErrorText, isHardAiError, AI_DISCLAIMER } from '../ai.js';
import { createProject, patchProject, addFunding, addCost, addConstraint, addMilestone, deleteMilestone } from '../actions.js';
import { resolveRef, createsCycle, msRef } from '../metrics.js';
import { getState } from '../store.js';
import { PROJECT_KINDS, CONSTRAINT_KINDS, FUNDING_TYPES, FUNDING_STATUS, STATUS, status as statusOf } from '../catalog.js';
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

const ITEM_LISTS = { milestone: 'milestones', cost: 'costs', constraint: 'constraints', funding: 'funding' };
const ITEM_NAMES = { milestone: 'Meilenstein', cost: 'Kostenposition', constraint: 'Rahmenbedingung', funding: 'Förderung' };
const num = (v) => (v === null ? null : Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v, n = 2000) => String(v ?? '').slice(0, n);

export function makeTools(log) {
  const getProject = (id) => {
    const p = getState().projects[String(id)];
    if (!p) throw new Error('Unbekannte projectId');
    return p;
  };
  // validates dependency references (project id or "projectId#milestoneId") for `self`
  const checkRefs = (refs, self) => {
    const projects = getState().projects;
    const all = Object.values(projects);
    const out = [];
    for (const r of refs || []) {
      const ref = String(r);
      const d = resolveRef(projects, ref);
      if (!d) throw new Error(`Unbekannte Abhängigkeit ${ref}`);
      if (ref === self) throw new Error('Ein Eintrag kann nicht von sich selbst abhängen');
      if (createsCycle(all, self, ref)) throw new Error(`Abhängigkeit ${ref} würde eine Schleife erzeugen`);
      if (!out.includes(ref)) out.push(ref);
    }
    return out;
  };
  const nextDeps = (cur, input, self) => {
    let next = Array.isArray(input.dependsOn) ? checkRefs(input.dependsOn, self) : [...(cur || [])];
    if (Array.isArray(input.addDependsOn)) next = [...new Set([...next, ...checkRefs(input.addDependsOn, self)])];
    if (Array.isArray(input.removeDependsOn)) next = next.filter((r) => !input.removeDependsOn.map(String).includes(r));
    return next;
  };
  const depProps = {
    dependsOn: { type: 'array', items: { type: 'string' }, description: 'Ersetzt die Abhängigkeiten: Projekt-IDs (nach Projektende) oder "Projekt-ID#Meilenstein-ID"' },
    addDependsOn: { type: 'array', items: { type: 'string' }, description: 'Fügt Abhängigkeiten hinzu' },
    removeDependsOn: { type: 'array', items: { type: 'string' }, description: 'Entfernt Abhängigkeiten' },
  };
  return [
    {
      name: 'get_project',
      description: 'Liefert ein Projekt mit allen Details und den IDs seiner Meilensteine, Kostenpositionen, Rahmenbedingungen und Förderungen. Vor dem Ändern einzelner Positionen aufrufen.',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
      execute(input) {
        const p = getProject(input.projectId);
        return {
          id: p.id, title: p.title, kind: p.kind, status: p.status, priority: p.priority, start: p.start, end: p.end, notes: p.notes || '', hints: p.hints || '', dependsOn: p.dependsOn || [],
          milestones: (p.milestones || []).map((m) => ({ id: m.id, ref: msRef(p.id, m.id), title: m.title, date: m.date, done: !!m.done, dependsOn: m.dependsOn || [] })),
          costs: (p.costs || []).map((k) => ({ id: k.id, label: k.label, estimate: k.estimate, offer: k.offer, actual: k.actual, vendor: k.vendor || '' })),
          constraints: (p.constraints || []).map((c) => ({ id: c.id, text: c.text, kind: c.kind, done: !!c.done })),
          funding: (p.funding || []).map((f) => ({ id: f.id, program: f.program, provider: f.provider, type: f.type, status: f.status, rate: f.rate, amount: f.amount, deadline: f.deadline })),
        };
      },
    },
    {
      name: 'update_project',
      description: 'Ändert ein bestehendes Projekt. Nur übergebene Felder werden geändert.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          title: { type: 'string' },
          kind: { type: 'string', enum: PROJECT_KINDS.map((k) => k.key) },
          status: { type: 'string', enum: STATUS.map((k) => k.key) },
          priority: { type: 'number', description: '1 hoch, 2 mittel, 3 niedrig' },
          start: { type: 'string', description: 'YYYY-MM-DD' },
          end: { type: 'string', description: 'YYYY-MM-DD' },
          notes: { type: 'string', description: 'ersetzt die Notizen' },
          hints: { type: 'string', description: 'ersetzt die Hinweise (Abhängigkeiten, Fristen, Besonderheiten)' },
          appendHints: { type: 'string', description: 'hängt einen Hinweis an die bestehenden an' },
          ...depProps,
        },
        required: ['projectId'],
      },
      execute(input) {
        const p = getProject(input.projectId);
        const patch = {};
        const changed = [];
        if (input.title) (patch.title = str(input.title, 120)), changed.push('Titel');
        if (PROJECT_KINDS.some((k) => k.key === input.kind)) (patch.kind = input.kind), changed.push('Art');
        if (STATUS.some((k) => k.key === input.status)) (patch.status = input.status), changed.push(`Status ${statusOf(input.status).name}`);
        if ([1, 2, 3].includes(Number(input.priority))) (patch.priority = Number(input.priority)), changed.push('Priorität');
        if (isISO(input.start)) (patch.start = input.start), changed.push('Start');
        if (isISO(input.end)) (patch.end = input.end), changed.push('Ende');
        if ((patch.end || p.end) && (patch.start || p.start) && (patch.end || p.end) < (patch.start || p.start)) throw new Error('Ende liegt vor dem Start');
        if (typeof input.notes === 'string') (patch.notes = str(input.notes)), changed.push('Notizen');
        if (typeof input.hints === 'string') (patch.hints = str(input.hints)), changed.push('Hinweise');
        if (input.appendHints) (patch.hints = [(patch.hints ?? p.hints ?? '').trim(), str(input.appendHints, 600)].filter(Boolean).join('\n')), changed.push('Hinweise');
        if (input.dependsOn || input.addDependsOn || input.removeDependsOn) (patch.dependsOn = nextDeps(p.dependsOn, input, p.id)), changed.push('Abhängigkeiten');
        if (!changed.length) return 'Keine gültigen Änderungen übergeben';
        patchProject(p.id, (x) => ({ ...x, ...patch }));
        log({ kind: 'project', id: p.id, text: `${p.title}: ${[...new Set(changed)].join(', ')} geändert` });
        return { ok: true, changed };
      },
    },
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
          hints: { type: 'string', description: 'Hinweise zu Abhängigkeiten, Fristen, Besonderheiten' },
          dependsOn: depProps.dependsOn,
        },
        required: ['title', 'kind'],
      },
      execute(input) {
        const deps = checkRefs(input.dependsOn || [], '__new__');
        const id = createProject({
          title: str(input.title || 'Neues Projekt', 120),
          kind: String(input.kind || 'sonstiges'),
          start: isISO(input.start) ? input.start : undefined,
          end: isISO(input.end) ? input.end : undefined,
          priority: [1, 2, 3].includes(Number(input.priority)) ? Number(input.priority) : 2,
          notes: str(input.notes),
          hints: str(input.hints),
          dependsOn: deps,
        });
        log({ kind: 'project', id, text: `Projekt angelegt: ${input.title}` });
        return { id, title: input.title };
      },
    },
    {
      name: 'add_milestone',
      description: 'Fügt einem Projekt einen Termin oder Meilenstein hinzu. Gibt die Meilenstein-Referenz zurück.',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, title: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, dependsOn: depProps.dependsOn }, required: ['projectId', 'title'] },
      execute(input) {
        const p = getProject(input.projectId);
        const deps = checkRefs(input.dependsOn || [], '__new__');
        const mid = addMilestone(p.id, str(input.title, 160), isISO(input.date) ? input.date : null, deps);
        log({ kind: 'project', id: p.id, text: `Meilenstein: ${input.title}` });
        return { ref: msRef(p.id, mid), id: mid };
      },
    },
    {
      name: 'update_item',
      description: 'Ändert einen Meilenstein, eine Kostenposition, Rahmenbedingung oder Förderung eines Projekts (IDs aus get_project). Nur übergebene Felder werden geändert.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          type: { type: 'string', enum: Object.keys(ITEM_LISTS) },
          itemId: { type: 'string' },
          title: { type: 'string', description: 'Meilenstein' },
          date: { type: 'string', description: 'Meilenstein: YYYY-MM-DD' },
          done: { type: 'boolean', description: 'Meilenstein oder Rahmenbedingung erledigt' },
          label: { type: 'string', description: 'Kostenposition' },
          estimate: { type: 'number', description: 'Kostenposition: Schätzung in €' },
          offer: { type: 'number', description: 'Kostenposition: Angebot in €' },
          actual: { type: 'number', description: 'Kostenposition: Ist-Kosten in €' },
          text: { type: 'string', description: 'Rahmenbedingung' },
          program: { type: 'string', description: 'Förderung' },
          status: { type: 'string', enum: FUNDING_STATUS.map((x) => x.key), description: 'Förderung' },
          amount: { type: 'number', description: 'Förderung: Betrag in €' },
          rate: { type: 'number', description: 'Förderung: Satz in %' },
          deadline: { type: 'string', description: 'Förderung: Antrag bis YYYY-MM-DD' },
          ...depProps,
        },
        required: ['projectId', 'type', 'itemId'],
      },
      execute(input) {
        const p = getProject(input.projectId);
        const key = ITEM_LISTS[input.type];
        if (!key) throw new Error('Unbekannter type');
        const item = (p[key] || []).find((x) => x.id === String(input.itemId));
        if (!item) throw new Error(`Unbekannte itemId für ${input.type}`);
        const allowed = { milestone: ['title', 'date', 'done'], cost: ['label', 'estimate', 'offer', 'actual'], constraint: ['text', 'done'], funding: ['program', 'status', 'amount', 'rate', 'deadline'] }[input.type];
        const patch = {};
        for (const f of allowed) {
          if (!(f in input)) continue;
          const v = input[f];
          if (f === 'date' || f === 'deadline') patch[f] = isISO(v) ? v : null;
          else if (f === 'done') patch[f] = !!v;
          else if (['estimate', 'offer', 'actual', 'amount', 'rate'].includes(f)) { if (num(v) !== undefined) patch[f] = num(v); }
          else if (f === 'status') { if (FUNDING_STATUS.some((x) => x.key === v)) patch[f] = v; }
          else patch[f] = str(v, 300);
        }
        if (input.type === 'milestone' && (input.dependsOn || input.addDependsOn || input.removeDependsOn)) patch.dependsOn = nextDeps(item.dependsOn, input, msRef(p.id, item.id));
        if (!Object.keys(patch).length) return 'Keine gültigen Änderungen übergeben';
        patchProject(p.id, (x) => ({ ...x, [key]: (x[key] || []).map((y) => (y.id === item.id ? { ...y, ...patch } : y)) }));
        log({ kind: 'project', id: p.id, text: `${ITEM_NAMES[input.type]} geändert: ${item.title || item.label || item.text || item.program}` });
        return 'ok';
      },
    },
    {
      name: 'delete_item',
      description: 'Löscht einen Meilenstein, eine Kostenposition, Rahmenbedingung oder Förderung eines Projekts (IDs aus get_project).',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, type: { type: 'string', enum: Object.keys(ITEM_LISTS) }, itemId: { type: 'string' } }, required: ['projectId', 'type', 'itemId'] },
      execute(input) {
        const p = getProject(input.projectId);
        const key = ITEM_LISTS[input.type];
        const item = key && (p[key] || []).find((x) => x.id === String(input.itemId));
        if (!item) throw new Error(`Unbekannte itemId für ${input.type}`);
        if (input.type === 'milestone') deleteMilestone(p.id, item.id);
        else patchProject(p.id, (x) => ({ ...x, [key]: (x[key] || []).filter((y) => y.id !== item.id) }));
        log({ kind: 'project', id: p.id, text: `${ITEM_NAMES[input.type]} gelöscht: ${item.title || item.label || item.text || item.program}` });
        return 'ok';
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
        const p = getProject(input.projectId);
        addFunding(p.id, { ...input, program: String(input.program), deadline: isISO(input.deadline) ? input.deadline : null, source: 'ki', status: 'pruefen' });
        log({ kind: 'project', id: p.id, text: `Förderung erfasst: ${input.program}` });
        return 'ok';
      },
    },
    {
      name: 'add_cost_item',
      description: 'Fügt einem Projekt eine geschätzte Kostenposition hinzu.',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, label: { type: 'string' }, estimate: { type: 'number' } }, required: ['projectId', 'label', 'estimate'] },
      execute(input) {
        const p = getProject(input.projectId);
        addCost(p.id, { label: String(input.label), estimate: Number(input.estimate) || null });
        log({ kind: 'project', id: p.id, text: `Kostenposition: ${input.label}` });
        return 'ok';
      },
    },
    {
      name: 'add_constraint',
      description: 'Fügt einem Projekt eine Rahmenbedingung oder Aufgabe hinzu (z. B. Genehmigung, Pflicht, Witterung).',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, text: { type: 'string' }, kind: { type: 'string', enum: CONSTRAINT_KINDS.map((k) => k.key) } }, required: ['projectId', 'text'] },
      execute(input) {
        const p = getProject(input.projectId);
        addConstraint(p.id, String(input.text), String(input.kind || 'organisatorisch'));
        log({ kind: 'project', id: p.id, text: `Rahmenbedingung: ${input.text}` });
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
              <p>Ich kann auch Projekte, Förderungen, Kostenpositionen und Termine für dich anlegen und bestehende Projekte ändern – z. B. Termine verschieben, Status setzen, Hinweise ergänzen oder Abhängigkeiten festlegen.</p>
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
