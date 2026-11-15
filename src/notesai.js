// Spoken notes prepared by the AI: clean text, and whether they record an appointment (which one, when,
// who was there, what was decided). Runs right after a note is saved and once for older spoken notes.
import { getState, updateDoc, putDoc, deleteDoc, getAssets } from './store.js';
import { aiNote, aiMeeting, aiHandwriting, aiErrorText, getSample } from './ai.js';
import { applyMeetingAi, autoTitle, patchProject } from './actions.js';
import { decodeInk, renderInk } from './ink.js';
import { uid, todayISO } from './util.js';
import { toast } from './ui/state.js';

const running = new Set();
const reading = new Set(); // handwriting being read by the AI
const subs = new Set();
const notify = () => subs.forEach((f) => f());

export const isPreparing = (key) => running.has(key);
export const isReading = (key) => reading.has(key);
export function usePreparing() {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return isPreparing;
}

const iso = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const txt = (v, n = 400) => String(v ?? '').trim().slice(0, n);
const list = (v, n = 20) => (Array.isArray(v) ? v.map((x) => txt(x)).filter(Boolean).slice(0, n) : []);

// AI answer -> what is stored on the note (note.ai)
function noteAi(r, d) {
  const contacts = d.contacts || {};
  const m = r.isMeeting && r.meeting ? r.meeting : null;
  const project = r.projectId && d.projects?.[r.projectId] && !d.projects[r.projectId].archived ? r.projectId : null;
  return {
    at: Date.now(),
    title: txt(r.title, 140),
    text: txt(r.text, 20000),
    isMeeting: !!m,
    meeting: m
      ? {
          what: txt(m.what, 200),
          date: iso(m.date),
          time: /^\d{1,2}:\d{2}$/.test(m.time || '') ? m.time.padStart(5, '0') : null,
          participants: list(m.participants, 12),
          contactIds: (Array.isArray(m.contactIds) ? m.contactIds : []).filter((id) => contacts[id]).slice(0, 12),
          decisions: list(m.decisions),
        }
      : null,
    openQuestions: list(r.openQuestions),
    nextSteps: (Array.isArray(r.nextSteps) ? r.nextSteps : [])
      .filter((x) => x && txt(x.text))
      .slice(0, 15)
      .map((x) => ({ text: txt(x.text, 240), date: iso(x.date), who: txt(x.who, 60) || null })),
    projectId: project,
  };
}

// general note
export async function prepareNote(id, { quiet = false } = {}) {
  const key = 'note:' + id;
  if (running.has(key)) return false;
  const d0 = getState();
  const n = d0.notes?.[id];
  if (!n || !String(n.text || '').trim()) return false;
  running.add(key);
  notify();
  try {
    const r = await aiNote(n.text, d0, { date: n.date });
    const d = getState();
    const ai = noteAi(r, d);
    updateDoc(
      'notes',
      id,
      (x) => {
        // a title the user typed stays; an automatic one is replaced by the AI's
        const auto = !x.titleManual && (x.titleAuto || !x.title || x.title === autoTitle(String(x.text || '').trim()) || x.title === x.ai?.title);
        return { ...x, ai, aiSkip: false, title: auto && ai.title ? ai.title : x.title, titleAuto: false, updatedAt: Date.now() };
      },
      50,
    );
    if (!quiet) toast(ai.isMeeting ? `Notiz aufbereitet – Termin erkannt: ${ai.meeting.what || ai.title}` : 'Notiz von der KI aufbereitet');
    return true;
  } catch (e) {
    if (!quiet && e?.code !== 'cancelled') toast('Die KI konnte die Notiz nicht aufbereiten: ' + aiErrorText(e), 'warn', 6000);
    return false;
  } finally {
    running.delete(key);
    notify();
  }
}

// meeting note of a project
export async function prepareMeeting(projectId, meetingId, { derive = true, quiet = false } = {}) {
  const key = 'meeting:' + meetingId;
  if (running.has(key)) return false;
  const d = getState();
  const p = d.projects?.[projectId];
  const m = p?.meetings?.find((x) => x.id === meetingId);
  if (!m || !String(m.transcript || '').trim()) return false;
  running.add(key);
  notify();
  try {
    const r = await aiMeeting(p, m.transcript, d, { date: m.date });
    const res = applyMeetingAi(projectId, meetingId, r, { derive });
    if (!quiet)
      toast(
        `Besprechung aufbereitet${r.isMeeting === false ? '' : ' – Termin erkannt'}${res.milestones ? ` · ${res.milestones} Termin${res.milestones > 1 ? 'e' : ''} eingetragen` : ''}${res.todos ? ` · ${res.todos} To-do${res.todos > 1 ? 's' : ''}` : ''}`,
      );
    return true;
  } catch (e) {
    if (!quiet && e?.code !== 'cancelled') toast('Die KI konnte die Besprechung nicht aufbereiten: ' + aiErrorText(e), 'warn', 6000);
    return false;
  } finally {
    running.delete(key);
    notify();
  }
}

// once: older spoken notes that were never prepared (project meetings without new tasks)
let backfilled = false;
export async function prepareOlderNotes() {
  if (backfilled) return;
  backfilled = true;
  if (!(await getSample().catch(() => null))) return;
  const d = getState();
  const notes = Object.values(d.notes || {}).filter((n) => n.source === 'sprache' && !n.ai && !n.aiSkip && String(n.text || '').trim().length >= 10);
  const meetings = Object.values(d.projects || {}).flatMap((p) =>
    (p.meetings || []).filter((m) => !m.ai && !m.aiSkip && !m.summary && !(m.points || []).length && String(m.transcript || '').trim().length >= 10).map((m) => [p.id, m.id]),
  );
  let done = 0;
  for (const n of notes) if (await prepareNote(n.id, { quiet: true })) done++;
  for (const [pid, mid] of meetings) if (await prepareMeeting(pid, mid, { derive: false, quiet: true })) done++;
  if (done) toast(`${done} ältere ${done === 1 ? 'Notiz wurde' : 'Notizen wurden'} von der KI aufbereitet.`, 'ok', 5000);
}

