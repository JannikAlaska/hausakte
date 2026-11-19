// Application assistant: an application (Förderantrag, Bauantrag, Anmeldung …) is a document of type "antrag"
// without a file; its data lives in doc.app. The uploaded forms are documents of type "formular" with appId.
// The AI fills the fields from the house file, asks only what it cannot find, and remembers the answers
// for later applications.
import { getState, putDoc, updateDoc, deleteDoc, getAssets } from './store.js';
import { uid, todayISO } from './util.js';

export const APP_STATUS = [
  { key: 'entwurf', name: 'Entwurf', tone: 'neutral' },
  { key: 'fragen', name: 'Fragen offen', tone: 'warn' },
  { key: 'bereit', name: 'Bereit zum Einreichen', tone: 'accent' },
  { key: 'eingereicht', name: 'Eingereicht', tone: 'info' },
  { key: 'bewilligt', name: 'Bewilligt', tone: 'accent' },
  { key: 'abgelehnt', name: 'Abgelehnt', tone: 'danger' },
];
export const appStatus = (k) => APP_STATUS.find((s) => s.key === k) || APP_STATUS[0];
export const MANUAL_STATUS = ['eingereicht', 'bewilligt', 'abgelehnt'];

export const isApplication = (d) => d?.type === 'antrag';
export const appOf = (d) => d?.app || {};
export const applications = (data = getState()) =>
  Object.values(data.documents || {})
    .filter(isApplication)
    .sort((a, b) => (b.app?.updatedAt || 0) - (a.app?.updatedAt || 0));
export const appFiles = (d, data = getState()) => (appOf(d).files || []).map((id) => data.documents?.[id]).filter(Boolean);

// field key that stays the same when the AI numbers its fields differently
export const fieldKey = (f) => `${f.section || ''}|${f.label || ''}`.toLowerCase();

// fields with the user's corrections applied
export function appFields(d) {
  const a = appOf(d);
  const edits = a.edits || {};
  return (a.analysis?.fields || []).map((f) => {
    const k = fieldKey(f);
    if (edits[k] != null) return { ...f, value: edits[k], source: 'antwort', status: edits[k] ? 'ok' : 'offen', edited: true };
    return f;
  });
}

export function appProgress(d) {
  const fields = appFields(d);
  const done = fields.filter((f) => String(f.value ?? '').trim() && f.status !== 'offen').length;
  const self = fields.filter((f) => f.self).length;
  return { fields: fields.length, done, self, open: (appOf(d).open || []).length };
}

// status that follows from the work done (manual statuses stay)
export function autoStatus(a) {
  if (MANUAL_STATUS.includes(a.status)) return a.status;
  if (!a.analysis) return 'entwurf';
  return (a.open || []).length ? 'fragen' : 'bereit';
}

export const setApp = (id, fn, delay = 300) =>
  updateDoc('documents', id, (d) => {
    const app = typeof fn === 'function' ? fn(d.app || {}) : { ...(d.app || {}), ...fn };
    return { ...d, name: app.title || d.name, app: { ...app, status: autoStatus(app), updatedAt: Date.now() } };
  }, delay);

export function createApplication({ goal, projectId = null, files = [] }) {
  const id = uid('d-');
  const title = String(goal || '').trim().split('\n')[0].slice(0, 80) || 'Neuer Antrag';
  putDoc('documents', id, { id, type: 'antrag', noFile: true, name: title, date: todayISO(), projectId, notes: '', app: { goal: String(goal || '').trim(), title, status: 'entwurf', files, qa: [], open: [], edits: {}, createdAt: Date.now(), updatedAt: Date.now() } }, 50);
  return id;
}

export async function deleteApplication(d, { withFiles = true } = {}) {
  if (withFiles)
    for (const f of appFiles(d)) {
      if (f.assetId) {
        try {
          await (await getAssets())?.delete(f.assetId);
        } catch {}
      }
      deleteDoc('documents', f.id);
    }
  deleteDoc('documents', d.id);
}

// answers given in earlier applications (to be reused, not asked again)
export function knownAnswers(data = getState(), exceptId = null) {
  const out = [];
  for (const d of applications(data)) {
    if (d.id === exceptId) continue;
    for (const q of appOf(d).qa || []) if (!q.skip && String(q.answer ?? '').trim()) out.push({ question: q.question, answer: q.answer, from: appOf(d).title || d.name, at: q.at || 0 });
  }
  // newest first, each question once
  const seen = new Set();
  return out
    .sort((a, b) => b.at - a.at)
    .filter((x) => {
      const k = x.question.toLowerCase().replace(/\W+/g, ' ').trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 60);
}
