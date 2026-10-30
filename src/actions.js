// Mutations shared by several views (and by the AI assistant's tools).
import { putDoc, updateDoc, getState, deleteDoc } from './store.js';
import { uid, todayISO, addDays, parseISO, toISO, diffDays } from './util.js';
import { projectKind, PROJECT_KINDS, CONSTRAINT_KINDS, FUNDING_TYPES } from './catalog.js';
import { resolveRef } from './metrics.js';

export function nextMonday(iso, minDays = 0) {
  const d = parseISO(addDays(iso, minDays));
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return toISO(d);
}

export function createProject(preset = {}) {
  const id = uid('p-');
  const start = preset.start || nextMonday(todayISO(), 28);
  const kind = PROJECT_KINDS.some((k) => k.key === preset.kind) ? preset.kind : 'sonstiges';
  const doc = {
    id,
    title: preset.title || projectKind(kind).name,
    kind,
    status: preset.status || 'idee',
    priority: preset.priority || 2,
    start,
    end: preset.end || addDays(start, 18),
    dependsOn: preset.dependsOn || [],
    milestones: preset.milestones || [],
    constraints: preset.constraints || [],
    costs: preset.costs || [],
    funding: preset.funding || [],
    components: preset.components || [],
    notes: preset.notes || '',
    hints: preset.hints || '',
    ai: {},
    createdAt: Date.now(),
  };
  putDoc('projects', id, doc, 50);
  return id;
}

export const patchProject = (id, fn) => updateDoc('projects', id, fn);

// removes references matching `drop` (project dependencies and milestone dependencies) from all projects
function dropRefs(drop, exceptId) {
  for (const p of Object.values(getState().projects)) {
    if (p.id === exceptId) continue;
    const hit = (p.dependsOn || []).some(drop) || (p.milestones || []).some((m) => (m.dependsOn || []).some(drop));
    if (hit)
      updateDoc('projects', p.id, (x) => ({
        ...x,
        dependsOn: (x.dependsOn || []).filter((r) => !drop(r)),
        milestones: (x.milestones || []).map((m) => (m.dependsOn?.some(drop) ? { ...m, dependsOn: m.dependsOn.filter((r) => !drop(r)) } : m)),
      }), 50);
  }
}

export const archiveProject = (id, on = true) => patchProject(id, (p) => ({ ...p, archived: on, archivedAt: on ? Date.now() : null }));

// only deactivated projects can be deleted
export function deleteProject(id) {
  const s = getState();
  if (!s.projects[id]?.archived) return false;
  dropRefs((r) => r === id || String(r).startsWith(id + '#'), id);
  for (const d of Object.values(s.documents)) if (d.projectId === id) updateDoc('documents', d.id, (x) => ({ ...x, projectId: null }), 50);
  deleteDoc('projects', id);
}

export function addFunding(projectId, f) {
  const entry = {
    id: uid('g'),
    program: f.program || f.name || 'Förderung',
    provider: f.provider || '',
    type: FUNDING_TYPES.some((t) => t.key === f.type) ? f.type : 'zuschuss',
    rate: f.rate ?? null,
    amount: f.amount ?? null,
    deadline: f.deadline || f.applyBy || null,
    status: f.status || 'pruefen',
    notes: f.notes || [f.timing, f.combinable, ...(f.conditions || [])].filter(Boolean).join(' · '),
    url: f.url || null,
    source: f.source || 'manuell',
  };
  patchProject(projectId, (p) => ({ ...p, funding: [...(p.funding || []), entry] }));
  return entry.id;
}

export function addCost(projectId, c) {
  const entry = { id: uid('k'), label: c.label || 'Position', estimate: c.estimate ?? null, offer: c.offer ?? null, actual: c.actual ?? null, vendor: c.vendor || '', note: c.note || '' };
  patchProject(projectId, (p) => ({ ...p, costs: [...(p.costs || []), entry] }));
}

export function addConstraint(projectId, text, kind = 'organisatorisch') {
  const k = CONSTRAINT_KINDS.some((x) => x.key === kind) ? kind : 'organisatorisch';
  patchProject(projectId, (p) => ({ ...p, constraints: [...(p.constraints || []), { id: uid('b'), text, kind: k, done: false }] }));
}

export function addMilestone(projectId, title, date, dependsOn = []) {
  const id = uid('m');
  patchProject(projectId, (p) => ({ ...p, milestones: [...(p.milestones || []), { id, title, date: date || null, done: false, dependsOn }] }));
  return id;
}

export function deleteMilestone(projectId, mid) {
  const ref = `${projectId}#${mid}`;
  patchProject(projectId, (p) => ({
    ...p,
    dependsOn: (p.dependsOn || []).filter((r) => r !== ref),
    milestones: (p.milestones || []).filter((m) => m.id !== mid).map((m) => (m.dependsOn?.includes(ref) ? { ...m, dependsOn: m.dependsOn.filter((r) => r !== ref) } : m)),
  }));
  dropRefs((r) => r === ref, projectId);
}

