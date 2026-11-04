// Spoken notes prepared by the AI: clean text, and whether they record an appointment (which one, when,
// who was there, what was decided). Runs right after a note is saved and once for older spoken notes.
import { getState, updateDoc } from './store.js';
import { aiNote, aiMeeting, aiErrorText, getSample } from './ai.js';
import { applyMeetingAi, autoTitle } from './actions.js';
import { toast } from './ui/state.js';

const running = new Set();
const subs = new Set();
const notify = () => subs.forEach((f) => f());

export const isPreparing = (key) => running.has(key);
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
        const auto = !x.titleManual && (!x.title || x.title === autoTitle(String(x.text || '').trim()) || x.title === x.ai?.title);
        return { ...x, ai, aiSkip: false, title: auto && ai.title ? ai.title : x.title, updatedAt: Date.now() };
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
