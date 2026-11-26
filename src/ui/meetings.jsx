// Meeting notes per project: record a voice memo (live speech-to-text), let the AI write the note
// and add the appointments as milestones and the to-dos as tasks.
import { Icon } from './icons.jsx';
import { Btn, IconBtn, Field, TextInput, DateInput, Pill, ConfirmBtn, Select } from './common.jsx';
import { uploadFiles, fileAllowed, removeDocument, Lightbox, FILE_ACCEPT, NOT_ALLOWED } from './documents.jsx';
import { useAiAvailable } from './ai-ui.jsx';
import { toast, openDrawer } from './state.js';
import { updateDoc, fileUrl } from '../store.js';
import { addMeeting, addCost, patchProject } from '../actions.js';
import { prepareMeeting, usePreparing, isReading, transcribeMeeting, deleteInkDoc } from '../notesai.js';
import { InkEditor, InkPreview, createInkMeeting, updateInkMeeting } from './ink.jsx';
import { fmtDate, fmtDateShort, fmtEuro, todayISO, isISO } from '../util.js';

const { useState, useEffect, useRef } = React;

export const SpeechRec = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Continuous German dictation. Browsers end recognition after pauses, so it restarts until stopped.
export function useDictation(onError) {
  const [text, setText] = useState('');
  const [on, setOn] = useState(false);
  const [secs, setSecs] = useState(0);
  const keep = useRef(false);
  const rec = useRef(null);
  const done = useRef('');
  const lock = useRef(null);
  const fails = useRef(0); // failed rounds in a row without any recognized text
  useEffect(() => {
    if (!on) return;
    const t0 = Date.now() - secs * 1000;
    const id = setInterval(() => setSecs((Date.now() - t0) / 1000), 500);
    return () => clearInterval(id);
  }, [on]);
  const finish = () => {
    setOn(false);
    lock.current?.release?.().catch(() => {});
    lock.current = null;
  };
  const giveUp = (code) => {
    keep.current = false;
    onError?.(code);
  };
  // next round after the recognizer ended (after every pause on phones); waits a little longer after failures
  const restart = () =>
    setTimeout(() => {
      if (!keep.current) return finish();
      try {
        run();
      } catch {
        if (++fails.current < 8) restart();
        else giveUp('audio-capture'), finish();
      }
    }, 150 + Math.min(fails.current, 6) * 350);
  const run = () => {
    const r = new SpeechRec();
    r.lang = 'de-DE';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      fails.current = 0;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) done.current = (done.current + ' ' + t).replace(/\s+/g, ' ').trim();
        else interim += t;
      }
      setText((done.current + ' ' + interim).trim());
    };
    r.onerror = (e) => {
      if (['not-allowed', 'service-not-allowed'].includes(e.error)) return giveUp(e.error);
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      // a busy microphone ("audio-capture") or a network hiccup often clears on the next round
      if (++fails.current >= 4 && e.error === 'audio-capture') giveUp(e.error);
    };
    r.onend = () => (keep.current ? restart() : finish());
    rec.current = r;
    r.start();
  };
  const start = (base = '') => {
    if (!SpeechRec) return false;
    fails.current = 0;
    done.current = base.trim();
    setText(done.current);
    keep.current = true;
    try {
      run();
    } catch {
      keep.current = false;
      return false;
    }
    setOn(true);
    // keep the phone screen on, recognition stops when it locks
    navigator.wakeLock?.request?.('screen').then((l) => (lock.current = l)).catch(() => {});
    return true;
  };
  const stop = () => {
    keep.current = false;
    rec.current?.stop();
  };
  // ends at once and drops what was not final yet (for "discard")
  const cancel = () => {
    keep.current = false;
    rec.current?.abort();
  };
  useEffect(() => () => {
    keep.current = false;
    rec.current?.abort();
    lock.current?.release?.().catch(() => {});
  }, []);
  return { text, setText, on, secs, start, stop, cancel, reset: () => (setText(''), setSecs(0), (done.current = '')) };
}

