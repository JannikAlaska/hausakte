// Derived building figures, component wear, project costs and schedule checks.

import { polyArea, polyPerimeter, outerOutline, openingArea } from './geometry.js';
import { roomType, medium, energyClass, status as statusOf } from './catalog.js';
import { pvPotential, roofModel } from './roof.js';
import { todayISO, parseISO } from './util.js';

export const sortFloors = (floors) => [...floors].sort((a, b) => a.elevation - b.elevation);

export function roomArea(room) {
  if (room.area != null && room.area !== '') return Number(room.area);
  const a = Math.abs(polyArea(room.poly || []));
  return a * (roomType(room.type).factor ?? 1);
}

export function floorStats(floor) {
  const outline = outerOutline(floor.walls || []);
  const gross = outline ? Math.abs(polyArea(outline)) : 0;
  const rooms = floor.rooms || [];
  // basements do not count towards living area (WoFlV)
  const basement = (floor.elevation ?? 0) <= -1.0;
  const living = basement ? 0 : rooms.filter((r) => roomType(r.type).living).reduce((s, r) => s + roomArea(r), 0);
  const usable = rooms.reduce((s, r) => s + roomArea(r), 0);
  const ext = (floor.walls || []).filter((w) => w.ext);
  const windowArea = ext.reduce((s, w) => s + openingArea(w, 'window') + openingArea(w, 'door'), 0);
  const perimeter = outline ? polyPerimeter(outline) : 0;
  const windows = ext.reduce((s, w) => s + (w.openings || []).filter((o) => o.type === 'window').length, 0);
  return { outline, gross, living, usable, windowArea, perimeter, windows, roomCount: rooms.length };
}

export function buildingStats(house, floors) {
  const fl = sortFloors(floors || []);
  const per = fl.map((f) => ({ floor: f, ...floorStats(f) }));
  const ground = house?.model?.groundLevel ?? 0;
  const living = per.reduce((s, p) => s + p.living, 0);
  const usable = per.reduce((s, p) => s + p.usable, 0);
  const gross = per.reduce((s, p) => s + p.gross, 0);
  const windowArea = per.reduce((s, p) => s + p.windowArea, 0);
  const windows = per.reduce((s, p) => s + p.windows, 0);
  let facade = 0;
  for (const p of per) {
    const top = p.floor.elevation + p.floor.height;
    const visible = Math.max(0, top - Math.max(ground, p.floor.elevation));
    facade += p.perimeter * visible;
  }
  const roofs = roofModel(house, fl);
  const roofArea = roofs.reduce((s, r) => s + r.geo.slopes.reduce((a, sl) => a + sl.area, 0), 0);
  const pv = pvPotential(house, fl);
  const pvGood = pv.filter((p) => p.factor >= 0.8 && p.modules > 0);
  const volume = per.reduce((s, p) => s + p.gross * p.floor.height, 0);
  return {
    perFloor: per,
    living: house?.livingAreaOverride ?? living,
    livingComputed: living,
    usable,
    gross,
    windowArea,
    windows,
    facadeOpaque: Math.max(0, facade - windowArea),
    facadeGross: facade,
    roofArea,
    roofs,
    pv,
    pvKwp: pvGood.reduce((s, p) => s + p.kwp, 0),
    pvKwh: pvGood.reduce((s, p) => s + p.kwhYear, 0),
    volume,
  };
}

// ---------- components ----------
export function componentWear(c, year = new Date().getFullYear()) {
  if (!c.year) return { age: null, remaining: null, state: 'unbekannt', ratio: null, due: null };
  const age = year - Number(c.year);
  if (!c.life) return { age, remaining: null, state: 'ok', ratio: null, due: null };
  const remaining = Number(c.life) - age;
  const ratio = Math.max(0, Math.min(1.2, age / Number(c.life)));
  const state = remaining <= 0 ? 'faellig' : remaining <= 5 ? 'bald' : 'ok';
  return { age, remaining, state, ratio, due: Number(c.year) + Number(c.life) };
}

// ---------- projects ----------
export const costValue = (k) => (k.actual ?? null) != null ? Number(k.actual) : (k.offer ?? null) != null ? Number(k.offer) : Number(k.estimate) || 0;

