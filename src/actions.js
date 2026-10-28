// Mutations shared by several views (and by the AI assistant's tools).
import { putDoc, updateDoc, getState, deleteDoc } from './store.js';
import { uid, todayISO, addDays, parseISO, toISO, diffDays } from './util.js';
import { projectKind, PROJECT_KINDS, CONSTRAINT_KINDS, FUNDING_TYPES } from './catalog.js';

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
    ai: {},
    createdAt: Date.now(),
  };
  putDoc('projects', id, doc, 50);
  return id;
}

export const patchProject = (id, fn) => updateDoc('projects', id, fn);

export function deleteProject(id) {
  const s = getState();
  for (const p of Object.values(s.projects))
    if ((p.dependsOn || []).includes(id)) updateDoc('projects', p.id, (x) => ({ ...x, dependsOn: x.dependsOn.filter((d) => d !== id) }), 50);
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

export function addMilestone(projectId, title, date) {
  patchProject(projectId, (p) => ({ ...p, milestones: [...(p.milestones || []), { id: uid('m'), title, date: date || null, done: false }] }));
}

// Shifts a project to start right after its latest dependency, keeping its duration.
export function alignToDependencies(id) {
  const s = getState();
  const p = s.projects[id];
  if (!p) return false;
  const ends = (p.dependsOn || []).map((d) => s.projects[d]?.end).filter(Boolean).sort();
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
