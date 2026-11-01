// Invoices are documents of type "rechnung" with structured data in doc.inv: number, dates, amounts,
// line items, payment status. They can belong to a project or be general (projectId null) and point to
// the sender via doc.contactId like every document.
import { getState, putDoc, updateDoc } from './store.js';
import { matchContact, createContact } from './contacts.js';
import { uid, todayISO, isISO } from './util.js';

export const INV_STATUS = [
  { key: 'offen', name: 'Offen' },
  { key: 'teilbezahlt', name: 'Teilbezahlt' },
  { key: 'bezahlt', name: 'Bezahlt' },
];
export const INV_KINDS = [
  { key: 'rechnung', name: 'Rechnung' },
  { key: 'abschlag', name: 'Abschlagsrechnung' },
  { key: 'schluss', name: 'Schlussrechnung' },
  { key: 'gutschrift', name: 'Gutschrift' },
];

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
export const isInvoice = (d) => d?.type === 'rechnung';
export const invOf = (d) => d?.inv || {};
export const invTotal = (d) => num(invOf(d).total) ?? (invOf(d).items || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
export const invPaid = (d) => {
  const i = invOf(d);
  if (i.status === 'bezahlt') return invTotal(d);
  if (i.status === 'teilbezahlt') return Math.min(invTotal(d), num(i.paid) || 0);
  return 0;
};
export const invOpen = (d) => Math.max(0, Math.round((invTotal(d) - invPaid(d)) * 100) / 100);
export const isOverdue = (d, today = todayISO()) => invOf(d).status !== 'bezahlt' && isISO(invOf(d).due) && invOf(d).due < today;
export const invVendor = (d, data = getState()) => data.contacts?.[d.contactId]?.company || data.contacts?.[d.contactId]?.name || invOf(d).vendor || '';
export const invTitle = (d, data) => [invVendor(d, data) || 'Rechnung', invOf(d).number ? `Nr. ${invOf(d).number}` : null].filter(Boolean).join(' · ');

export function invoiceDocs(data, projectId) {
  return Object.values(data.documents || {})
    .filter((d) => isInvoice(d) && (projectId === undefined || (d.projectId || null) === projectId))
    .sort((a, b) => (invOf(b).date || b.date || '').localeCompare(invOf(a).date || a.date || ''));
}

export function invoiceSums(list, today = todayISO()) {
  const year = today.slice(0, 4);
  let total = 0,
    paid = 0,
    open = 0,
    overdue = 0,
    overdueN = 0,
    openN = 0,
    paidYear = 0;
  for (const d of list) {
    const t = invTotal(d);
    const p = invPaid(d);
    total += t;
    paid += p;
    if (invOf(d).status !== 'bezahlt') {
      open += invOpen(d);
      openN++;
    }
    if (isOverdue(d, today)) {
      overdue += invOpen(d);
      overdueN++;
    }
    if (invOf(d).status === 'bezahlt' && String(invOf(d).paidAt || invOf(d).date || '').startsWith(year)) paidYear += t;
  }
  return { total, paid, open, overdue, overdueN, openN, paidYear, count: list.length };
}

// upcoming due dates of unpaid invoices (for the "next deadline" overview)
export function invoiceDeadlines(data, today = todayISO()) {
  return invoiceDocs(data)
    .filter((d) => invOf(d).status !== 'bezahlt' && isISO(invOf(d).due) && invOf(d).due >= today)
    .map((d) => ({ date: invOf(d).due, label: `Rechnung fällig: ${invTitle(d, data)}`, project: data.projects?.[d.projectId] || null, kind: 'invoice', docId: d.id }));
}

export const setInvoice = (id, patch, delay = 300) => updateDoc('documents', id, (d) => ({ ...d, inv: { ...(d.inv || {}), ...patch } }), delay);

// status change: paid sets the payment date, part-paid keeps the amount entered
export function setInvoiceStatus(id, status) {
  updateDoc('documents', id, (d) => {
    const i = { ...(d.inv || {}), status };
    if (status === 'bezahlt') i.paidAt = i.paidAt || todayISO();
    if (status === 'offen') i.paidAt = null;
    if (status === 'teilbezahlt' && !(num(i.paid) > 0)) i.paid = null;
    return { ...d, inv: i };
  }, 50);
}

// invoice entered by hand (no file)
export function createInvoice({ projectId = null, contactId = null } = {}) {
  const id = uid('d-');
  putDoc('documents', id, { id, name: 'Rechnung', type: 'rechnung', projectId, contactId, date: todayISO(), notes: '', noFile: true, inv: { status: 'offen', items: [], source: 'manuell' } }, 50);
  return id;
}

// AI result -> document fields; keeps what the user already changed
export function invoicePatch(d, r, data = getState()) {
  const s = (v, n = 200) => String(v ?? '').trim().slice(0, n);
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 40).map((it) => ({ id: uid('ip'), label: s(it.label, 160) || 'Position', qty: num(it.qty), unit: s(it.unit, 12), unitPrice: num(it.unitPrice), amount: num(it.amount) }));
  const vendor = r.vendor || {};
  const company = s(vendor.company || vendor.name);
  const contacts = data.contacts || {};
  const contactId = d.contactId || (r.contactId && contacts[r.contactId] ? r.contactId : null) || (company ? matchContact(`${company} ${s(vendor.name)}`) : null);
  const projectId = d.projectId || (r.projectId && data.projects?.[r.projectId] && !data.projects[r.projectId].archived ? r.projectId : null);
  const kind = INV_KINDS.some((k) => k.key === r.kind) ? r.kind : 'rechnung';
  const inv = {
    ...(d.inv || {}),
    status: d.inv?.status || (num(r.alreadyPaid) && num(r.total) && num(r.alreadyPaid) >= num(r.total) ? 'bezahlt' : 'offen'),
    number: s(r.number, 60),
    date: isISO(r.date) ? r.date : null,
    due: isISO(r.dueDate) ? r.dueDate : null,
    total: num(r.total),
    net: num(r.net),
    vat: num(r.vat),
    vatRate: num(r.vatRate),
    items,
    kind,
    terms: s(r.paymentTerms, 200),
    skonto: r.skonto && num(r.skonto.percent) ? { percent: num(r.skonto.percent), until: isISO(r.skonto.until) ? r.skonto.until : null } : null,
    iban: s(r.iban, 40),
    vendor: company,
    vendorInfo: { name: s(vendor.name), address: s(vendor.address, 200), phone: s(vendor.phone, 40), email: s(vendor.email, 100), website: s(vendor.website, 100) },
    summary: s(r.summary, 300),
    warnings: (Array.isArray(r.warnings) ? r.warnings : []).map((w) => s(w, 200)).slice(0, 6),
    projectReason: projectId && !d.projectId ? s(r.projectReason, 200) : d.inv?.projectReason || '',
    source: 'ki',
    pending: false,
    aiAt: Date.now(),
  };
  const name = [`Rechnung`, company, inv.number ? `Nr. ${inv.number}` : ''].filter(Boolean).join(' ');
  return { ...d, inv, contactId, projectId, date: inv.date || d.date, name: d.noFile || /^IMG|^Scan|^scan|^image|^Foto|^photo|^\d|^Rechnung$/i.test(d.name || '') ? name : d.name, ai: { data: { docType: 'rechnung', vendor: company, date: inv.date, total: inv.total, items: items.map((i) => ({ label: i.label, amount: i.amount })), summary: inv.summary }, at: Date.now() } };
}

// sender of an invoice as new contact (when no contact matched)
export function contactFromInvoice(d) {
  const i = invOf(d);
  const v = i.vendorInfo || {};
  const cid = createContact({ company: i.vendor || '', name: v.name || '', address: v.address || '', phone: v.phone || '', email: v.email || '', website: v.website || '', source: 'rechnung' });
  updateDoc('documents', d.id, (x) => ({ ...x, contactId: cid }), 50);
  return cid;
}