export function projectCost(p) {
  const items = p.costs || [];
  const est = items.reduce((s, k) => s + (Number(k.estimate) || 0), 0);
  const offer = items.reduce((s, k) => s + (Number(k.offer) || 0), 0);
  const actual = items.reduce((s, k) => s + (Number(k.actual) || 0), 0);
  const best = items.reduce((s, k) => s + costValue(k), 0);
  const funding = (p.funding || []).filter((f) => f.status !== 'abgelehnt' && f.type !== 'kredit').reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const fundingSecured = (p.funding || []).filter((f) => ['bewilligt', 'ausgezahlt'].includes(f.status) && f.type !== 'kredit').reduce((s, f) => s + (Number(f.amount) || 0), 0);
  return { est, offer, actual, best, funding, fundingSecured, net: best - funding, ownWork: Number(p.ownWork) || 0 };
}

export const isDone = (p) => p.status === 'abgeschlossen';
export const isActive = (p) => ['planung', 'angebote', 'beauftragt', 'umsetzung'].includes(p.status);

// ---------- dependencies between projects and milestones ----------
// A reference is a project id (after its end) or "projectId#milestoneId" (after that milestone).
export const msRef = (pid, mid) => `${pid}#${mid}`;
export function parseRef(ref) {
  const s = String(ref || '');
  const i = s.indexOf('#');
  return i < 0 ? { pid: s, mid: null } : { pid: s.slice(0, i), mid: s.slice(i + 1) };
}
export function resolveRef(byId, ref) {
  const { pid, mid } = parseRef(ref);
  const p = byId[pid];
  if (!p) return null;
  if (!mid) return { ref, kind: 'project', project: p, title: p.title, date: p.end || null, done: isDone(p) };
  const m = (p.milestones || []).find((x) => x.id === mid);
  if (!m) return null;
  return { ref, kind: 'milestone', project: p, milestone: m, title: m.title, date: m.date || null, done: !!m.done };
}
export const refLabel = (r) => (r.kind === 'milestone' ? `Meilenstein „${r.title}“ (${r.project.title})` : `„${r.title}“`);
const depsOf = (byId, ref) => {
  const r = resolveRef(byId, ref);
  return (r ? (r.kind === 'milestone' ? r.milestone.dependsOn : r.project.dependsOn) : null) || [];
};
// all nodes that wait for ref (directly)
export function dependentsOf(projects, ref) {
  const out = [];
  for (const p of projects) {
    if ((p.dependsOn || []).includes(ref)) out.push({ kind: 'project', project: p, ref: p.id, title: p.title });
    for (const m of p.milestones || []) if ((m.dependsOn || []).includes(ref)) out.push({ kind: 'milestone', project: p, milestone: m, ref: msRef(p.id, m.id), title: m.title });
  }
  return out;
}
const dmy = (iso) => iso.split('-').reverse().join('.');

export function projectIssues(p, all, today = todayISO()) {
  const issues = [];
  const byId = Object.fromEntries(all.map((x) => [x.id, x]));
  for (const ref of p.dependsOn || []) {
    const d = resolveRef(byId, ref);
    if (!d || !d.date || !p.start || p.start >= d.date) continue;
    if (!d.done) issues.push({ kind: 'dependency', level: 'warn', text: d.kind === 'milestone' ? `Startet vor Meilenstein „${d.title}“ von „${d.project.title}“ (${dmy(d.date)})` : `Startet vor Ende von „${d.title}“ (${dmy(d.date)})`, depId: ref });
    else if (d.kind === 'project') issues.push({ kind: 'dependency', level: 'info', text: `Überschneidet sich mit „${d.title}“`, depId: ref });
  }
  for (const m of p.milestones || []) {
    for (const ref of m.dependsOn || []) {
      const d = resolveRef(byId, ref);
      if (!d || !d.date || !m.date || m.date >= d.date || d.done || m.done) continue;
      issues.push({ kind: 'dependency', level: 'warn', text: `Meilenstein „${m.title}“ liegt vor ${d.kind === 'milestone' ? `Meilenstein „${d.title}“${d.project.id !== p.id ? ` von „${d.project.title}“` : ''}` : `dem Ende von „${d.title}“`} (${dmy(d.date)})`, depId: ref, msId: m.id });
    }
  }
  if (p.end && p.end < today && !isDone(p) && p.status !== 'pausiert') issues.push({ kind: 'overdue', level: 'warn', text: 'Endtermin überschritten' });
  if (p.start && p.end && p.end < p.start) issues.push({ kind: 'dates', level: 'warn', text: 'Ende liegt vor dem Start' });
  for (const f of p.funding || []) {
    if (f.deadline && f.deadline < today && ['pruefen', 'geplant'].includes(f.status))
      issues.push({ kind: 'funding', level: 'warn', text: `Frist „${f.program || 'Förderung'}“ verpasst?` });
    if (['pruefen', 'geplant'].includes(f.status) && ['beauftragt', 'umsetzung', 'abgeschlossen'].includes(p.status) && f.type !== 'steuer' && f.type !== 'verguetung')
      issues.push({ kind: 'funding', level: 'warn', text: `„${f.program || 'Förderung'}“ nicht beantragt, aber Projekt schon beauftragt` });
  }
  return issues;
}

