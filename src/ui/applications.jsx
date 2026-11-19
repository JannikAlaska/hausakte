// Application assistant: upload the papers, say what you want to apply for; the AI fills the fields from the
// house file, asks only what it cannot find there, lists the attachments (linked to existing documents),
// deadlines and next steps – as a filling aid to copy from and as PDF.
import { Icon } from './icons.jsx';
import { Btn, IconBtn, Field, TextInput, Select, DateInput, Seg, Pill, Drawer, Section, ConfirmBtn, Empty } from './common.jsx';
import { toast, openDrawer, closeDrawer } from './state.js';
import { useAiAvailable } from './ai-ui.jsx';
import { storeFile } from './documents.jsx';
import { useDictation, SpeechRec } from './meetings.jsx';
import { openViewer } from './photos.jsx';
import { putDoc, updateDoc, fileUrl } from '../store.js';
import { APP_STATUS, appStatus, appOf, appFields, appFiles, appProgress, applications, createApplication, deleteApplication, setApp, fieldKey } from '../applications.js';
import { runApplication, answerQuestions, isRunning, subscribeRuns } from '../appassist.js';
import { addConstraint, addMilestone, addFunding } from '../actions.js';
import { buildPdf } from '../pdf.js';
import { saveFile } from '../download.js';
import { fmtDate, fmtEuro, todayISO, uid } from '../util.js';

const { useState, useEffect, useRef } = React;

function useRuns() {
  const [, tick] = useState(0);
  useEffect(() => subscribeRuns(() => tick((n) => n + 1)), []);
  return isRunning;
}

const SOURCE = {
  bauakte: { label: 'aus der Bauakte', tone: 'accent' },
  dokument: { label: 'aus den Unterlagen', tone: 'accent' },
  frueher: { label: 'frühere Angabe', tone: 'info' },
  antwort: { label: 'von dir', tone: 'info' },
  offen: { label: 'offen', tone: 'warn' },
};

async function storeAppFiles(appId, files, projectId) {
  const ids = [];
  for (const f of files) {
    const st = await storeFile(f);
    if (!st) continue;
    const id = uid('d-');
    putDoc('documents', id, { id, type: 'formular', name: f.name || 'Antragsunterlage', date: todayISO(), projectId: projectId || null, appId, notes: '', size: f.size, ...st }, 50);
    ids.push(id);
  }
  return ids;
}

function FilePick({ onFiles, small, label = 'Unterlagen hinzufügen' }) {
  const ref = useRef(null);
  const cam = useRef(null);
  const pick = (e) => {
    const f = [...e.target.files].filter((x) => x.type === 'application/pdf' || x.type.startsWith('image/'));
    e.target.value = '';
    if (f.length) onFiles(f);
  };
  return (
    <div className="app-pick">
      <input ref={ref} type="file" accept="application/pdf,image/*" multiple hidden onChange={pick} />
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <Btn small={small} icon="upload" onClick={() => ref.current?.click()}>
        {label}
      </Btn>
      <Btn small={small} icon="camera" onClick={() => cam.current?.click()}>
        Fotografieren
      </Btn>
    </div>
  );
}