// ---------- handwriting ----------
// The handwriting lives in a document of type "handschrift" (strokes + rendered image + preview);
// a note or a project meeting points to it with inkDoc.
// store: (file) -> {assetId|dataUrl, contentType, size} (documents.jsx storeFile)
export async function saveInkDoc({ ink, strokes, docId = null, meta = {}, store }) {
  const r = await renderInk(strokes);
  const stored = r?.blob ? await store(r.blob) : null;
  const id = docId || uid('d-');
  const prev = getState().documents?.[id];
  if (prev?.assetId && stored?.assetId && prev.assetId !== stored.assetId) {
    try {
      await (await getAssets())?.delete(prev.assetId);
    } catch {}
  }
  putDoc(
    'documents',
    id,
    {
      ...(prev || {}),
      id,
      type: 'handschrift',
      name: meta.name || prev?.name || 'Handschriftliche Notiz',
      date: meta.date || prev?.date || todayISO(),
      projectId: meta.projectId !== undefined ? meta.projectId : prev?.projectId ?? null,
      noteId: meta.noteId !== undefined ? meta.noteId : prev?.noteId ?? null,
      meetingId: meta.meetingId !== undefined ? meta.meetingId : prev?.meetingId ?? null,
      notes: prev?.notes || '',
      ink,
      thumb: r?.thumb || null,
      contentType: 'image/jpeg',
      ...(stored ? { assetId: stored.assetId || null, dataUrl: stored.dataUrl || null, size: stored.size } : {}),
      updatedAt: Date.now(),
    },
    50,
  );
  return id;
}

export async function deleteInkDoc(id) {
  const d = id && getState().documents?.[id];
  if (!d) return;
  if (d.assetId) {
    try {
      await (await getAssets())?.delete(d.assetId);
    } catch {}
  }
  deleteDoc('documents', id);
}

async function readInk(docId, context) {
  const doc = getState().documents?.[docId];
  if (!doc?.ink) throw { code: 'file_missing' };
  const r = await renderInk(decodeInk(doc.ink).strokes);
  if (!r?.blob) return { text: '', title: '', confidence: 'niedrig', unclear: [] };
  const a = await aiHandwriting(r.blob, getState(), { context });
  return {
    text: String(a?.text || '').trim().slice(0, 20000),
    title: String(a?.title || '').trim().slice(0, 140),
    confidence: ['hoch', 'mittel', 'niedrig'].includes(a?.confidence) ? a.confidence : 'mittel',
    unclear: (Array.isArray(a?.unclear) ? a.unclear : []).map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, 8),
  };
}

// general note: handwriting -> text, then the usual preparation (title, appointment, next steps)
export async function transcribeNote(id, { quiet = false, prepare = true } = {}) {
  const key = 'note:' + id;
  if (running.has(key)) return false;
  const n = getState().notes?.[id];
  if (!n?.inkDoc) return false;
  running.add(key);
  reading.add(key);
  notify();
  let text = '';
  try {
    const r = await readInk(n.inkDoc);
    text = r.text;
    updateDoc(
      'notes',
      id,
      (x) => ({ ...x, text, title: x.titleManual ? x.title : r.title || autoTitle(text) || 'Handschriftliche Notiz', titleAuto: !x.titleManual, ai: null, hw: { at: Date.now(), confidence: r.confidence, unclear: r.unclear }, updatedAt: Date.now() }),
      50,
    );
    if (!text && !quiet) toast('Die KI konnte in der Handschrift nichts lesen.', 'warn', 5000);
  } catch (e) {
    if (!quiet && e?.code !== 'cancelled') toast('Die KI konnte die Handschrift nicht lesen: ' + aiErrorText(e), 'warn', 6000);
    return false;
  } finally {
    running.delete(key);
    reading.delete(key);
    notify();
  }
  if (prepare && text.length >= 10) await prepareNote(id, { quiet });
  else if (!quiet && text) toast('Handschrift in Text umgewandelt');
  return true;
}

// project meeting written by hand: handwriting -> transcript, then the meeting preparation (dates, to-dos …)
export async function transcribeMeeting(projectId, meetingId, { quiet = false, derive = true } = {}) {
  const key = 'meeting:' + meetingId;
  if (running.has(key)) return false;
  const p = getState().projects?.[projectId];
  const m = p?.meetings?.find((x) => x.id === meetingId);
  if (!m?.inkDoc) return false;
  running.add(key);
  reading.add(key);
  notify();
  let text = '';
  try {
    const r = await readInk(m.inkDoc, `Besprechung zum Projekt „${p.title}“`);
    text = r.text;
    patchProject(projectId, (x) => ({ ...x, meetings: (x.meetings || []).map((y) => (y.id === meetingId ? { ...y, transcript: text, title: y.ai ? y.title : r.title || y.title, hw: { at: Date.now(), confidence: r.confidence, unclear: r.unclear } } : y)) }));
    if (!text && !quiet) toast('Die KI konnte in der Handschrift nichts lesen.', 'warn', 5000);
  } catch (e) {
    if (!quiet && e?.code !== 'cancelled') toast('Die KI konnte die Handschrift nicht lesen: ' + aiErrorText(e), 'warn', 6000);
    return false;
  } finally {
    running.delete(key);
    reading.delete(key);
    notify();
  }
  if (text.length >= 10) await prepareMeeting(projectId, meetingId, { derive, quiet });
  return true;
}
