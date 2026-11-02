// Figures for the cockpit start page: what happens today, upcoming dates, what needs attention,
// the schedule of the next twelve months, money, energy and the house. Pure functions of the data.
import { portfolio, liveProjects, projectCost, componentWear, isDone, projectIssues, daysUntil, sortFloors, floorStats, heatingIndex, consumptionByYear } from './metrics.js';
import { invoiceDocs, invoiceSums, invOf, invOpen, invPaid, isOverdue, invVendor } from './invoices.js';
import { energyClass, ENERGY_CLASSES, medium } from './catalog.js';
import { todayISO, addDays, diffDays, parseISO, toISO, isISO, MONTHS } from './util.js';

// milestones that are really funding applications
export const FUNDING_RX = /antrag|förder|foerder|bafa|kfw|\bbeg\b|zuschuss/i;
const AGENDA_DAYS = 45;
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const z2 = (n) => String(n).padStart(2, '0');

export const dm = (iso) => (isISO(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : '–');
export const wdm = (iso) => (isISO(iso) ? `${WD[parseISO(iso).getDay()]} ${dm(iso)}` : '–');
export const fmtCents = (n) => (n == null || !Number.isFinite(Number(n)) ? '–' : Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
export function inDays(n) {
  if (n == null) return '';
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'gestern';
  return n > 0 ? `in ${n} Tagen` : `vor ${-n} Tagen`;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const openTodos = (p) => (p.constraints || []).filter((c) => !c.done && (c.text || '').trim());
const quoted = (list, max = 2) => list.slice(0, max).map((t) => `„${t}“`).join(' und ') + (list.length > max ? ` und ${list.length - max} weitere` : '');

export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 11 ? 'Guten Morgen' : h < 17 ? 'Guten Tag' : 'Guten Abend';
}

export function longDate(iso) {
  const d = parseISO(iso);
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  return `${days[d.getDay()]}, ${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`;
}

const running = (p, today) => !isDone(p) && p.status !== 'pausiert' && isISO(p.start) && isISO(p.end) && p.start < today && p.end >= today && ['umsetzung', 'beauftragt'].includes(p.status);

// one sentence about today
export function headline(data, today = todayISO()) {
  const live = liveProjects(data.projects).filter((p) => !isDone(p));
  const starting = live.filter((p) => p.start === today).map((p) => p.title);
  if (starting.length) return starting.length === 1 ? `heute startet „${starting[0]}“.` : `heute starten ${quoted(starting)}.`;
  const run = live.filter((p) => running(p, today)).sort((a, b) => (a.end < b.end ? -1 : 1));
  if (run.length) {
    const n = diffDays(today, run[0].end);
    return `„${run[0].title}“ läuft – ${n === 0 ? 'heute ist der letzte Tag' : `noch ${plural(n, 'Tag', 'Tage')}`}.`;
  }
  const next = agenda(data, today).next;
  if (!next) return 'keine offenen Termine.';
  return `${next.days <= 14 ? inDays(next.days) : `am ${wdm(next.date)}`} ${next.phrase}.`;
}

// dates: today, the next weeks, funding deadlines further ahead
export function agenda(data, today = todayISO(), { days = AGENDA_DAYS } = {}) {
  const live = liveProjects(data.projects).filter((p) => !isDone(p));
  const horizon = addDays(today, days);
  const all = [];
  const seen = new Set();
  const phrase = (it) =>
    it.kind === 'start' ? `startet „${it.project.title}“` : it.kind === 'end' ? `endet „${it.project.title}“` : it.kind === 'funding' ? `endet die Frist „${it.title}“` : it.kind === 'invoice' ? `ist eine Rechnung fällig (${it.vendor})` : `steht „${it.title}“ an`;
  const push = (it) => {
    const key = `${it.date}|${it.title}|${it.project?.id || it.docId || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    all.push({ ...it, days: daysUntil(it.date, today), phrase: phrase(it) });
  };
  const nextAfter = (p) =>
    live
      .filter((q) => q.id !== p.id && isISO(q.start) && q.start > p.end)
      .sort((a, b) => (a.start < b.start ? -1 : 1))[0];
  const todayItems = [];
  for (const p of live) {
    const todos = openTodos(p).length;
    if (p.start === today) todayItems.push({ kind: 'start', date: today, title: `Start: ${p.title}`, sub: [isISO(p.end) ? `bis ${dm(p.end)}` : null, todos ? plural(todos, 'offenes To-do', 'offene To-dos') : null].filter(Boolean).join(' · '), project: p, days: 0 });
    else if (running(p, today)) todayItems.push({ kind: 'running', date: today, title: `Läuft: ${p.title}`, sub: [`noch ${plural(diffDays(today, p.end), 'Tag', 'Tage')} · bis ${dm(p.end)}`, todos ? plural(todos, 'offenes To-do', 'offene To-dos') : null].filter(Boolean).join(' · '), project: p, days: 0 });
    if (isISO(p.start) && p.start > today) push({ kind: 'start', date: p.start, title: `Start: ${p.title}`, sub: isISO(p.end) ? `bis ${dm(p.end)}` : '', project: p });
    if (isISO(p.end) && p.end >= today && p.end !== p.start) {
      const q = nextAfter(p);
      push({ kind: 'end', date: p.end, title: `Ende: ${p.title}`, sub: q ? `danach: ${q.title} ab ${dm(q.start)}` : '', project: p });
    }
    for (const m of p.milestones || [])
      if (isISO(m.date) && !m.done && m.date >= today) push({ kind: FUNDING_RX.test(m.title || '') ? 'funding' : 'milestone', date: m.date, title: m.title || 'Meilenstein', sub: p.title, project: p, tab: 'zeitplan' });
    for (const f of p.funding || [])
      if (isISO(f.deadline) && f.deadline >= today && ['pruefen', 'geplant'].includes(f.status)) push({ kind: 'funding', date: f.deadline, title: `Antrag ${f.program || 'Förderung'}`, sub: p.title, project: p, tab: 'foerderung' });
    for (const c of p.constraints || [])
      if (isISO(c.due) && !c.done && c.due >= today) push({ kind: 'todo', date: c.due, title: c.text || 'To-do', sub: p.title, project: p, tab: 'aufgaben' });
  }
  for (const d of invoiceDocs(data)) {
    const i = invOf(d);
    if (i.status === 'bezahlt' || !isISO(i.due) || i.due < today) continue;
    push({ kind: 'invoice', date: i.due, vendor: invVendor(d, data) || 'Rechnung', title: `Rechnung fällig: ${invVendor(d, data) || 'Rechnung'}`, sub: [i.number ? `Nr. ${i.number}` : null, fmtCents(invOpen(d))].filter(Boolean).join(' · '), docId: d.id });
  }
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const soon = all.filter((x) => x.date > today && x.date <= horizon);
  todayItems.push(...all.filter((x) => x.date === today));
  const later = all.filter((x) => x.date > horizon && x.kind === 'funding' && x.date <= addDays(today, 400));
  // quiet weeks: still show what comes next
  const more = soon.length >= 3 ? [] : all.filter((x) => x.date > horizon && x.kind !== 'funding').slice(0, 3 - soon.length);
  return { today: todayItems, soon, more, funding: later, next: all.find((x) => x.date > today) || null };
}

// hints derived from the data, most urgent first
export function attention(data, today = todayISO()) {
  const out = [];
  const live = liveProjects(data.projects);
  const open = live.filter((p) => !isDone(p));
  const year = Number(today.slice(0, 4));
  const add = (level, icon, title, sub, action) => out.push({ level, icon, title, sub, action });

  const invs = invoiceDocs(data);
  const late = invs.filter((d) => isOverdue(d, today));
  if (late.length)
    add('danger', 'euro', `${plural(late.length, 'Rechnung', 'Rechnungen')} überfällig`, `${fmtCents(late.reduce((s, d) => s + invOpen(d), 0))} offen · ${late.map((d) => invVendor(d, data) || 'Rechnung').slice(0, 2).join(', ')}`, { drawer: { type: 'invoice', id: late[0].id } });

  const comps = Object.values(data.components || {}).map((c) => ({ c, w: componentWear(c, year) }));
  const due = comps.filter((x) => x.w.state === 'faellig').sort((a, b) => a.w.remaining - b.w.remaining);
  if (due.length) {
    const over = Math.max(...due.map((x) => -x.w.remaining));
    const years = [...new Set(due.map((x) => x.c.year))];
    add('danger', 'alert', `${plural(due.length, 'Bauteil', 'Bauteile')} überfällig`, `${due.map((x) => x.c.name).slice(0, 4).join(', ')}${due.length > 4 ? ' …' : ''}${years.length === 1 ? ` (${years[0]})` : ''} – Lebensdauer ${over > 0 ? `um bis zu ${plural(over, 'Jahr', 'Jahre')} ` : ''}überschritten`, due.length === 1 ? { drawer: { type: 'component', id: due[0].c.id } } : { go: 'gebaeude' });
  }
  const soon = comps.filter((x) => x.w.state === 'bald');

  const overdue = open.filter((p) => isISO(p.end) && p.end < today && p.status !== 'pausiert');
  if (overdue.length) add('warn', 'clock', overdue.length === 1 ? `„${overdue[0].title}“ im Verzug` : `${overdue.length} Projekte im Verzug`, overdue.length === 1 ? `Endtermin ${dm(overdue[0].end)} überschritten` : overdue.map((p) => p.title).slice(0, 3).join(', '), { drawer: { type: 'project', id: overdue[0].id, tab: 'zeitplan' } });

  for (const p of open) {
    const iss = projectIssues(p, live, today).filter((i) => i.level === 'warn' && i.kind !== 'overdue');
    if (iss.length) add('warn', iss[0].kind === 'funding' ? 'flag' : 'link', iss[0].kind === 'funding' ? `Förderung prüfen: ${p.title}` : `Terminkonflikt: ${p.title}`, iss[0].text, { drawer: { type: 'project', id: p.id, tab: iss[0].kind === 'funding' ? 'foerderung' : 'zeitplan' } });
  }

  const pf = portfolio(live, today);
  if (pf.budget > 0 && pf.funding === 0) {
    const fms = open.flatMap((p) => (p.milestones || []).filter((m) => !m.done && FUNDING_RX.test(m.title || '')).map((m) => ({ p, m })));
    const names = [...new Set(fms.map((x) => (x.m.title.match(/(BAFA[^,;]*|KfW\s*\d+|BEG\s*\w*)/i) || [x.m.title])[0].trim()))];
    const target = fms[0]?.p || open.filter((p) => projectCost(p).best > 0).sort((a, b) => projectCost(b).best - projectCost(a).best)[0];
    add('warn', 'flag', 'Noch keine Förderung eingetragen', names.length ? `${plural(names.length, 'Antrag steht', 'Anträge stehen')} im Plan (${names.slice(0, 3).join(', ')}) – Beträge unter „Förderung“ ergänzen` : 'Zuschüsse und Kredite im Projekt unter „Förderung“ eintragen', target ? { drawer: { type: 'project', id: target.id, tab: 'foerderung' } } : { go: 'projekte' });
  }

  const todos = open.flatMap((p) => openTodos(p).map((c) => ({ p, c })));
  const lateTodos = todos.filter((x) => isISO(x.c.due) && x.c.due < today);
  if (lateTodos.length) add('warn', 'checkCircle', `${plural(lateTodos.length, 'To-do', 'To-dos')} überfällig`, lateTodos.map((x) => x.c.text).slice(0, 2).join(', '), { drawer: { type: 'project', id: lateTodos[0].p.id, tab: 'aufgaben' } });

  const dups = [];
  for (const p of open) {
    const seen = new Map();
    for (const m of p.milestones || []) {
      const k = (m.title || '').trim().toLowerCase();
      if (!k) continue;
      if (seen.has(k)) dups.push({ p, title: m.title });
      else seen.set(k, m);
    }
  }
  if (dups.length) add('info', 'flag', dups.length === 1 ? 'Doppelter Meilenstein' : `${dups.length} doppelte Meilensteine`, `„${dups[0].title}“ steht zweimal im Projekt „${dups[0].p.title}“`, { drawer: { type: 'project', id: dups[0].p.id, tab: 'zeitplan' } });

  if (todos.length) {
    const byP = {};
    for (const x of todos) (byP[x.p.id] ||= { p: x.p, n: 0 }).n++;
    const focus = open.find((p) => p.start === today && byP[p.id]) || open.find((p) => running(p, today) && byP[p.id]) || Object.values(byP).sort((a, b) => b.n - a.n)[0].p;
    const n = byP[focus.id].n;
    const why = focus.start === today ? ', das heute startet' : running(focus, today) ? ', das gerade läuft' : '';
    add('info', 'tasks', `${plural(todos.length, 'offenes To-do', 'offene To-dos')}`, `davon ${n} bei „${focus.title}“${why}`, { drawer: { type: 'project', id: focus.id, tab: 'aufgaben' } });
  }

  if (soon.length) add('info', 'clock', `${plural(soon.length, 'Bauteil', 'Bauteile')} bald fällig`, soon.map((x) => `${x.c.name} (${x.w.due})`).slice(0, 3).join(', '), { go: 'gebaeude' });

  const cert = data.house?.energyCert;
  if (isISO(cert?.validUntil) && cert.validUntil < addDays(today, 90))
    add(cert.validUntil < today ? 'warn' : 'info', 'file', cert.validUntil < today ? 'Energieausweis abgelaufen' : 'Energieausweis läuft bald ab', `gültig bis ${dm(cert.validUntil)}${cert.validUntil.slice(0, 4)}`, { go: 'gebaeude' });

  const rank = { danger: 0, warn: 1, info: 2 };
  return out.map((x, i) => ({ ...x, i })).sort((a, b) => rank[a.level] - rank[b.level] || a.i - b.i);
}

// schedule of the next months as percentages of the window
export function roadmap(data, today = todayISO(), months = 12) {
  const s = parseISO(today);
  s.setDate(1);
  const start = toISO(s);
  const e = parseISO(start);
  e.setMonth(e.getMonth() + months);
  const end = toISO(e);
  const total = diffDays(start, end);
  const pct = (iso) => Math.max(0, Math.min(100, (diffDays(start, iso) / total) * 100));
  const inWin = (iso) => isISO(iso) && iso >= start && iso < end;
  const monthList = [];
  const m = parseISO(start);
  for (let k = 0; k < months; k++) {
    monthList.push({ iso: toISO(m), label: MONTHS[m.getMonth()], year: m.getFullYear(), first: m.getMonth() === 0 || k === 0 });
    m.setMonth(m.getMonth() + 1);
  }
  const rows = [];
  let later = 0;
  const list = liveProjects(data.projects).sort((a, b) => ((a.start || '9') < (b.start || '9') ? -1 : (a.start || '9') > (b.start || '9') ? 1 : 0));
  for (const p of list) {
    const marks = [
      ...(p.milestones || []).filter((x) => inWin(x.date) && !x.done).map((x) => ({ date: x.date, title: x.title, kind: FUNDING_RX.test(x.title || '') ? 'funding' : 'milestone' })),
      ...(p.funding || []).filter((f) => inWin(f.deadline) && ['pruefen', 'geplant'].includes(f.status)).map((f) => ({ date: f.deadline, title: `Antrag ${f.program || 'Förderung'}`, kind: 'funding' })),
    ].map((x) => ({ ...x, left: pct(x.date) }));
    const hasBar = isISO(p.start) && isISO(p.end) && p.end >= start && p.start < end;
    if (!hasBar && !marks.length) {
      if (isISO(p.start) && p.start >= end) later++;
      continue;
    }
    if (isDone(p) && !marks.length && !(hasBar && p.end >= today)) continue;
    const tone = isDone(p) ? 'done' : isISO(p.end) && p.end < today && p.status !== 'pausiert' ? 'late' : p.status === 'umsetzung' ? 'active' : p.status === 'idee' ? 'idea' : 'plan';
    const bar = hasBar ? { left: pct(p.start), width: Math.max(0.8, pct(addDays(p.end, 1)) - pct(p.start)) } : null;
    rows.push({ p, tone, bar, marks, range: hasBar ? `${dm(p.start)} – ${dm(p.end)}` : '' });
  }
  return { start, end, months: monthList, today: pct(today), rows, later };
}

// planned costs per project with what is already paid (project actuals + paid invoices not yet transferred)
export function budget(data) {
  const live = liveProjects(data.projects);
  const invs = invoiceDocs(data);
  const rows = live
    .map((p) => {
      const c = projectCost(p);
      const invPaidSum = invs.filter((d) => d.projectId === p.id && !invOf(d).costsAdded).reduce((s, d) => s + invPaid(d), 0);
      return { p, planned: c.best, paid: c.actual + invPaidSum, funding: c.funding };
    })
    .filter((r) => r.planned > 0 || r.paid > 0)
    .sort((a, b) => b.planned - a.planned);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.planned, r.paid)));
  const planned = rows.reduce((s, r) => s + r.planned, 0);
  const paid = rows.reduce((s, r) => s + r.paid, 0);
  const funding = rows.reduce((s, r) => s + r.funding, 0);
  const missing = live.filter((p) => !isDone(p) && !rows.some((r) => r.p.id === p.id)).map((p) => p.title);
  return { rows, max, planned, paid, funding, own: planned - funding, missing };
}

export function invoicesSummary(data, today = todayISO()) {
  const list = invoiceDocs(data);
  const sums = invoiceSums(list, today);
  const openList = list.filter((d) => invOf(d).status !== 'bezahlt').sort((a, b) => (invOf(a).due || '9') < (invOf(b).due || '9') ? -1 : 1);
  const paidList = list.filter((d) => invOf(d).status === 'bezahlt');
  const nextDue = openList.find((d) => isISO(invOf(d).due));
  return { sums, list, top: [...openList, ...paidList].slice(0, 3), nextDue };
}

export function energy(data) {
  const h = data.house || {};
  const floors = sortFloors(Object.values(data.floors || {}));
  const living = h.livingAreaOverride ?? floors.reduce((s, f) => s + floorStats(f).living, 0);
  const readings = Object.values(data.readings || {});
  const hi = heatingIndex(readings, living);
  const years = consumptionByYear(readings);
  const lastYear = Object.keys(years).sort().pop() || null;
  const media = lastYear ? Object.entries(years[lastYear]).map(([k, v]) => ({ key: k, name: medium(k).name, unit: medium(k).unit, amount: v.amount, kwh: v.kwh, cost: v.cost })).sort((a, b) => b.kwh - a.kwh) : [];
  const cert = h.energyCert || {};
  const value = Number(cert.value) || hi.last?.perM2 || null;
  const cls = cert.cls ? ENERGY_CLASSES.find((e) => e.c === cert.cls) || null : value ? energyClass(value) : null;
  return { value, cls, source: Number(cert.value) || cert.cls ? cert.kind || 'Energieausweis' : hi.last ? `Verbrauch ${hi.last.year}` : null, measured: hi.last?.perM2 ? { year: hi.last.year, perM2: hi.last.perM2 } : null, lastYear, media, living };
}

export function houseFloors(data) {
  return sortFloors(Object.values(data.floors || {}))
    .reverse()
    .map((f) => {
      const st = floorStats(f);
      return { f, short: f.short || (f.name || '?').slice(0, 2).toUpperCase(), rooms: (f.rooms || []).length, furniture: (f.furniture || []).length, area: st.usable };
    });
}

export function progress(data, today = todayISO()) {
  const live = liveProjects(data.projects);
  const pf = portfolio(live, today);
  const startingToday = live.filter((p) => !isDone(p) && p.start === today).length;
  const runningN = live.filter((p) => running(p, today) || p.status === 'umsetzung').length;
  const planning = live.filter((p) => ['planung', 'angebote', 'beauftragt'].includes(p.status)).length;
  return { done: pf.done, total: pf.total, running: runningN, startingToday, planning, budget: pf.budget, funding: pf.funding };
}

export const pad2 = z2;
