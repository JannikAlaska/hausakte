// Tax helper for invoices of the own home (Germany, simplified, without guarantee):
// § 35a EStG – 20 % of the labour costs of craftsmen (max. 1,200 €/year) and of household services (max. 4,000 €/year);
// § 35c EStG – 20 % of the costs of energetic measures (labour + material), spread over three years (7/7/6 %),
// max. 40,000 € per home; energy advisor 50 %. Counted in the year of payment (§ 35a) or of completion (§ 35c).
// Data lives on the invoice: doc.inv.tax = { kind, labor, laborShown, cash, reason, source, override }.
import { invOf, invTotal, isInvoice, invVendor } from './invoices.js';
import { getState, updateDoc } from './store.js';
import { todayISO } from './util.js';

export const TAX_RESEARCH_DATE = '13.11.2026';

export const TAX_KINDS = [
  { key: 'handwerk', name: 'Handwerkerleistung', law: '§ 35a Abs. 3 EStG', short: 'Handwerker (§ 35a)', hint: 'Reparatur, Renovierung, Modernisierung, Wartung im Haushalt – nur Arbeits-, Fahrt- und Maschinenkosten.' },
  { key: 'haushalt', name: 'Haushaltsnahe Dienstleistung', law: '§ 35a Abs. 2 EStG', short: 'Haushaltsnah (§ 35a)', hint: 'Gartenpflege, Reinigung, Winterdienst, Hausmeister – nur Arbeitskosten.' },
  { key: 'energie', name: 'Energetische Maßnahme', law: '§ 35c EStG', short: 'Energetisch (§ 35c)', hint: 'Dämmung, Fenster/Außentüren, Lüftung, neue oder optimierte Heizung – Lohn und Material, verteilt auf 3 Jahre.' },
  { key: 'beratung', name: 'Energieberatung zur Maßnahme', law: '§ 35c EStG', short: 'Energieberater (§ 35c)', hint: 'Energieberater für eine § 35c-Maßnahme – 50 % der Kosten.' },
  { key: 'keine', name: 'Nicht absetzbar', law: '', short: 'Nicht absetzbar', hint: 'Material, Geräte, Versorger, Behörden, Kauf ohne Montage …' },
];
export const taxKind = (k) => TAX_KINDS.find((x) => x.key === k) || null;
export const is35a = (k) => k === 'handwerk' || k === 'haushalt';
export const is35c = (k) => k === 'energie' || k === 'beratung';

// project kinds that are usually energetic measures in the sense of § 35c
export const ENERGY_PROJECT_KINDS = ['heizung', 'dach', 'fassade', 'fenster', 'daemmung', 'lueftung'];

