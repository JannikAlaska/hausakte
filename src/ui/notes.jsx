// General notes that belong to no project: typed or dictated, editable, deletable. The AI assistant can manage them too.
import { Icon } from './icons.jsx';
import { Btn, IconBtn, TextInput, DateInput, ConfirmBtn, Pill } from './common.jsx';
import { toast, openDrawer } from './state.js';
import { useAiAvailable } from './ai-ui.jsx';
import { prepareNote, usePreparing } from '../notesai.js';
import { useDictation, SpeechRec } from './meetings.jsx';
import { addNote, updateNote, deleteNote } from '../actions.js';
import { fmtDate, fmtDateShort, todayISO, isISO } from '../util.js';

const { useState, useEffect } = React;

export function NotesPanel({ data }) {
  const [composer, setComposer] = useState(false);
  const [q, setQ] = useState('');
  const all = Object.values(data.notes || {}).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  const s = q.trim().toLowerCase();
  const list = s ? all.filter((n) => `${n.title} ${n.text}`.toLowerCase().includes(s)) : all;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {composer ? (
        <NoteComposer onClose={() => setComposer(false)} />
      ) : (
        <div className="meet-intro">
          <div>
            <b>Allgemeine Notizen</b>
            <p className="small muted">Für alles, was zu keinem Projekt gehört – Ideen, Telefonnummern, Beobachtungen am Haus. Auch per Sprache oder über den KI-Assistenten („Notiere: …“).</p>
          </div>
          <Btn kind="primary" icon="plus" onClick={() => setComposer(true)}>
            Neue Notiz
          </Btn>
        </div>
      )}
      {all.length > 4 ? (
        <div className="search-inline">
          <Icon name="search" size={15} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Notizen durchsuchen" aria-label="Notizen durchsuchen" />
        </div>
      ) : null}
      {list.map((n) => (
        <NoteCard key={n.id} n={n} data={data} />
      ))}
      {!all.length && !composer ? <p className="small muted">Noch keine Notizen.</p> : null}
      {all.length && !list.length ? <p className="small muted">Keine Notiz passt zur Suche.</p> : null}
    </div>
  );
}

// autoStart: the cockpit's "Notiz sprechen" starts dictation right away
export function NoteComposer({ onClose, autoStart }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const dict = useDictation(() => toast('Das Mikrofon ist für diese Seite nicht freigegeben – tippe die Notiz ein.', 'warn', 6000));
  const avail = useAiAvailable();
  useEffect(() => {
    if (autoStart && SpeechRec) dict.start('');
    return () => dict.stop();
  }, []);
  const save = () => {
    const t = dict.text.trim();
    if (!t && !title.trim()) return;
    dict.stop();
    const spoken = dict.secs > 0;
    const id = addNote({ title, text: t, date, source: spoken ? 'sprache' : 'manuell' });
    // spoken notes are prepared by the AI right away (in the background, the note is already saved)
    if (spoken && t.length >= 10 && avail !== false) {
      toast('Notiz gespeichert – die KI bereitet sie auf …');
      prepareNote(id);
    } else toast('Notiz gespeichert');
    onClose();
  };
  return (
    <div className="panel meet-rec">
      <div className="spread">
        <h3>Neue Notiz</h3>
        <IconBtn icon="x" label="Abbrechen" onClick={() => { dict.stop(); onClose(); }} />
      </div>
      <div className="grid2">
        <TextInput id="note-new-title" value={title} onChange={setTitle} placeholder="Titel (optional)" />
        <DateInput value={date} onChange={(v) => setDate(v || todayISO())} />
      </div>
      <div className="rec-row">
        <button type="button" className={`rec-btn ${dict.on ? 'is-on' : ''}`} onClick={() => (dict.on ? dict.stop() : !dict.start(dict.text) && toast('Spracheingabe kann dieser Browser nicht – tippe die Notiz ein.', 'warn'))} aria-label={dict.on ? 'Aufnahme beenden' : 'Notiz einsprechen'}>
          <Icon name={dict.on ? 'stop' : 'mic'} size={22} />
        </button>
        <div className="small muted">{dict.on ? 'Ich schreibe mit …' : SpeechRec ? 'Antippen und sprechen – oder unten tippen.' : 'Tippe die Notiz unten ein.'}</div>
      </div>
      <textarea className="input meet-text" rows={5} value={dict.text} readOnly={dict.on} onChange={(e) => dict.setText(e.target.value)} placeholder="Notiz …" />
      <div className="hstack">
        <Btn kind="primary" icon="check" onClick={save} disabled={!dict.text.trim() && !title.trim()}>
          Speichern
        </Btn>
      </div>
    </div>
  );
}

