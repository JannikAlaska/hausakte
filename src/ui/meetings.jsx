// Meeting notes per project: record a voice memo (live speech-to-text), let the AI write the note
// and add the appointments as milestones and the to-dos as tasks.
import { Icon } from './icons.jsx';
import { Btn, IconBtn, Field, TextInput, DateInput, Pill, ConfirmBtn } from './common.jsx';
import { useAiAvailable } from './ai-ui.jsx';
import { toast } from './state.js';
import { aiMeeting, aiErrorText } from '../ai.js';
import { addMeeting, addCost, patchProject } from '../actions.js';
import { fmtDate, fmtEuro, todayISO, isISO } from '../util.js';

const { useState, useEffect, useRef } = React;

export const SpeechRec = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Continuous German dictation. Browsers end recognition after pauses, so it restarts until stopped.
export function useDictation(onError) {
  const [text, setText] = useState('');
  const [on, setOn] = useState(false);
  const [secs, setSecs] = useState(0);
  const keep = useRef(false);
  const rec = useRef(null);
  const done = useRef('');
  const lock = useRef(null);
  useEffect(() => {
    if (!on) return;
    const t0 = Date.now() - secs * 1000;
    const id = setInterval(() => setSecs((Date.now() - t0) / 1000), 500);
    return () => clearInterval(id);
  }, [on]);
  const run = () => {
    const r = new SpeechRec();
    r.lang = 'de-DE';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) done.current = (done.current + ' ' + t).replace(/\s+/g, ' ').trim();
        else interim += t;
      }
      setText((done.current + ' ' + interim).trim());
    };
    r.onerror = (e) => {
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) {
        keep.current = false;
        onError?.(e.error);
      }
    };
    r.onend = () => {
      if (keep.current) setTimeout(() => keep.current && run(), 150);
      else {
        setOn(false);
        lock.current?.release?.().catch(() => {});
        lock.current = null;
      }
    };
    rec.current = r;
    r.start();
  };
  const start = (base = '') => {
    if (!SpeechRec) return false;
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
  useEffect(() => () => {
    keep.current = false;
    rec.current?.abort();
    lock.current?.release?.().catch(() => {});
  }, []);
  return { text, setText, on, secs, start, stop, reset: () => (setText(''), setSecs(0), (done.current = '')) };
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
            <p className="small muted">Sprich nach dem Termin kurz ein, was besprochen wurde. Die KI schreibt daraus eine Notiz und trägt Termine und To-dos ins Projekt ein.</p>
          </div>
          <Btn kind="primary" icon="mic" onClick={() => setOpen(true)}>
            Neue Besprechung
          </Btn>
        </div>
      )}
      {list.length ? list.map((m) => <MeetingCard key={m.id} m={m} p={p} />) : !open ? <p className="small muted">Noch keine Besprechungen.</p> : null}
    </div>
  );
}