// rates and caps by tax year; a planned change is only shown as a note until it is law
export function taxRules(year) {
  return {
    handwerk: { rate: 0.2, max: 1200 },
    haushalt: { rate: 0.2, max: 4000 },
    c: { steps: [0.07, 0.07, 0.06], caps: [14000, 14000, 12000], total: 40000, advisor: 0.5, until: 2029 },
    note:
      Number(year) >= 2027
        ? 'Geplant, aber noch nicht beschlossen: ab 2027 nur noch 15 % und höchstens 900 € für Handwerkerleistungen (Entwurf Einkommensteuerreformgesetz 2027). Gerechnet wird mit der geltenden Regel.'
        : null,
  };
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const yearOf = (iso) => (/^\d{4}/.test(String(iso || '')) ? Number(String(iso).slice(0, 4)) : null);

export const taxOf = (d) => invOf(d).tax || {};
export const setTax = (id, patch, delay = 300) =>
  updateDoc('documents', id, (d) => ({ ...d, inv: { ...(d.inv || {}), tax: { ...(d.inv?.tax || {}), ...patch } } }), delay);

// a project paid with a grant or a subsidised loan: no tax bonus for the same measure
export function projectFunding(p) {
  if (!p) return null;
  return (p.funding || []).find((f) => (f.type === 'zuschuss' || f.type === 'kredit') && ['beantragt', 'bewilligt', 'ausgezahlt'].includes(f.status)) || null;
}

// year in which a paid invoice counts (§ 35a: payment)
export function payYear(d) {
  const i = invOf(d);
  if (i.status !== 'bezahlt') return null;
  return yearOf(i.paidAt) || yearOf(i.date) || yearOf(d.date);
}

// one invoice as seen by the tax helper
export function taxLine(d, data = getState()) {
  const i = invOf(d);
  const t = i.tax || {};
  const kind = t.kind || null;
  const p = d.projectId ? data.projects?.[d.projectId] : null;
  const fund = projectFunding(p);
  const year = payYear(d);
  const total = invTotal(d);
  const issues = []; // {level: 'stop'|'warn'|'info', text}
  let base = 0;
  if (!kind) issues.push({ level: 'stop', text: 'Noch nicht eingeordnet.' });
  if (i.kind === 'gutschrift') issues.push({ level: 'stop', text: 'Gutschrift – wird nicht angesetzt.' });
  if (i.status !== 'bezahlt') issues.push({ level: 'stop', text: i.status === 'teilbezahlt' ? 'Erst teilweise bezahlt – angesetzt wird im Jahr der (vollständigen) Zahlung.' : 'Noch nicht bezahlt – zählt im Jahr der Zahlung.' });
  if (t.cash && kind !== 'keine') issues.push({ level: 'stop', text: 'Bar bezahlt – der Steuerbonus setzt eine Zahlung aufs Konto voraus (Überweisung, Lastschrift, Karte).' });
  if (fund && kind && kind !== 'keine' && !t.override) issues.push({ level: 'stop', text: `Das Projekt wird gefördert (${fund.name || 'Zuschuss/Kredit'}) – für geförderte Maßnahmen gibt es keinen Steuerbonus.` });
  if (is35a(kind)) {
    if (t.labor == null) issues.push({ level: 'stop', text: 'Arbeitskosten fehlen – nur Lohn, Fahrt- und Maschinenkosten sind absetzbar.' });
    else base = Math.min(r2(t.labor), total || r2(t.labor));
    if (t.labor != null && t.laborShown === false) issues.push({ level: 'warn', text: 'Arbeitskosten stehen nicht gesondert auf der Rechnung – Handwerker um Ausweis bitten (sonst erkennt das Finanzamt sie evtl. nicht an).' });
    if (kind === 'handwerk' && p && ENERGY_PROJECT_KINDS.includes(p.kind) && !fund) issues.push({ level: 'info', text: 'Energetische Maßnahme: Alternativ § 35c – 20 % auf Lohn und Material, verteilt auf 3 Jahre (bis 40.000 €). Meist mehr als § 35a.' });
  }
  if (is35c(kind)) {
    base = total;
    if (kind === 'energie' && !p?.tax35c?.cert) issues.push({ level: 'warn', text: 'Für § 35c braucht es eine Bescheinigung des Fachunternehmens nach amtlichem Muster.' });
  }
  const counted = !!kind && kind !== 'keine' && base > 0 && !issues.some((x) => x.level === 'stop');
  return { d, kind, year, total, base: r2(base), counted, issues, project: p, funded: !!fund, vendor: invVendor(d, data) };
}

export const taxLines = (data = getState()) => Object.values(data.documents || {}).filter(isInvoice).map((d) => taxLine(d, data));

// § 35c measures: one per project (or per invoice without project), with its 3-year schedule
export function taxMeasures(data = getState(), lines = taxLines(data)) {
  const groups = new Map();
  for (const l of lines) {
    if (!l.counted || !is35c(l.kind)) continue;
    const k = l.project ? l.project.id : 'inv:' + l.d.id;
    if (!groups.has(k)) groups.set(k, { key: k, project: l.project, lines: [] });
    groups.get(k).lines.push(l);
  }
  const R = taxRules(new Date().getFullYear()).c;
  const out = [];
  for (const g of groups.values()) {
    const cost = r2(g.lines.filter((l) => l.kind === 'energie').reduce((s, l) => s + l.base, 0));
    const advisor = r2(g.lines.filter((l) => l.kind === 'beratung').reduce((s, l) => s + l.base, 0));
    const lastPay = Math.max(...g.lines.map((l) => l.year || 0)) || new Date().getFullYear();
    const p = g.project;
    const set = p?.tax35c?.year;
    const done = p ? p.status === 'abgeschlossen' : true;
    const year = set || (p?.end && done ? Math.max(yearOf(p.end), lastPay) : lastPay);
    const prelim = !set && !done;
    const amounts = R.steps.map((s, k) => Math.min(r2(cost * s), R.caps[k]));
    amounts[0] = r2(amounts[0] + advisor * R.advisor);
    out.push({ ...g, title: p ? p.title : g.lines[0].vendor || 'Rechnung', cost, advisor, year, prelim, cert: !!p?.tax35c?.cert, schedule: amounts.map((a, k) => ({ year: year + k, amount: a })) });
  }
  // at most 40,000 € per home over all measures, in order of completion
  out.sort((a, b) => a.year - b.year);
  let left = R.total;
  for (const m of out)
    for (const s of m.schedule) {
      s.amount = r2(Math.min(s.amount, left));
      left = r2(left - s.amount);
    }
  return out;
}

// everything for one tax year
export function taxYear(data = getState(), year = new Date().getFullYear()) {
  year = Number(year);
  const rules = taxRules(year);
  const lines = taxLines(data);
  const inYear = lines.filter((l) => l.year === year);
  const part = (kind) => {
    const list = inYear.filter((l) => l.counted && l.kind === kind);
    const sum = r2(list.reduce((s, l) => s + l.base, 0));
    const r = rules[kind];
    const raw = r2(sum * r.rate);
    const deduction = Math.min(raw, r.max);
    return { kind, list, sum, deduction, raw, max: r.max, rate: r.rate, room: Math.max(0, r2(r.max / r.rate - sum)) };
  };
  const handwerk = part('handwerk');
  const haushalt = part('haushalt');
  const measures = taxMeasures(data, lines);
  const c = measures.map((m) => ({ m, amount: m.schedule.find((s) => s.year === year)?.amount || 0 })).filter((x) => x.amount > 0);
  const cSum = r2(c.reduce((s, x) => s + x.amount, 0));
  // to check: paid in this year but not counted for a reason the user can fix
  const check = inYear.filter((l) => !l.counted && l.kind !== 'keine' && invOf(l.d).kind !== 'gutschrift');
  // not paid yet: count in the year they are paid
  const pending = lines.filter((l) => l.year == null && l.kind && l.kind !== 'keine' && invOf(l.d).kind !== 'gutschrift');
  const unclassified = lines.filter((l) => !l.kind && invOf(l.d).kind !== 'gutschrift');
  return { year, rules, handwerk, haushalt, measures, c, cSum, total: r2(handwerk.deduction + haushalt.deduction + cSum), check, pending, unclassified, lines: inYear };
}

// years worth showing: payment years, § 35c schedule years, this year
export function taxYears(data = getState()) {
  const ys = new Set([new Date().getFullYear()]);
  for (const l of taxLines(data)) if (l.year) ys.add(l.year);
  for (const m of taxMeasures(data)) for (const s of m.schedule) if (s.amount > 0) ys.add(s.year);
  return [...ys].sort((a, b) => b - a);
}

// ---------- export ----------
const money = (n) => (n == null || !Number.isFinite(Number(n)) ? '' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const deDate = (iso) => (/^\d{4}-\d\d-\d\d$/.test(iso || '') ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

// rows of the year's list (used for CSV and PDF)
export function taxRows(ty) {
  const rows = [];
  for (const part of [ty.handwerk, ty.haushalt])
    for (const l of part.list) {
      const i = invOf(l.d);
      rows.push({ kind: taxKind(l.kind).short, paid: deDate(i.paidAt || i.date), date: deDate(i.date), number: i.number || '', vendor: l.vendor, what: i.summary || l.d.name || '', project: l.project?.title || '', total: l.total, base: l.base, note: l.issues.filter((x) => x.level === 'warn').map((x) => x.text).join(' ') });
    }
  for (const { m, amount } of ty.c)
    for (const l of m.lines) {
      const i = invOf(l.d);
      rows.push({ kind: taxKind(l.kind).short, paid: deDate(i.paidAt || i.date), date: deDate(i.date), number: i.number || '', vendor: l.vendor, what: i.summary || l.d.name || '', project: m.title, total: l.total, base: l.base, note: `Maßnahme abgeschlossen ${m.year}; Anteil ${ty.year}: ${money(amount)} € für die ganze Maßnahme` });
    }
  return rows;
}

export function taxCsv(ty) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Art', 'Bezahlt am', 'Rechnungsdatum', 'Rechnungsnr.', 'Anbieter', 'Leistung', 'Projekt', 'Rechnungsbetrag (€)', 'Angesetzt (€)', 'Hinweis'];
  const lines = [head, ...taxRows(ty).map((r) => [r.kind, r.paid, r.date, r.number, r.vendor, r.what, r.project, money(r.total), money(r.base), r.note])];
  lines.push([]);
  lines.push(['Summe Arbeitskosten Handwerker', '', '', '', '', '', '', '', money(ty.handwerk.sum), `Steuerermäßigung ca. ${money(ty.handwerk.deduction)} €`]);
  lines.push(['Summe Arbeitskosten haushaltsnahe Dienstleistungen', '', '', '', '', '', '', '', money(ty.haushalt.sum), `Steuerermäßigung ca. ${money(ty.haushalt.deduction)} €`]);
  if (ty.c.length) lines.push(['Energetische Maßnahmen (§ 35c)', '', '', '', '', '', '', '', '', `Steuerermäßigung ${ty.year} ca. ${money(ty.cSum)} €`]);
  // BOM so Excel reads the umlauts
  return '﻿' + lines.map((l) => l.map(esc).join(';')).join('\r\n');
}

// the year's summary as PDF (built by pdf.js)
export function taxPdfDoc(ty, house) {
  const blocks = [];
  blocks.push({ t: 'title', text: `Steuer-Übersicht ${ty.year} – Haus` });
  const addr = [house?.street, [house?.zip, house?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  blocks.push({ t: 'small', text: `${addr ? addr + ' · ' : ''}erstellt am ${deDate(todayISO())} mit der Hausakte · vereinfachte Berechnung ohne Gewähr, keine Steuerberatung` });
  blocks.push({ t: 'gap' });
  blocks.push({
    t: 'table',
    cols: [{ w: 300 }, { w: 105, right: true }, { w: 105, right: true }],
    head: ['Bereich', 'Angesetzt', 'Ermäßigung ca.'],
    rows: [
      ['Handwerkerleistungen (§ 35a Abs. 3 EStG, 20 %, max. 1.200 €)', `${money(ty.handwerk.sum)} €`, `${money(ty.handwerk.deduction)} €`],
      ['Haushaltsnahe Dienstleistungen (§ 35a Abs. 2 EStG, 20 %, max. 4.000 €)', `${money(ty.haushalt.sum)} €`, `${money(ty.haushalt.deduction)} €`],
      ['Energetische Maßnahmen (§ 35c EStG, Anteil dieses Jahres)', ty.c.length ? `${money(ty.c.reduce((s, x) => s + x.m.cost + x.m.advisor, 0))} €` : '–', `${money(ty.cSum)} €`],
    ],
    foot: ['Summe', '', `${money(ty.total)} €`],
  });
  if (ty.rules.note) blocks.push({ t: 'small', text: ty.rules.note });
  const sec = (title, list, labelBase) => {
    if (!list.length) return;
    blocks.push({ t: 'h', text: title });
    blocks.push({
      t: 'table',
      cols: [{ w: 62 }, { w: 120 }, { w: 158 }, { w: 85, right: true }, { w: 85, right: true }],
      head: ['Bezahlt', 'Anbieter / Nr.', 'Leistung', 'Rechnung', labelBase],
      rows: list.map((l) => {
        const i = invOf(l.d);
        return [deDate(i.paidAt || i.date), [l.vendor, i.number ? `Nr. ${i.number}` : ''].filter(Boolean).join(' · '), i.summary || l.d.name || '', `${money(l.total)} €`, `${money(l.base)} €`];
      }),
    });
  };
  sec('Handwerkerleistungen (§ 35a Abs. 3 EStG) – Zeile Handwerkerleistungen der Anlage Haushaltsnahe Aufwendungen', ty.handwerk.list, 'Arbeitskosten');
  sec('Haushaltsnahe Dienstleistungen (§ 35a Abs. 2 EStG)', ty.haushalt.list, 'Arbeitskosten');
  if (ty.c.length) {
    blocks.push({ t: 'h', text: 'Energetische Maßnahmen (§ 35c EStG) – Anlage Energetische Maßnahmen, je Maßnahme mit Bescheinigung' });
    for (const { m, amount } of ty.c) {
      blocks.push({ t: 'p', text: `${m.title}: Abschluss ${m.year}${m.prelim ? ' (vorläufig)' : ''}, Aufwendungen ${money(m.cost)} €${m.advisor ? ` + Energieberater ${money(m.advisor)} €` : ''}; Ermäßigung ${m.schedule.map((s) => `${s.year}: ${money(s.amount)} €`).join(', ')} – davon ${ty.year}: ${money(amount)} €.${m.cert ? ' Bescheinigung liegt vor.' : ' Bescheinigung fehlt noch.'}` });
    }
  }
  blocks.push({ t: 'gap' });
  blocks.push({ t: 'small', text: 'Voraussetzungen: Rechnung liegt vor, Zahlung aufs Konto des Anbieters (nicht bar), selbst genutzte Wohnung im EU/EWR-Raum. § 35a nur für Arbeits-, Fahrt- und Maschinenkosten inkl. MwSt.; nicht für öffentlich geförderte Maßnahmen und nicht zusätzlich zu § 35c. Höchstbeträge gelten je Haushalt.' });
  blocks.push({ t: 'small', text: `Stand der Regeln: ${TAX_RESEARCH_DATE}. Werte vor der Steuererklärung prüfen.` });
  return blocks;
}