function NoteCard({ n, data }) {
  const [edit, setEdit] = useState(false);
  const preparing = usePreparing()('note:' + n.id);
  const avail = useAiAvailable();
  const ai = n.ai;
  return (
    <article className={`dsec note-card ${ai?.isMeeting ? 'is-meeting' : ''}`}>
      <header className="meet-head">
        <span className="meet-date">
          <b>{isISO(n.date) ? fmtDate(n.date).slice(0, 6) : '–'}</b>
          <small>{isISO(n.date) ? n.date.slice(0, 4) : ''}</small>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {edit ? <TextInput id={'note-title-' + n.id} value={n.title} onChange={(v) => updateNote(n.id, { title: v, titleManual: true })} /> : <h3>{n.title || 'Notiz'}</h3>}
          <div className="note-pills">
            {n.source === 'ki' ? <Pill tone="info" icon="sparkles">über KI</Pill> : n.source === 'sprache' ? <Pill icon="mic">gesprochen</Pill> : null}
            {ai ? <Pill tone="accent" icon="sparkles">aufbereitet</Pill> : null}
            {ai?.isMeeting ? <Pill tone="warn" icon="calendar">Termin</Pill> : null}
          </div>
        </div>
        <IconBtn icon={edit ? 'check' : 'edit'} label={edit ? 'Fertig' : 'Bearbeiten'} size={16} onClick={() => setEdit(!edit)} />
      </header>
      {preparing ? (
        <div className="ai-pending" role="status">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          Die KI bereitet die Notiz auf …
        </div>
      ) : null}
      {edit ? (
        <>
          <DateInput value={n.date} onChange={(v) => v && updateNote(n.id, { date: v })} />
          <span className="field-label">{ai ? 'Originaltext (gesprochen)' : 'Text'}</span>
          <TextInput multiline rows={6} value={n.text} onChange={(v) => updateNote(n.id, { text: v })} />
          <div className="hstack" style={{ flexWrap: 'wrap' }}>
            {avail !== false ? (
              <Btn small kind="ai" icon="sparkles" disabled={preparing || !String(n.text || '').trim()} onClick={() => { setEdit(false); prepareNote(n.id); }}>
                {ai ? 'Neu aufbereiten' : 'Mit KI aufbereiten'}
              </Btn>
            ) : null}
            <ConfirmBtn confirmText="Notiz wirklich löschen?" onConfirm={() => { deleteNote(n.id); toast('Notiz gelöscht'); }}>
              Notiz löschen
            </ConfirmBtn>
          </div>
        </>
      ) : ai ? (
        <NoteAi n={n} ai={ai} data={data} />
      ) : n.text ? (
        <p className="note-text">{n.text}</p>
      ) : null}
      {!edit && !ai && !preparing && avail !== false && String(n.text || '').trim().length >= 10 ? (
        <div>
          <Btn small kind="ai" icon="sparkles" onClick={() => prepareNote(n.id)}>
            Mit KI aufbereiten
          </Btn>
        </div>
      ) : null}
    </article>
  );
}

// what the AI made of the note: appointment (which, when, who, decisions), clean text, open points
function NoteAi({ n, ai, data }) {
  const m = ai.meeting;
  const contacts = (m?.contactIds || []).filter((id) => data?.contacts?.[id]);
  const project = ai.projectId ? data?.projects?.[ai.projectId] : null;
  return (
    <>
      {ai.isMeeting && m ? (
        <div className="note-meeting">
          <div className="nm-what">
            <Icon name="calendar" size={16} />
            <b>{m.what || 'Termin'}</b>
          </div>
          <dl className="nm-facts">
            <dt>Wann</dt>
            <dd>{m.date ? `${fmtDateShort(m.date)}${m.date.slice(0, 4)}${m.time ? `, ${m.time} Uhr` : ''}` : 'nicht genannt'}</dd>
            <dt>Dabei</dt>
            <dd>{m.participants.length ? m.participants.join(', ') : 'nicht genannt'}</dd>
          </dl>
          {contacts.length ? (
            <div className="chips">
              {contacts.map((id) => (
                <button key={id} type="button" className="chip" onClick={() => openDrawer({ type: 'contact', id })}>
                  <Icon name="tag" size={12} /> {data.contacts[id].company || data.contacts[id].name}
                </button>
              ))}
            </div>
          ) : null}
          <span className="field-label">Beschlossen</span>
          {m.decisions.length ? (
            <ul className="nm-list">
              {m.decisions.map((x, i) => (
                <li key={i}>
                  <Icon name="check" size={13} />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Keine Beschlüsse genannt.</p>
          )}
        </div>
      ) : null}
      <RichText text={ai.text || n.text} />
      {ai.openQuestions?.length ? (
        <div className="meet-block">
          <span className="field-label">Offene Fragen</span>
          <ul>
            {ai.openQuestions.map((x, i) => (
              <li key={i}>
                <Icon name="info" size={13} />
                <span>{x}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {ai.nextSteps?.length ? (
        <div className="meet-block">
          <span className="field-label">Nächste Schritte</span>
          <ul>
            {ai.nextSteps.map((x, i) => (
              <li key={i}>
                <Icon name="checkCircle" size={13} />
                <span>
                  {x.text}
                  {x.who ? <Pill>{x.who}</Pill> : null}
                  {x.date ? <b> · {fmtDate(x.date)}</b> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {project ? (
        <div className="chips">
          <button type="button" className="chip" onClick={() => openDrawer({ type: 'project', id: project.id })}>
            <Icon name="tasks" size={12} /> Projekt: {project.title}
          </button>
        </div>
      ) : null}
      {n.text && ai.text ? (
        <details className="small meet-transcript">
          <summary>Gesprochener Originaltext</summary>
          <p>{n.text}</p>
        </details>
      ) : null}
    </>
  );
}

// paragraphs, lines starting with "- " become a list
export function RichText({ text }) {
  const blocks = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) {
      blocks.push(null);
      continue;
    }
    const item = /^[-•*]\s+/.test(line);
    const last = blocks[blocks.length - 1];
    if (item) {
      if (last?.type === 'ul') last.items.push(line.replace(/^[-•*]\s+/, ''));
      else blocks.push({ type: 'ul', items: [line.replace(/^[-•*]\s+/, '')] });
    } else if (last?.type === 'p') last.lines.push(line);
    else blocks.push({ type: 'p', lines: [line] });
  }
  return (
    <div className="rich-text">
      {blocks.filter(Boolean).map((b, i) =>
        b.type === 'ul' ? (
          <ul key={i}>
            {b.items.map((x, k) => (
              <li key={k}>{x}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.lines.join(' ')}</p>
        ),
      )}
    </div>
  );
}
