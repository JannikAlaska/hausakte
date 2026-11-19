// Runs the application assistant: reads the uploaded papers, fills the fields from the house file and asks
// only what is missing; answers are worked in by a second, cheaper round without the files.
import { getState, fileUrl } from './store.js';
import { aiApplication, aiErrorText } from './ai.js';
import { appOf, appFiles, setApp, knownAnswers } from './applications.js';
import { status as statusOf } from './catalog.js';
import { uid, isISO } from './util.js';
import { toast } from './ui/state.js';

const running = new Set();
const subs = new Set();
const notify = () => subs.forEach((f) => f());
export const isRunning = (id) => running.has(id);
export const subscribeRuns = (fn) => (subs.add(fn), () => subs.delete(fn));

const s = (v, n = 300) => String(v ?? '').trim().slice(0, n);
const arr = (v) => (Array.isArray(v) ? v : []);
const normQ = (q) => String(q || '').toLowerCase().replace(/[^a-zäöüß0-9]+/g, ' ').trim();

// a signed file address arrives a moment after it is requested
async function blobOf(doc) {
  for (let i = 0; i < 25; i++) {
    const url = fileUrl(doc);
    if (url) {
      const b = await (await fetch(url)).blob();
      return b.type ? b : new Blob([b], { type: doc.contentType || 'application/octet-stream' });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw { code: 'file_missing' };
}

function normalize(r, data) {
  const docs = data.documents || {};
  const fields = arr(r.fields)
    .slice(0, 160)
    .map((f) => {
      const value = s(f.value, 600);
      return {
        section: s(f.section, 80) || 'Allgemein',
        label: s(f.label, 140) || 'Feld',
        value,
        source: ['bauakte', 'antwort', 'frueher', 'dokument', 'offen'].includes(f.source) ? f.source : value ? 'bauakte' : 'offen',
        sourceNote: s(f.sourceNote, 160),
        status: ['ok', 'unsicher', 'offen'].includes(f.status) ? f.status : value ? 'ok' : 'offen',
        self: !!f.self,
        hint: s(f.hint, 220),
      };
    });
  const questions = arr(r.questions)
    .slice(0, 12)
    .map((q) => ({ id: uid('q'), question: s(q.question, 300), why: s(q.why, 200), type: ['text', 'zahl', 'datum', 'auswahl', 'janein'].includes(q.type) ? q.type : 'text', options: arr(q.options).map((o) => s(o, 90)).filter(Boolean).slice(0, 12), fields: arr(q.fields).map((x) => s(x, 140)).slice(0, 8) }))
    .filter((q) => q.question);
  const analysis = {
    at: Date.now(),
    title: s(r.title, 90),
    authority: s(r.authority, 120),
    program: s(r.program, 160),
    deadline: isISO(r.deadline) ? r.deadline : null,
    deadlineNote: s(r.deadlineNote, 200),
    summary: s(r.summary, 700),
    fields,
    attachments: arr(r.attachments)
      .slice(0, 30)
      .map((a) => ({ label: s(a.label, 160), required: a.required !== false, docId: a.docId && docs[a.docId] ? a.docId : null, note: s(a.note, 220) }))
      .filter((a) => a.label),
    steps: arr(r.steps)
      .slice(0, 15)
      .map((x) => ({ text: s(x.text, 260), due: isISO(x.due) ? x.due : null }))
      .filter((x) => x.text),
    warnings: arr(r.warnings).map((w) => s(w, 300)).filter(Boolean).slice(0, 8),
    funding: r.funding && ['zuschuss', 'kredit', 'steuer', 'sonstiges'].includes(r.funding.type) ? { type: r.funding.type, amount: Number.isFinite(Number(r.funding.amount)) && r.funding.amount ? Math.round(Number(r.funding.amount)) : null } : null,
  };
  return { analysis, questions };
}

// files: File objects right after upload (else the stored files are loaded when needed)
export async function runApplication(id, { files = null, withFiles = null } = {}) {
  if (running.has(id)) return false;
  const data0 = getState();
  const d = data0.documents?.[id];
  if (!d) return false;
  const a = appOf(d);
  const needFiles = files ? true : withFiles ?? (!a.analysis || (a.filesAt || 0) > (a.analysis?.at || 0));
  running.add(id);
  notify();
  try {
    const blobs = files || (needFiles ? await Promise.all(appFiles(d, data0).map(blobOf)) : []);
    const data = getState();
    const cur = appOf(data.documents[id]);
    const docs = Object.values(data.documents || {})
      .filter((x) => x.type !== 'antrag' && x.id !== id)
      .sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')))
      .slice(0, 160)
      .map((x) => `[${x.id}] ${x.name} (${x.type}${x.appId === id ? ', zu diesem Antrag hochgeladen' : ''}${x.date ? `, ${x.date}` : ''}${x.projectId && data.projects?.[x.projectId] ? `, Projekt ${data.projects[x.projectId].title}` : ''})${x.ai?.data?.summary ? ` – ${String(x.ai.data.summary).slice(0, 140)}` : x.inv?.summary ? ` – ${String(x.inv.summary).slice(0, 140)}` : ''}`)
      .join('\n');
    const p = d.projectId ? data.projects?.[d.projectId] : null;
    const { at, ...prev } = cur.analysis || {};
    const r = await aiApplication(
      blobs,
      { goal: cur.goal, extra: cur.extra, prev: cur.analysis ? prev : null, qa: cur.qa, edits: cur.edits, known: knownAnswers(data, id), docs, project: p ? `${p.title} (${statusOf(p.status).name}${p.start ? `, ${p.start} bis ${p.end || 'offen'}` : ''})` : null },
      data,
    );
    const { analysis, questions } = normalize(r || {}, getState());
    setApp(
      id,
      (x) => {
        const asked = new Set((x.qa || []).map((q) => normQ(q.question)));
        const open = questions.filter((q) => !asked.has(normQ(q.question)));
        return { ...x, title: x.titleManual ? x.title : analysis.title || x.title, analysis, open };
      },
      50,
    );
    const n = appOf(getState().documents[id]).open?.length || 0;
    toast(n ? `Antrag vorbereitet – ${n} Frage${n === 1 ? '' : 'n'} an dich` : 'Antrag vorbereitet – alles aus der Bauakte ausgefüllt', 'ok', 5000);
    return true;
  } catch (e) {
    if (e?.code !== 'cancelled') toast('Der Antragsassistent konnte nicht arbeiten: ' + aiErrorText(e), 'warn', 7000);
    return false;
  } finally {
    running.delete(id);
    notify();
  }
}

// answers: { questionId: { value, skip } } – answered questions move into qa, then the fields are updated
export function answerQuestions(id, answers) {
  let n = 0;
  setApp(
    id,
    (x) => {
      const qa = [...(x.qa || [])];
      const open = [];
      for (const q of x.open || []) {
        const a = answers[q.id];
        const val = String(a?.value ?? '').trim();
        if (a && (a.skip || val)) {
          qa.push({ id: q.id, question: q.question, answer: a.skip ? '' : val, skip: !!a.skip, fields: q.fields, at: Date.now() });
          n++;
        } else open.push(q);
      }
      return { ...x, qa, open };
    },
    50,
  );
  if (n) runApplication(id, { withFiles: false });
  return n;
}