// Would letting `ref` wait for `depRef` create a cycle? (refs are project ids or milestone refs)
export function createsCycle(projects, ref, depRef) {
  const byId = Object.fromEntries(projects.map((x) => [x.id, x]));
  const seen = new Set();
  const stack = [depRef];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === ref) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const d of depsOf(byId, cur)) stack.push(d);
  }
  return false;
}

export function deadlines(projects, today = todayISO()) {
  const out = [];
  for (const p of projects) {
    if (isDone(p)) continue;
    for (const f of p.funding || [])
      if (f.deadline && ['pruefen', 'geplant'].includes(f.status) && f.deadline >= today)
        out.push({ date: f.deadline, label: `Antrag ${f.program || 'Förderung'}`, project: p, kind: 'funding' });
    for (const m of p.milestones || []) if (m.date && !m.done && m.date >= today) out.push({ date: m.date, label: m.title, project: p, kind: 'milestone' });
    for (const c of p.constraints || []) if (c.due && !c.done && c.due >= today) out.push({ date: c.due, label: c.text, project: p, kind: 'todo' });
    if (p.start && p.start >= today && statusOf(p.status).step < 4) out.push({ date: p.start, label: `Start ${p.title}`, project: p, kind: 'start' });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function portfolio(projects, today = todayISO()) {
  const list = projects || [];
  const active = list.filter(isActive);
  const running = list.filter((p) => p.status === 'umsetzung');
  const overdue = list.filter((p) => p.end && p.end < today && !isDone(p) && p.status !== 'pausiert');
  let budget = 0,
    funding = 0,
    secured = 0,
    spent = 0;
  for (const p of list) {
    const c = projectCost(p);
    budget += c.best;
    funding += c.funding;
    secured += c.fundingSecured;
    spent += c.actual;
  }
  const done = list.filter(isDone).length;
  return { total: list.length, active, running, overdue, budget, funding, secured, spent, done, next: deadlines(list, today) };
}

// ---------- consumption ----------
export function toKwh(r) {
  const m = medium(r.medium);
  if (m.kwh) return Number(r.amount) * m.kwh;
  if (m.unit === 'kWh') return Number(r.amount);
  return null;
}

export function consumptionByYear(readings) {
  const years = {};
  for (const r of readings || []) {
    const y = (r.to || r.from || '').slice(0, 4);
    if (!y) continue;
    years[y] ||= {};
    const e = (years[y][r.medium] ||= { amount: 0, cost: 0, kwh: 0 });
    e.amount += Number(r.amount) || 0;
    e.cost += Number(r.cost) || 0;
    const k = toKwh(r);
    if (k != null) e.kwh += k;
  }
  return years;
}

export function heatingIndex(readings, livingArea) {
  const years = consumptionByYear(readings);
  const ys = Object.keys(years).sort();
  const rows = ys.map((y) => {
    let heat = 0;
    for (const [k, v] of Object.entries(years[y])) if (medium(k).heat) heat += v.kwh;
    const cost = Object.values(years[y]).reduce((s, v) => s + v.cost, 0);
    return { year: y, heat, cost, perM2: livingArea ? heat / livingArea : null };
  });
  const last = [...rows].reverse().find((r) => r.heat > 0);
  return { rows, last, cls: last?.perM2 ? energyClass(last.perM2) : null };
}

export function daysUntil(iso, today = todayISO()) {
  if (!iso) return null;
  return Math.round((parseISO(iso) - parseISO(today)) / 864e5);
}