// Moves a milestone to the day after its latest dependency.
export function alignMilestone(projectId, mid) {
  const s = getState();
  const m = (s.projects[projectId]?.milestones || []).find((x) => x.id === mid);
  const dates = (m?.dependsOn || []).map((r) => resolveRef(s.projects, r)?.date).filter(Boolean).sort();
  if (!dates.length) return false;
  const date = addDays(dates[dates.length - 1], 1);
  patchProject(projectId, (p) => ({ ...p, milestones: p.milestones.map((x) => (x.id === mid ? { ...x, date } : x)) }));
  return true;
}

// Shifts a project to start right after its latest dependency, keeping its duration.
export function alignToDependencies(id) {
  const s = getState();
  const p = s.projects[id];
  if (!p) return false;
  const ends = (p.dependsOn || []).map((r) => resolveRef(s.projects, r)?.date).filter(Boolean).sort();
  if (!ends.length) return false;
  const dur = p.start && p.end ? diffDays(p.start, p.end) : 14;
  const start = nextMonday(ends[ends.length - 1], 1);
  patchProject(id, (x) => ({ ...x, start, end: addDays(start, dur) }));
  return true;
}

export function createComponent(preset = {}) {
  const id = uid('c-');
  putDoc('components', id, {
    id, gewerk: preset.gewerk || 'rohbau', name: preset.name || 'Neues Bauteil', material: preset.material || '', year: preset.year ?? null,
    life: preset.life ?? null, condition: preset.condition ?? null, maker: preset.maker || '', model: preset.model || '', qty: preset.qty ?? null, unit: preset.unit || '',
    uValue: preset.uValue ?? null, floorId: preset.floorId || null, roomId: preset.roomId || null, notes: preset.notes || '', photo: preset.photo || null,
  }, 50);
  return id;
}

export function addReading(r) {
  const id = uid('v-');
  putDoc('readings', id, { id, medium: r.medium || 'strom', from: r.from, to: r.to, amount: r.amount ?? null, cost: r.cost ?? null, note: r.note || '' }, 50);
  return id;
}

// Stores a meeting note on a project and adds the appointments as milestones and the to-dos as tasks.
// r: { title, date, participants, summary, points, decisions, openQuestions, appointments, todos, costs }
export function addMeeting(projectId, r, { transcript = '', date, source = 'ki' } = {}) {
  const iso = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const txt = (v, n = 300) => String(v ?? '').trim().slice(0, n);
  const list = (v, n = 20) => (Array.isArray(v) ? v.map((x) => txt(x, 400)).filter(Boolean).slice(0, n) : []);
  const id = uid('mt');
  const milestones = (Array.isArray(r.appointments) ? r.appointments : [])
    .filter((a) => a && txt(a.title))
    .slice(0, 12)
    .map((a) => ({ id: uid('m'), title: txt(a.title, 160), date: iso(a.date), time: /^\d{1,2}:\d{2}$/.test(a.time || '') ? a.time.padStart(5, '0') : null, note: txt(a.note, 300), done: false, dependsOn: [], meetingId: id }));
  const kinds = CONSTRAINT_KINDS.map((k) => k.key);
  const todos = (Array.isArray(r.todos) ? r.todos : [])
    .filter((t) => t && txt(t.text))
    .slice(0, 20)
    .map((t) => ({ id: uid('b'), text: txt(t.text, 240), kind: kinds.includes(t.kind) ? t.kind : 'organisatorisch', done: false, due: iso(t.due), who: txt(t.who, 60), meetingId: id }));
  const meeting = {
    id,
    date: iso(r.date) || iso(date) || todayISO(),
    title: txt(r.title, 140) || 'Besprechung',
    participants: list(r.participants, 10),
    summary: txt(r.summary, 2000),
    points: list(r.points),
    decisions: list(r.decisions),
    openQuestions: list(r.openQuestions),
    costs: (Array.isArray(r.costs) ? r.costs : []).filter((c) => c && txt(c.label) && Number(c.amount) > 0).slice(0, 10).map((c) => ({ label: txt(c.label, 120), amount: Math.round(Number(c.amount)) })),
    transcript: txt(transcript, 60000),
    milestoneIds: milestones.map((m) => m.id),
    todoIds: todos.map((t) => t.id),
    source,
    createdAt: Date.now(),
  };
  patchProject(projectId, (p) => ({ ...p, meetings: [meeting, ...(p.meetings || [])], milestones: [...(p.milestones || []), ...milestones], constraints: [...(p.constraints || []), ...todos] }));
  return { id, milestones: milestones.length, todos: todos.length };
}