export function Meetings({ p, data }) {
  const [open, setOpen] = useState(false);
  const list = [...(p.meetings || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  return (
    <div className="stack" style={{ gap: 12 }}>
      {open ? (
        <Recorder p={p} data={data} onClose={() => setOpen(false)} />
      ) : (
        <div className="meet-intro">
          <div>
            <b>Besprechung festhalten</b>
            <p className="small muted">Sprich nach dem Termin kurz ein oder schreib mit dem Apple Pencil, was besprochen wurde. Die KI schreibt daraus eine Notiz und trägt Termine und To-dos ins Projekt ein.</p>
          </div>
          <Btn kind="primary" icon="mic" onClick={() => setOpen(true)}>
            Neue Besprechung
          </Btn>
        </div>
      )}
      {list.length ? list.map((m) => <MeetingCard key={m.id} m={m} p={p} data={data} />) : !open ? <p className="small muted">Noch keine Besprechungen.</p> : null}
    </div>
  );
}

function Recorder({ p, data, onClose }) {
  const avail = useAiAvailable();
  const [date, setDate] = useState(todayISO());
  const [ink, setInk] = useState(false);
  // files picked before saving; they are stored with the meeting once it exists
  const [files, setFiles] = useState([]);
  const dict = useDictation((code) =>
    toast(code === 'audio-capture' ? 'Kein Mikrofon gefunden.' : 'Das Mikrofon ist für diese Seite nicht freigegeben. Erlaube den Zugriff in den Browser-Einstellungen – in der Vorschau in claude.ai geht es nicht.', 'warn', 7000),
  );
  const toggle = () => {
    if (dict.on) return dict.stop();
    if (!dict.start(dict.text)) toast('Spracheingabe kann dieser Browser nicht – tippe die Notiz ein oder nutze das Diktier-Mikrofon deiner Tastatur.', 'warn', 6000);
  };
  // the note is saved at once; the AI prepares it in the background (title, appointment, decisions, dates, to-dos)
  const save = (withAi) => {
    const t = dict.text.trim();
    if (!t) return;
    if (withAi && t.length < 10) return toast('Die Notiz ist noch zu kurz.', 'warn');
    dict.stop();
    const res = addMeeting(p.id, { title: 'Besprechung', summary: '', date }, { transcript: t, date, source: dict.secs > 0 ? 'sprache' : 'manuell', extra: withAi ? {} : { aiSkip: true } });
    if (withAi) {
      toast('Gespeichert – die KI bereitet die Besprechung auf …');
      prepareMeeting(p.id, res.id, { derive: true });
    } else toast('Notiz gespeichert');
    if (files.length) attachToMeeting(files, p.id, res.id);
    onClose();
  };
  return (
    <div className="panel meet-rec">
      <div className="spread">
        <h3>Neue Besprechung</h3>
        <IconBtn icon="x" label="Abbrechen" onClick={() => { dict.stop(); onClose(); }} />
      </div>
      <Field label="Datum des Termins">
        <DateInput value={date} onChange={(v) => setDate(v || todayISO())} />
      </Field>
      <div className="rec-row">
        <button type="button" className={`rec-btn ${dict.on ? 'is-on' : ''}`} onClick={toggle} aria-label={dict.on ? 'Aufnahme beenden' : 'Aufnahme starten'}>
          <Icon name={dict.on ? 'stop' : 'mic'} size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <b>{dict.on ? `Aufnahme läuft · ${mmss(dict.secs)}` : dict.text ? 'Aufnahme pausiert' : 'Tippe zum Aufnehmen'}</b>
          <div className="small muted">{dict.on ? 'Sprich frei – wer war da, was wurde besprochen, welche Termine und nächsten Schritte.' : SpeechRec ? 'Erneut tippen setzt die Aufnahme fort.' : 'Spracheingabe gibt es hier nicht – tippe die Notiz unten ein.'}</div>
        </div>
      </div>
      <div className="hstack meet-hand">
        <Btn icon="pen" onClick={() => { dict.stop(); setInk(true); }}>
          Stattdessen handschriftlich
        </Btn>
        <span className="small muted">mit dem Apple Pencil – die KI wandelt die Schrift in Text um</span>
      </div>
      {ink ? (
        <InkEditor
          title={`Besprechung · ${p.title}`}
          onClose={() => setInk(false)}
          onSave={async (page) => {
            await createInkMeeting(p, page, { date });
            setInk(false);
            onClose();
          }}
        />
      ) : null}
      <PendingFiles files={files} setFiles={setFiles} />
      <Field label="Notiz (wird beim Sprechen mitgeschrieben, du kannst sie korrigieren)">
        <textarea className="input meet-text" rows={7} value={dict.text} readOnly={dict.on} onChange={(e) => dict.setText(e.target.value)} placeholder="z. B. Termin mit Elektriker Müller zur PV-Anlage: Zählerschrank muss erneuert werden, Angebot kommt bis Freitag, Montage voraussichtlich in KW 12 …" />
      </Field>
      <div className="hstack" style={{ flexWrap: 'wrap' }}>
        {avail !== false ? (
          <Btn kind="ai" icon="sparkles" onClick={() => save(true)} disabled={!dict.text.trim()}>
            Speichern & aufbereiten
          </Btn>
        ) : null}
        <Btn kind={avail !== false ? 'ghost' : 'primary'} icon="check" onClick={() => save(false)} disabled={!dict.text.trim()}>
          {avail !== false ? 'Ohne KI speichern' : 'Speichern'}
        </Btn>
      </div>
      {avail !== false ? <p className="small muted">Die KI erkennt, ob es um einen Termin ging, wann er war, wer dabei war und was beschlossen wurde, schreibt die Notiz sauber und trägt neue Termine und To-dos ins Projekt ein.</p> : null}
      {avail === false ? <p className="small muted">Die KI-Auswertung steht zur Verfügung, wenn die KI eingerichtet ist. Der Text wird trotzdem gespeichert.</p> : null}
    </div>
  );
}

function MeetingCard({ m, p, data }) {
  const [edit, setEdit] = useState(false);
  const [ink, setInk] = useState(false);
  const preparing = usePreparing()('meeting:' + m.id);
  const reading = isReading('meeting:' + m.id);
  const inkDoc = m.inkDoc ? data.documents?.[m.inkDoc] : null;
  const avail = useAiAvailable();
  const raw = !m.ai && !m.summary && !(m.points || []).length && String(m.transcript || '').trim().length >= 10;
  const set = (patch) => patchProject(p.id, (x) => ({ ...x, meetings: (x.meetings || []).map((y) => (y.id === m.id ? { ...y, ...patch } : y)) }));
  const ms = (p.milestones || []).filter((x) => x.meetingId === m.id);
  const todos = (p.constraints || []).filter((x) => x.meetingId === m.id);
  const remove = () => {
    if (m.inkDoc) deleteInkDoc(m.inkDoc);
    // attached files stay in the project's documents
    for (const d of meetingDocs(data, m)) updateDoc('documents', d.id, (x) => ({ ...x, meetingId: null }));
    patchProject(p.id, (x) => ({ ...x, meetings: (x.meetings || []).filter((y) => y.id !== m.id) }));
  };
  const toggleTodo = (id, done) => patchProject(p.id, (x) => ({ ...x, constraints: (x.constraints || []).map((c) => (c.id === id ? { ...c, done } : c)) }));
  const toggleMs = (id, done) => patchProject(p.id, (x) => ({ ...x, milestones: (x.milestones || []).map((c) => (c.id === id ? { ...c, done } : c)) }));
  const takenCosts = new Set((p.costs || []).map((c) => c.label));
  const Block = ({ title, items, icon }) =>
    items?.length ? (
      <div className="meet-block">
        <span className="field-label">{title}</span>
        <ul>
          {items.map((x, i) => (
            <li key={i}>
              {icon ? <Icon name={icon} size={13} /> : null}
              <span>{x}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <article className="dsec meet-card">
      <header className="meet-head">
        <span className="meet-date">
          <b>{isISO(m.date) ? fmtDate(m.date).slice(0, 6) : '–'}</b>
          <small>{isISO(m.date) ? m.date.slice(0, 4) : ''}</small>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {edit ? <TextInput id={'mt-title-' + m.id} value={m.title} onChange={(v) => set({ title: v })} /> : <h3>{m.title}</h3>}
          {m.ai && m.isMeeting !== false ? (
            <div className="small meet-facts">
              <Icon name="calendar" size={13} /> {m.meetingType ? <b>{m.meetingType}</b> : 'Termin'} · {isISO(m.date) ? `${fmtDateShort(m.date)}${m.date.slice(0, 4)}` : 'Datum offen'}
              {m.time ? `, ${m.time} Uhr` : ''}
            </div>
          ) : m.ai && m.isMeeting === false ? (
            <div className="small muted">Notiz – kein Termin</div>
          ) : null}
          {m.participants?.length ? <div className="small muted">Dabei: {m.participants.join(' · ')}</div> : null}
          {(m.contactIds || []).filter((id) => data?.contacts?.[id]).length ? (
            <div className="chips" style={{ marginTop: 4 }}>
              {m.contactIds.filter((id) => data.contacts[id]).map((id) => (
                <button key={id} type="button" className="chip" onClick={() => openDrawer({ type: 'contact', id })}>
                  <Icon name="tag" size={12} /> {data.contacts[id].company || data.contacts[id].name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <IconBtn icon={edit ? 'check' : 'edit'} label={edit ? 'Fertig' : 'Bearbeiten'} size={16} onClick={() => setEdit(!edit)} />
      </header>
      {edit ? (
        <div className="stack" style={{ gap: 8 }}>
          <Field label="Datum">
            <DateInput value={m.date} onChange={(v) => v && set({ date: v })} />
          </Field>
          <Field label="Zusammenfassung">
            <TextInput multiline rows={4} value={m.summary} onChange={(v) => set({ summary: v })} />
          </Field>
          <ConfirmBtn onConfirm={remove}>Besprechung löschen</ConfirmBtn>
          <p className="small muted">Beim Löschen bleiben die daraus angelegten Termine und To-dos erhalten, angehängte Dateien bleiben in der Ablage des Projekts.</p>
        </div>
      ) : m.summary ? (
        <p className="meet-summary">{m.summary}</p>
      ) : null}
      {preparing ? (
        <div className="ai-pending" role="status">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          {reading ? 'Die KI liest die Handschrift …' : 'Die KI bereitet die Besprechung auf …'}
        </div>
      ) : raw && !edit ? (
        <>
          <p className="note-text">{m.transcript}</p>
          {avail !== false ? (
            <div>
              <Btn small kind="ai" icon="sparkles" onClick={() => prepareMeeting(p.id, m.id, { derive: true })}>
                Mit KI aufbereiten
              </Btn>
            </div>
          ) : null}
        </>
      ) : null}
      <Block title="Besprochen" items={m.points} />
      <Block title="Beschlossen / vereinbart" items={m.decisions} icon="check" />
      <Block title="Offene Fragen" items={m.openQuestions} icon="info" />
      {ms.length || todos.length ? (
        <div className="meet-block">
          <span className="field-label">Ins Projekt übernommen</span>
          <ul className="meet-derived">
            {ms.map((x) => (
              <li key={x.id} className={x.done ? 'is-done' : ''}>
                <input type="checkbox" checked={!!x.done} onChange={(e) => toggleMs(x.id, e.target.checked)} aria-label="Termin erledigt" />
                <Icon name="calendar" size={13} />
                <span>
                  {x.title}
                  {x.date ? <b> · {fmtDate(x.date)}{x.time ? `, ${x.time} Uhr` : ''}</b> : <em> · ohne Datum</em>}
                </span>
              </li>
            ))}
            {todos.map((x) => (
              <li key={x.id} className={x.done ? 'is-done' : ''}>
                <input type="checkbox" checked={!!x.done} onChange={(e) => toggleTodo(x.id, e.target.checked)} aria-label="To-do erledigt" />
                <Icon name="checkCircle" size={13} />
                <span>
                  {x.text}
                  {x.who ? <Pill>{x.who}</Pill> : null}
                  {x.due ? <b> · bis {fmtDate(x.due)}</b> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {m.costs?.length ? (
        <div className="meet-block">
          <span className="field-label">Genannte Preise</span>
          <ul className="meet-derived">
            {m.costs.map((c, i) => (
              <li key={i}>
                <Icon name="euro" size={13} />
                <span>
                  {c.label} <b>{fmtEuro(c.amount)}</b>
                </span>
                {takenCosts.has(c.label) ? (
                  <span className="adopted small">
                    <Icon name="check" size={13} /> übernommen
                  </span>
                ) : (
                  <button type="button" className="link small" onClick={() => { addCost(p.id, { label: c.label, offer: c.amount }); toast('Als Kostenposition übernommen'); }}>
                    als Kosten
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <MeetingFiles m={m} p={p} data={data} edit={edit} />
      {m.inkDoc && !edit ? (
        <InkPreview doc={inkDoc} onEdit={inkDoc?.ink ? () => setInk(true) : null} onRead={avail !== false && inkDoc?.ink ? () => transcribeMeeting(p.id, m.id, { derive: !m.ai }) : null} reading={preparing} />
      ) : null}
      {ink && inkDoc ? (
        <InkEditor
          title={m.title || 'Besprechung'}
          initial={inkDoc.ink}
          onClose={() => setInk(false)}
          onSave={async (page) => {
            await updateInkMeeting(p, m, page);
            setInk(false);
          }}
        />
      ) : null}
      {m.transcript && !raw ? (
        <details className="small meet-transcript">
          <summary>{m.source === 'handschrift' ? 'Erkannter Text der Handschrift' : 'Gesprochene Notiz'}</summary>
          <p>{m.transcript}</p>
        </details>
      ) : null}
    </article>
  );
}

// ---------- attached files ----------
// Files of a meeting are ordinary documents of the project with meetingId set, so they also show up in the
// project's documents and the Ablage. The handwritten page of a meeting has its own preview and is left out.
export const meetingDocs = (data, m) =>
  Object.values(data?.documents || {})
    .filter((d) => d.meetingId === m.id && d.id !== m.inkDoc && !d.ink)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));

async function attachToMeeting(files, projectId, meetingId) {
  if (files.length > 1) toast(`${files.length} Dateien werden angehängt …`);
  const n = await uploadFiles(files, { projectId, meetingId, silent: true });
  if (n) toast(n === 1 ? 'Datei angehängt' : `${n} Dateien angehängt`);
  return n;
}

const sizeText = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const isImage = (t) => String(t || '').startsWith('image/');

// "Datei" (gallery, files, PDF …) and "Foto" (camera) buttons; hands over the picked files
function PickButtons({ onPick, busy, small = true }) {
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const pick = (e) => {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    if (list.length) onPick(list);
  };
  return (
    <>
      <Btn small={small} icon="upload" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? 'Lädt …' : 'Datei anhängen'}
      </Btn>
      <Btn small={small} kind="ghost" icon="camera" disabled={busy} onClick={() => camRef.current?.click()}>
        Foto
      </Btn>
      <input ref={fileRef} type="file" multiple hidden accept={FILE_ACCEPT} onChange={pick} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
    </>
  );
}

// in the recorder: files to attach once the meeting is saved
function PendingFiles({ files, setFiles }) {
  const add = async (list) => {
    const ok = [];
    for (const f of list) {
      if (await fileAllowed(f)) ok.push(f);
      else toast(`„${f.name}“: ${NOT_ALLOWED}`, 'warn', 6000);
    }
    if (ok.length) setFiles((cur) => [...cur, ...ok]);
  };
  return (
    <div className="meet-files">
      <span className="field-label">Anhänge</span>
      {files.length ? (
        <ul className="meet-file-list">
          {files.map((f, i) => (
            <li key={i}>
              <Icon name={isImage(f.type) ? 'image' : 'file'} size={15} />
              <span className="meet-file-name">{f.name}</span>
              <span className="small muted">{sizeText(f.size)}</span>
              <IconBtn icon="x" size={14} label={`„${f.name}“ entfernen`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Angebot, Skizze, Fotos von der Baustelle … – werden mit der Besprechung gespeichert.</p>
      )}
      <div className="hstack" style={{ flexWrap: 'wrap', gap: 6 }}>
        <PickButtons onPick={add} />
      </div>
    </div>
  );
}

// on a saved meeting: open, attach more, link a document from the Ablage, detach (and delete when editing)
function MeetingFiles({ m, p, data, edit }) {
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState(null);
  const docs = meetingDocs(data, m);
  const add = async (list) => {
    setBusy(true);
    await attachToMeeting(list, p.id, m.id);
    setBusy(false);
  };
  // documents that can be linked: this project's first, then the others; newest first
  const linkable = Object.values(data?.documents || {})
    .filter((d) => !d.meetingId && !d.ink && d.type !== 'antrag' && d.type !== 'entscheidung' && (d.assetId || d.dataUrl))
    .sort((a, b) => (a.projectId === p.id) - (b.projectId === p.id) || (a.date < b.date ? -1 : 1))
    .reverse()
    .slice(0, 80);
  const link = (id) => {
    if (!id) return;
    updateDoc('documents', id, (d) => ({ ...d, meetingId: m.id, projectId: d.projectId || p.id }));
    toast('Dokument verknüpft');
  };
  const detach = (d) => {
    updateDoc('documents', d.id, (x) => ({ ...x, meetingId: null }));
    toast(`„${d.name}“ gelöst – liegt weiter in der Ablage`);
  };
  if (!docs.length && !edit)
    return (
      <div className="hstack meet-files-add">
        <PickButtons onPick={add} busy={busy} />
      </div>
    );
  return (
    <div className="meet-block meet-files">
      <span className="field-label">Anhänge{docs.length ? ` (${docs.length})` : ''}</span>
      {docs.length ? (
        <ul className="meet-file-list">
          {docs.map((d) => {
            const url = fileUrl(d);
            const img = isImage(d.contentType);
            const label = (
              <>
                {img && url ? <img src={url} alt="" loading="lazy" /> : <Icon name={img ? 'image' : 'file'} size={15} />}
                <span className="meet-file-name">{d.name}</span>
              </>
            );
            return (
              <li key={d.id}>
                {img ? (
                  <button type="button" className="meet-file-open" onClick={() => url && setBox(d)} aria-label={`${d.name} ansehen`}>
                    {label}
                  </button>
                ) : url ? (
                  <a className="meet-file-open" href={url} target="_blank" rel="noopener noreferrer" aria-label={`${d.name} öffnen`}>
                    {label}
                  </a>
                ) : (
                  <span className="meet-file-open">{label}</span>
                )}
                {d.size ? <span className="small muted">{sizeText(d.size)}</span> : null}
                {edit ? (
                  <ConfirmBtn onConfirm={async () => { await removeDocument(d); toast('Datei gelöscht'); }}>{''}</ConfirmBtn>
                ) : (
                  <IconBtn icon="x" size={14} label={`„${d.name}“ von der Besprechung lösen (bleibt in der Ablage)`} onClick={() => detach(d)} />
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="hstack" style={{ flexWrap: 'wrap', gap: 6 }}>
        <PickButtons onPick={add} busy={busy} />
        {linkable.length ? (
          <Select
            value=""
            placeholder="Aus der Ablage verknüpfen …"
            onChange={link}
            options={linkable.map((d) => ({ value: d.id, label: `${d.name}${d.projectId === p.id ? '' : data.projects?.[d.projectId] ? ` · ${data.projects[d.projectId].title}` : ' · ohne Projekt'}` }))}
            aria-label="Vorhandenes Dokument verknüpfen"
          />
        ) : null}
      </div>
      {edit && docs.length ? <p className="small muted">Der Papierkorb löscht die Datei ganz. Außerhalb von „Bearbeiten“ löst das ✕ sie nur von der Besprechung, sie bleibt in der Ablage.</p> : null}
      {box ? <Lightbox doc={box} onClose={() => setBox(null)} /> : null}
    </div>
  );
}