// ---------- new application ----------
export function NewApplication({ data, projectId = null, onClose }) {
  const avail = useAiAvailable();
  const dict = useDictation(() => toast('Das Mikrofon ist hier nicht freigegeben – tippe dein Anliegen ein.', 'warn', 6000));
  const [files, setFiles] = useState([]);
  const [proj, setProj] = useState(projectId || '');
  const [busy, setBusy] = useState(false);
  const projects = Object.values(data.projects || {}).filter((p) => !p.archived);
  const start = async () => {
    const goal = dict.text.trim();
    if (!goal && !files.length) return toast('Sag oder schreib, was du beantragen möchtest – oder lade die Unterlagen hoch.', 'warn');
    dict.stop();
    setBusy(true);
    try {
      const id = createApplication({ goal: goal || 'Antrag laut Unterlagen', projectId: proj || null });
      const ids = await storeAppFiles(id, files, proj || null);
      setApp(id, (x) => ({ ...x, files: ids, filesAt: Date.now() }), 50);
      onClose?.();
      openDrawer({ type: 'application', id });
      if (avail !== false) runApplication(id, { files });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel app-new">
      <div className="spread">
        <h3>Neuer Antrag</h3>
        {onClose ? <IconBtn icon="x" label="Abbrechen" onClick={() => { dict.stop(); onClose(); }} /> : null}
      </div>
      <Field label="Was möchtest du beantragen?">
        <div className="app-goal">
          <textarea className="input" rows={3} value={dict.text} readOnly={dict.on} onChange={(e) => dict.setText(e.target.value)} placeholder="z. B. KfW-Zuschuss 458 für die Wärmepumpe – Antrag stelle ich selbst im KfW-Portal; oder: Anmeldung der PV-Anlage beim Netzbetreiber" />
          {SpeechRec ? (
            <button type="button" className={`rec-btn small ${dict.on ? 'is-on' : ''}`} onClick={() => (dict.on ? dict.stop() : dict.start(dict.text))} aria-label={dict.on ? 'Aufnahme beenden' : 'Einsprechen'}>
              <Icon name={dict.on ? 'stop' : 'mic'} size={18} />
            </button>
          ) : null}
        </div>
      </Field>
      <div className="grid2">
        <Field label="Zu welchem Projekt?">
          <Select value={proj} placeholder="– ohne Projekt –" onChange={setProj} options={projects.map((p) => ({ value: p.id, label: p.title }))} />
        </Field>
        <Field label="Unterlagen" hint="Formular, Merkblatt, Bescheid, Angebot – PDF oder Foto">
          <FilePick small onFiles={(f) => setFiles((x) => [...x, ...f])} />
        </Field>
      </div>
      {files.length ? (
        <ul className="app-files-new">
          {files.map((f, i) => (
            <li key={i}>
              <Icon name={f.type === 'application/pdf' ? 'file' : 'image'} size={15} />
              <span>{f.name}</span>
              <IconBtn icon="x" size={14} label="Entfernen" onClick={() => setFiles((x) => x.filter((_, k) => k !== i))} />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="hstack" style={{ flexWrap: 'wrap' }}>
        <Btn kind="ai" icon="sparkles" onClick={start} disabled={busy || (!dict.text.trim() && !files.length)}>
          {busy ? 'Lädt hoch …' : 'Antrag vorbereiten'}
        </Btn>
        <span className="small muted">Der Assistent füllt alles aus, was in der Bauakte steht, und fragt dich nur nach dem Rest.</span>
      </div>
    </div>
  );
}

// ---------- list ----------
function AppCard({ d, data }) {
  const a = appOf(d);
  const st = appStatus(a.status);
  const pr = appProgress(d);
  const running = useRuns()(d.id);
  const p = d.projectId ? data.projects?.[d.projectId] : null;
  return (
    <button type="button" className="app-card" onClick={() => openDrawer({ type: 'application', id: d.id })}>
      <span className="app-card-icon">
        <Icon name="flag" size={18} />
      </span>
      <span className="app-card-main">
        <b>{a.title || d.name}</b>
        <span>{[a.analysis?.program, a.analysis?.authority, p?.title].filter(Boolean).join(' · ') || a.goal}</span>
        {pr.fields ? (
          <span className="app-bar" aria-label={`${pr.done} von ${pr.fields} Feldern ausgefüllt`}>
            <i style={{ width: `${(pr.done / pr.fields) * 100}%` }} />
          </span>
        ) : null}
      </span>
      <span className="app-card-side">
        {running ? <Pill tone="info">arbeitet …</Pill> : <Pill tone={st.tone}>{st.name}</Pill>}
        {pr.open ? <span className="small warn-text">{pr.open} Frage{pr.open === 1 ? '' : 'n'}</span> : null}
        {a.analysis?.deadline ? <span className="small muted">Frist {fmtDate(a.analysis.deadline)}</span> : null}
      </span>
    </button>
  );
}

export function ApplicationsPanel({ data }) {
  const [creating, setCreating] = useState(false);
  const list = applications(data);
  return (
    <div className="stack">
      {creating ? (
        <NewApplication data={data} onClose={() => setCreating(false)} />
      ) : (
        <div className="meet-intro">
          <div>
            <b>Antragsassistent</b>
            <p className="small muted">Lade das Formular oder Merkblatt hoch und sag, was du beantragen willst – Förderung, Genehmigung, Anmeldung. Der Assistent füllt alles aus der Bauakte aus, fragt dich nur nach dem, was fehlt, und listet Anlagen, Fristen und nächste Schritte.</p>
          </div>
          <Btn kind="primary" icon="plus" onClick={() => setCreating(true)}>
            Neuer Antrag
          </Btn>
        </div>
      )}
      {list.length ? list.map((d) => <AppCard key={d.id} d={d} data={data} />) : !creating ? <Empty icon="flag" title="Noch keine Anträge">Zum Beispiel: KfW-Zuschuss für die Wärmepumpe, BAFA-Antrag für die Dämmung, Anmeldung der PV-Anlage beim Netzbetreiber oder ein Bauantrag.</Empty> : null}
    </div>
  );
}

// ---------- questions ----------
function Questions({ d }) {
  const a = appOf(d);
  const open = a.open || [];
  const [ans, setAns] = useState({});
  const running = useRuns()(d.id);
  if (!open.length) return null;
  const set = (q, patch) => setAns((x) => ({ ...x, [q.id]: { ...(x[q.id] || {}), ...patch } }));
  const filled = open.filter((q) => ans[q.id]?.skip || String(ans[q.id]?.value ?? '').trim()).length;
  return (
    <Section title={`Fragen an dich (${open.length})`} className="app-qs">
      <p className="small muted">Das steht nicht in der Bauakte. Sensible Angaben wie Steuer-ID oder Bankverbindung kannst du überspringen und selbst ins Formular eintragen.</p>
      {open.map((q, i) => {
        const v = ans[q.id] || {};
        return (
          <div key={q.id} className={`app-q ${v.skip ? 'is-skip' : ''}`}>
            <label className="app-q-text" htmlFor={'aq-' + q.id}>
              <b>
                {i + 1}. {q.question}
              </b>
              {q.why ? <span className="small muted">{q.why}</span> : null}
            </label>
            {v.skip ? (
              <span className="small muted">Trägst du selbst ins Formular ein.</span>
            ) : q.type === 'auswahl' && q.options.length ? (
              <Select id={'aq-' + q.id} value={v.value || ''} placeholder="– bitte wählen –" onChange={(x) => set(q, { value: x })} options={q.options.map((o) => ({ value: o, label: o }))} />
            ) : q.type === 'janein' ? (
              <Seg small value={v.value || ''} onChange={(x) => set(q, { value: x })} options={[{ value: 'ja', label: 'Ja' }, { value: 'nein', label: 'Nein' }]} />
            ) : q.type === 'datum' ? (
              <DateInput id={'aq-' + q.id} value={v.value || ''} onChange={(x) => set(q, { value: x || '' })} />
            ) : (
              <TextInput id={'aq-' + q.id} value={v.value || ''} onChange={(x) => set(q, { value: x })} inputMode={q.type === 'zahl' ? 'decimal' : undefined} placeholder={q.type === 'zahl' ? 'Zahl' : 'Antwort'} />
            )}
            <button type="button" className="link small" onClick={() => set(q, { skip: !v.skip })}>
              {v.skip ? 'Doch beantworten' : 'Überspringen – trage ich selbst ein'}
            </button>
          </div>
        );
      })}
      <div className="hstack" style={{ flexWrap: 'wrap' }}>
        <Btn kind="ai" icon="sparkles" disabled={!filled || running} onClick={() => { answerQuestions(d.id, ans); setAns({}); }}>
          {running ? 'Arbeitet …' : `Antworten übernehmen (${filled})`}
        </Btn>
        <span className="small muted">Deine Antworten merkt sich der Assistent auch für spätere Anträge.</span>
      </div>
    </Section>
  );
}

// ---------- fields ----------
function FieldRow({ d, f }) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(f.value || '');
  const src = SOURCE[f.source] || SOURCE.offen;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(f.value);
      toast('Kopiert');
    } catch {
      toast('Kopieren nicht möglich – Wert markieren und kopieren.', 'warn');
    }
  };
  const save = () => {
    setApp(d.id, (x) => ({ ...x, edits: { ...(x.edits || {}), [fieldKey(f)]: val.trim() } }), 100);
    setEdit(false);
  };
  return (
    <div className={`app-field is-${f.self ? 'self' : f.status}`}>
      <div className="app-field-head">
        <span className="app-field-label">{f.label}</span>
        {f.self ? <Pill>trägst du ein</Pill> : f.status === 'unsicher' ? <Pill tone="warn">prüfen</Pill> : <Pill tone={src.tone}>{src.label}</Pill>}
      </div>
      {edit ? (
        <div className="app-field-edit">
          <TextInput value={val} onChange={setVal} autoFocus onKeyDown={(e) => e.key === 'Enter' && save()} />
          <IconBtn icon="check" label="Übernehmen" onClick={save} />
          <IconBtn icon="x" label="Abbrechen" onClick={() => { setVal(f.value || ''); setEdit(false); }} />
        </div>
      ) : (
        <div className="app-field-val">
          <span className={f.value ? '' : 'muted'}>{f.value || (f.self ? 'selbst eintragen' : 'noch offen')}</span>
          {f.value ? <IconBtn icon="copy" size={15} label="Wert kopieren" onClick={copy} /> : null}
          <IconBtn icon="edit" size={15} label="Wert ändern" onClick={() => { setVal(f.value || ''); setEdit(true); }} />
        </div>
      )}
      {f.hint || f.sourceNote ? <span className="small muted">{[f.sourceNote, f.hint].filter(Boolean).join(' · ')}</span> : null}
    </div>
  );
}

function Fields({ d }) {
  const [filter, setFilter] = useState('alle');
  const fields = appFields(d);
  if (!fields.length) return null;
  const pr = appProgress(d);
  const shown = fields.filter((f) => (filter === 'offen' ? !f.value || f.status === 'offen' : filter === 'pruefen' ? f.status === 'unsicher' : true));
  const sections = [];
  for (const f of shown) {
    let s = sections.find((x) => x.name === f.section);
    if (!s) sections.push((s = { name: f.section, items: [] }));
    s.items.push(f);
  }
  return (
    <Section title="Ausfüllhilfe" aside={<span className="small muted">{pr.done} von {pr.fields} Feldern</span>}>
      <span className="app-bar is-big">
        <i style={{ width: `${(pr.done / Math.max(1, pr.fields)) * 100}%` }} />
      </span>
      <div className="chips">
        {[
          ['alle', `Alle (${fields.length})`],
          ['offen', `Offen (${fields.filter((f) => !f.value || f.status === 'offen').length})`],
          ['pruefen', `Prüfen (${fields.filter((f) => f.status === 'unsicher').length})`],
        ].map(([k, l]) => (
          <button key={k} type="button" className={`chip ${filter === k ? 'is-on' : ''}`} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      {sections.map((s) => (
        <div key={s.name} className="app-sec">
          <span className="field-label">{s.name}</span>
          {s.items.map((f) => (
            <FieldRow key={fieldKey(f)} d={d} f={f} />
          ))}
        </div>
      ))}
      {!shown.length ? <p className="small muted">Nichts in dieser Auswahl.</p> : null}
    </Section>
  );
}

// ---------- PDF ----------
function exportPdf(d, data) {
  const a = appOf(d);
  const an = a.analysis || {};
  const blocks = [{ t: 'title', text: `Ausfüllhilfe: ${a.title || d.name}` }];
  blocks.push({ t: 'small', text: [an.program, an.authority, an.deadline ? `Frist ${fmtDate(an.deadline)}${an.deadlineNote ? ` (${an.deadlineNote})` : ''}` : null, `Stand ${fmtDate(todayISO())}`].filter(Boolean).join(' · ') });
  if (an.summary) blocks.push({ t: 'p', text: an.summary });
  const fields = appFields(d);
  const secs = [...new Set(fields.map((f) => f.section))];
  for (const s of secs) {
    blocks.push({ t: 'h', text: s });
    blocks.push({ t: 'table', cols: [{ w: 190 }, { w: 230 }, { w: 90 }], head: ['Feld', 'Eintrag', 'Quelle'], rows: fields.filter((f) => f.section === s).map((f) => [f.label, f.value || (f.self ? '(selbst eintragen)' : '(offen)'), f.self ? 'selbst' : f.status === 'unsicher' ? 'prüfen' : (SOURCE[f.source] || SOURCE.offen).label]) });
  }
  if (an.attachments?.length) {
    blocks.push({ t: 'h', text: 'Anlagen' });
    blocks.push({ t: 'table', cols: [{ w: 260 }, { w: 70 }, { w: 180 }], head: ['Anlage', 'Pflicht', 'In der Bauakte'], rows: an.attachments.map((x) => [x.label + (x.note ? ` – ${x.note}` : ''), x.required ? 'ja' : 'nein', x.docId ? data.documents?.[x.docId]?.name || 'vorhanden' : 'fehlt noch']) });
  }
  if (an.steps?.length) {
    blocks.push({ t: 'h', text: 'Nächste Schritte' });
    an.steps.forEach((x, i) => blocks.push({ t: 'p', text: `${i + 1}. ${x.text}${x.due ? ` (bis ${fmtDate(x.due)})` : ''}` }));
  }
  if (an.warnings?.length) {
    blocks.push({ t: 'h', text: 'Hinweise' });
    an.warnings.forEach((w) => blocks.push({ t: 'p', text: `– ${w}` }));
  }
  if ((a.open || []).length) {
    blocks.push({ t: 'h', text: 'Noch offene Fragen' });
    a.open.forEach((q, i) => blocks.push({ t: 'p', text: `${i + 1}. ${q.question}` }));
  }
  blocks.push({ t: 'gap' });
  blocks.push({ t: 'small', text: 'Erstellt mit dem Antragsassistenten der Hausakte – Angaben vor dem Einreichen mit dem Original-Formular abgleichen.' });
  const name = (a.title || 'Antrag').replace(/[^\wäöüÄÖÜß -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50);
  saveFile(`Ausfuellhilfe-${name}.pdf`, 'application/pdf', buildPdf(blocks, { title: `Ausfüllhilfe ${a.title || ''}`, footer: `Hausakte · Ausfüllhilfe ${a.title || ''}` }));
}

// ---------- drawer ----------
export function ApplicationDrawer({ data, drawer }) {
  const d = data.documents?.[drawer.id];
  const running = useRuns()(drawer.id);
  const avail = useAiAvailable();
  const [extra, setExtra] = useState(null);
  if (!d)
    return (
      <Drawer title="Antrag nicht gefunden" onClose={closeDrawer}>
        <Empty title="Dieser Antrag existiert nicht mehr." />
      </Drawer>
    );
  const a = appOf(d);
  const an = a.analysis;
  const st = appStatus(a.status);
  const files = appFiles(d, data);
  const p = d.projectId ? data.projects?.[d.projectId] : null;
  const projects = Object.values(data.projects || {}).filter((x) => !x.archived || x.id === d.projectId);
  const set = (patch) => setApp(d.id, (x) => ({ ...x, ...patch }));
  const addFiles = async (f) => {
    const ids = await storeAppFiles(d.id, f, d.projectId);
    if (ids.length) {
      setApp(d.id, (x) => ({ ...x, files: [...(x.files || []), ...ids], filesAt: Date.now() }), 50);
      toast(`${ids.length} Unterlage${ids.length === 1 ? '' : 'n'} hinzugefügt – mit „Neu prüfen“ liest der Assistent sie.`);
    }
  };
  const openDoc = (doc) => {
    if (!doc) return;
    if (doc.type === 'rechnung') return openDrawer({ type: 'invoice', id: doc.id });
    if ((doc.contentType || '').startsWith('image/')) return openViewer([doc.id]);
    const url = fileUrl(doc);
    if (url) window.open(url, '_blank', 'noopener');
    else toast('Die Datei wird noch geladen – gleich noch einmal versuchen.', 'warn');
  };
  const toProject = () => {
    if (!p || !an) return;
    const done = new Set(a.takenSteps || []);
    let n = 0;
    for (const s of an.steps || []) {
      if (done.has(s.text)) continue;
      addConstraint(p.id, s.text + (s.due ? ` (bis ${fmtDate(s.due)})` : ''), 'organisatorisch');
      done.add(s.text);
      n++;
    }
    if (an.deadline && !a.deadlineTaken) addMilestone(p.id, `Frist: ${a.title || 'Antrag'}`, an.deadline);
    set({ takenSteps: [...done], deadlineTaken: !!an.deadline || a.deadlineTaken });
    toast(`${n} Schritt${n === 1 ? '' : 'e'}${an.deadline && !a.deadlineTaken ? ' und die Frist' : ''} ins Projekt „${p.title}“ übernommen`);
  };
  const toFunding = () => {
    if (!p || !an?.funding) return;
    addFunding(p.id, { program: an.program || a.title, provider: an.authority, type: an.funding.type, amount: an.funding.amount, deadline: an.deadline, status: a.status === 'bewilligt' ? 'bewilligt' : a.status === 'eingereicht' ? 'beantragt' : 'geplant', notes: 'aus dem Antragsassistenten', source: 'ki' });
    set({ fundingTaken: true });
    toast(`Förderung „${an.program || a.title}“ im Projekt eingetragen`);
  };
  return (
    <Drawer
      eyebrow={`Antrag${an?.authority ? ' · ' + an.authority : ''}`}
      title={a.title || d.name}
      icon="flag"
      onClose={closeDrawer}
      className="app-drawer"
      subtitle={
        <>
          {running ? <Pill tone="info">Assistent arbeitet …</Pill> : <Pill tone={st.tone}>{st.name}</Pill>}
          {an?.deadline ? <span>Frist {fmtDate(an.deadline)}</span> : null}
        </>
      }
      footer={
        <>
          <ConfirmBtn confirmText="Antrag samt Unterlagen löschen?" onConfirm={async () => { await deleteApplication(d); closeDrawer(); toast('Antrag gelöscht'); }} />
          {an ? (
            <Btn icon="download" onClick={() => exportPdf(d, data)}>
              Als PDF
            </Btn>
          ) : null}
          {avail !== false ? (
            <Btn kind="ai" icon="sparkles" disabled={running} onClick={() => runApplication(d.id, { withFiles: true })}>
              {running ? 'Arbeitet …' : an ? 'Neu prüfen' : 'Antrag vorbereiten'}
            </Btn>
          ) : null}
        </>
      }
    >
      {running ? (
        <div className="ai-pending" role="status">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          {an ? 'Der Assistent arbeitet deine Angaben ein …' : 'Der Assistent liest die Unterlagen und sucht die Angaben in der Bauakte …'}
        </div>
      ) : null}
      {an?.summary ? (
        <div className="callout callout-accent">
          <Icon name="flag" size={16} />
          <div>
            {an.program ? <b>{an.program}</b> : null}
            <div>{an.summary}</div>
            {an.deadlineNote ? <div className="small">Frist: {an.deadline ? fmtDate(an.deadline) + ' – ' : ''}{an.deadlineNote}</div> : null}
          </div>
        </div>
      ) : null}
      {an?.warnings?.length ? (
        <div className="callout callout-warn">
          <Icon name="alert" size={16} />
          <ul className="app-warn">
            {an.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Questions key={(a.open || []).map((q) => q.id).join()} d={d} />
      <Fields d={d} />

      {an?.attachments?.length ? (
        <Section title="Anlagen" aside={<span className="small muted">{an.attachments.filter((x) => x.docId).length} von {an.attachments.length} vorhanden</span>}>
          <ul className="app-att">
            {an.attachments.map((x, i) => {
              const doc = x.docId ? data.documents?.[x.docId] : null;
              return (
                <li key={i} className={doc ? 'is-ok' : x.required ? 'is-missing' : ''}>
                  <Icon name={doc ? 'checkCircle' : x.required ? 'alert' : 'info'} size={15} />
                  <span>
                    <b>{x.label}</b>
                    {x.required ? null : <span className="small muted"> · optional</span>}
                    {x.note ? <span className="small muted"> – {x.note}</span> : null}
                    {doc ? (
                      <button type="button" className="link small app-att-doc" onClick={() => openDoc(doc)}>
                        <Icon name="file" size={12} /> {doc.name}
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {an?.steps?.length ? (
        <Section title="Nächste Schritte">
          <ol className="app-steps">
            {an.steps.map((x, i) => (
              <li key={i}>
                {x.text}
                {x.due ? <b> · bis {fmtDate(x.due)}</b> : null}
              </li>
            ))}
          </ol>
          {p ? (
            <div className="hstack" style={{ flexWrap: 'wrap' }}>
              <Btn small icon="checkCircle" onClick={toProject}>
                Als Aufgaben ins Projekt übernehmen
              </Btn>
              {an.funding && !a.fundingTaken ? (
                <Btn small icon="euro" onClick={toFunding}>
                  Als Förderung im Projekt eintragen{an.funding.amount ? ` (${fmtEuro(an.funding.amount)})` : ''}
                </Btn>
              ) : null}
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section title="Anliegen & Unterlagen">
        <Field label="Was möchtest du beantragen?">
          <TextInput multiline rows={2} value={a.goal || ''} onChange={(v) => set({ goal: v })} />
        </Field>
        <Field label="Weitere Hinweise an den Assistenten" hint="z. B. „Ich beantrage als Alleineigentümer“, „Auftrag noch nicht vergeben“ – danach „Neu prüfen“">
          <TextInput multiline rows={2} value={extra ?? a.extra ?? ''} onChange={(v) => setExtra(v)} onBlur={() => extra != null && set({ extra })} />
        </Field>
        <div className="grid2">
          <Field label="Projekt">
            <Select value={d.projectId || ''} placeholder="– ohne Projekt –" onChange={(v) => updateDoc('documents', d.id, (x) => ({ ...x, projectId: v || null }), 100)} options={projects.map((x) => ({ value: x.id, label: x.title }))} />
          </Field>
          <Field label="Status">
            <Select value={['eingereicht', 'bewilligt', 'abgelehnt'].includes(a.status) ? a.status : ''} placeholder="in Vorbereitung" onChange={(v) => setApp(d.id, (x) => ({ ...x, status: v || 'entwurf' }))} options={APP_STATUS.filter((s) => ['eingereicht', 'bewilligt', 'abgelehnt'].includes(s.key)).map((s) => ({ value: s.key, label: s.name }))} />
          </Field>
        </div>
        <span className="field-label">Unterlagen ({files.length})</span>
        {files.length ? (
          <ul className="app-files">
            {files.map((f) => (
              <li key={f.id}>
                <button type="button" className="link" onClick={() => openDoc(f)}>
                  <Icon name={(f.contentType || '').startsWith('image/') ? 'image' : 'file'} size={14} /> {f.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">Keine Unterlagen – der Assistent arbeitet dann mit dem, was für diesen Antrag üblich ist.</p>
        )}
        <FilePick small onFiles={addFiles} />
        {(a.qa || []).length ? (
          <details className="small app-qa">
            <summary>Deine bisherigen Antworten ({a.qa.length})</summary>
            <ul>
              {a.qa.map((q) => (
                <li key={q.id}>
                  {q.question} – <b>{q.skip ? 'trägst du selbst ein' : q.answer}</b>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Section>
    </Drawer>
  );
}

// in the project's funding tab: its applications and a quick start
export function ProjectApplications({ p, data }) {
  const [creating, setCreating] = useState(false);
  const list = applications(data).filter((d) => d.projectId === p.id);
  return (
    <Section title="Anträge" aside={!creating ? <Btn small icon="flag" onClick={() => setCreating(true)}>Antrag vorbereiten</Btn> : null}>
      {creating ? <NewApplication data={data} projectId={p.id} onClose={() => setCreating(false)} /> : null}
      {list.map((d) => (
        <AppCard key={d.id} d={d} data={data} />
      ))}
      {!list.length && !creating ? <p className="small muted">Lade das Antragsformular hoch – der Antragsassistent füllt es mit den Angaben aus diesem Projekt und der Bauakte aus und fragt dich nur nach dem Rest.</p> : null}
    </Section>
  );
}
