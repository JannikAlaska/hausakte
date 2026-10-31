// General notes that belong to no project: typed or dictated, editable, deletable. The AI assistant can manage them too.
import { Icon } from './icons.jsx';
import { Btn, IconBtn, TextInput, DateInput, ConfirmBtn, Pill } from './common.jsx';
import { toast } from './state.js';
import { useDictation, SpeechRec } from './meetings.jsx';
import { addNote, updateNote, deleteNote } from '../actions.js';
import { fmtDate, todayISO, isISO } from '../util.js';

const { useState } = React;

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
        <NoteCard key={n.id} n={n} />
      ))}
      {!all.length && !composer ? <p className="small muted">Noch keine Notizen.</p> : null}
      {all.length && !list.length ? <p className="small muted">Keine Notiz passt zur Suche.</p> : null}
    </div>
  );
}

function NoteComposer({ onClose }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const dict = useDictation(() => toast('Das Mikrofon ist für diese Seite nicht freigegeben – tippe die Notiz ein.', 'warn', 6000));
  const save = () => {
    const t = dict.text.trim();
    if (!t && !title.trim()) return;
    dict.stop();
    addNote({ title, text: t, date, source: dict.secs > 0 ? 'sprache' : 'manuell' });
    toast('Notiz gespeichert');
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

function NoteCard({ n }) {
  const [edit, setEdit] = useState(false);
  return (
    <article className="dsec note-card">
      <header className="meet-head">
        <span className="meet-date">
          <b>{isISO(n.date) ? fmtDate(n.date).slice(0, 6) : '–'}</b>
          <small>{isISO(n.date) ? n.date.slice(0, 4) : ''}</small>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {edit ? <TextInput id={'note-title-' + n.id} value={n.title} onChange={(v) => updateNote(n.id, { title: v })} /> : <h3>{n.title || 'Notiz'}</h3>}
          {n.source === 'ki' ? <Pill tone="info" icon="sparkles">über KI</Pill> : n.source === 'sprache' ? <Pill icon="mic">gesprochen</Pill> : null}
        </div>
        <IconBtn icon={edit ? 'check' : 'edit'} label={edit ? 'Fertig' : 'Bearbeiten'} size={16} onClick={() => setEdit(!edit)} />
      </header>
      {edit ? (
        <>
          <DateInput value={n.date} onChange={(v) => v && updateNote(n.id, { date: v })} />
          <TextInput multiline rows={6} value={n.text} onChange={(v) => updateNote(n.id, { text: v })} />
          <div>
            <ConfirmBtn confirmText="Notiz wirklich löschen?" onConfirm={() => { deleteNote(n.id); toast('Notiz gelöscht'); }}>
              Notiz löschen
            </ConfirmBtn>
          </div>
        </>
      ) : n.text ? (
        <p className="note-text">{n.text}</p>
      ) : null}
    </article>
  );
}