function Recorder({ p, data, onClose }) {
  const avail = useAiAvailable();
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const ctl = useRef(null);
  const dict = useDictation((code) =>
    toast(code === 'audio-capture' ? 'Kein Mikrofon gefunden.' : 'Das Mikrofon ist für diese Seite nicht freigegeben. Erlaube den Zugriff in den Browser-Einstellungen – in der Vorschau in claude.ai geht es nicht.', 'warn', 7000),
  );
  useEffect(() => () => ctl.current?.abort(), []);
  const toggle = () => {
    if (dict.on) return dict.stop();
    if (!dict.start(dict.text)) toast('Spracheingabe kann dieser Browser nicht – tippe die Notiz ein oder nutze das Diktier-Mikrofon deiner Tastatur.', 'warn', 6000);
  };
  const evaluate = async () => {
    const t = dict.text.trim();
    if (t.length < 10) return toast('Die Notiz ist noch zu kurz.', 'warn');
    dict.stop();
    setBusy(true);
    setErr(null);
    ctl.current = new AbortController();
    try {
      const r = await aiMeeting(p, t, data, { date, signal: ctl.current.signal });
      const res = addMeeting(p.id, r, { transcript: t, date });
      toast(`Besprechung angelegt${res.milestones ? ` · ${res.milestones} Termin${res.milestones > 1 ? 'e' : ''}` : ''}${res.todos ? ` · ${res.todos} To-do${res.todos > 1 ? 's' : ''}` : ''}`);
      onClose();
    } catch (e) {
      if (e?.code !== 'cancelled') setErr(aiErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  const saveRaw = () => {
    const t = dict.text.trim();
    if (!t) return;
    dict.stop();
    addMeeting(p.id, { title: 'Besprechung', summary: '', date }, { transcript: t, date, source: 'manuell' });
    toast('Notiz gespeichert');
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
        <button type="button" className={`rec-btn ${dict.on ? 'is-on' : ''}`} onClick={toggle} disabled={busy} aria-label={dict.on ? 'Aufnahme beenden' : 'Aufnahme starten'}>
          <Icon name={dict.on ? 'stop' : 'mic'} size={22} />
        </button>
        <div>
          <b>{dict.on ? `Aufnahme läuft · ${mmss(dict.secs)}` : dict.text ? 'Aufnahme pausiert' : 'Tippe zum Aufnehmen'}</b>
          <div className="small muted">{dict.on ? 'Sprich frei – wer war da, was wurde besprochen, welche Termine und nächsten Schritte.' : SpeechRec ? 'Erneut tippen setzt die Aufnahme fort.' : 'Spracheingabe gibt es hier nicht – tippe die Notiz unten ein.'}</div>
        </div>
      </div>
      <Field label="Notiz (wird beim Sprechen mitgeschrieben, du kannst sie korrigieren)">
        <textarea className="input meet-text" rows={7} value={dict.text} readOnly={dict.on} onChange={(e) => dict.setText(e.target.value)} placeholder="z. B. Termin mit Elektriker Müller zur PV-Anlage: Zählerschrank muss erneuert werden, Angebot kommt bis Freitag, Montage voraussichtlich in KW 12 …" />
      </Field>
      {err ? (
        <div className="callout callout-warn">
          <Icon name="alert" size={16} />
          <span>{err}</span>
        </div>
      ) : null}
      <div className="hstack" style={{ flexWrap: 'wrap' }}>
        {avail !== false ? (
          <Btn kind="ai" icon="sparkles" onClick={evaluate} disabled={busy || !dict.text.trim()}>
            {busy ? 'KI schreibt die Notiz …' : 'Notiz, Termine & To-dos erstellen'}
          </Btn>
        ) : null}
        <Btn kind="ghost" icon="check" onClick={saveRaw} disabled={busy || !dict.text.trim()}>
          Nur Text speichern
        </Btn>
      </div>
      {avail === false ? <p className="small muted">Die KI-Auswertung steht zur Verfügung, wenn die KI eingerichtet ist. Der Text wird trotzdem gespeichert.</p> : null}
    </div>
  );
}

function MeetingCard({ m, p }) {
  const [edit, setEdit] = useState(false);
  const set = (patch) => patchProject(p.id, (x) => ({ ...x, meetings: (x.meetings || []).map((y) => (y.id === m.id ? { ...y, ...patch } : y)) }));
  const ms = (p.milestones || []).filter((x) => x.meetingId === m.id);
  const todos = (p.constraints || []).filter((x) => x.meetingId === m.id);
  const remove = () =>
    patchProject(p.id, (x) => ({ ...x, meetings: (x.meetings || []).filter((y) => y.id !== m.id) }));
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
          {m.participants?.length ? <div className="small muted">{m.participants.join(' · ')}</div> : null}
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
          <p className="small muted">Beim Löschen bleiben die daraus angelegten Termine und To-dos erhalten.</p>
        </div>
      ) : m.summary ? (
        <p className="meet-summary">{m.summary}</p>
      ) : null}
      <Block title="Besprochen" items={m.points} />
      <Block title="Vereinbart" items={m.decisions} icon="check" />
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
      {m.transcript ? (
        <details className="small meet-transcript">
          <summary>Gesprochene Notiz</summary>
          <p>{m.transcript}</p>
        </details>
      ) : null}
    </article>
  );
}
