// Invoices: photo or file in, the AI reads sender, number, dates, amounts and line items; then the invoice is
// kept with a payment status, in general or for a project.
import { Icon } from './icons.jsx';
import { Btn, IconBtn, Field, TextInput, NumInput, Select, DateInput, Pill, Drawer, Section, ConfirmBtn, Empty, Seg } from './common.jsx';
import { useAiAvailable } from './ai-ui.jsx';
import { toast, openDrawer, closeDrawer } from './state.js';
import { uploadFiles, storeFile } from './documents.jsx';
import { aiReadInvoice, aiErrorText } from '../ai.js';
import { getState, updateDoc, deleteDoc, fileUrl, getAssets } from '../store.js';
import { addCost } from '../actions.js';
import { contactTitle } from '../contacts.js';
import {
  INV_STATUS, INV_KINDS, invOf, invTotal, invPaid, invOpen, isOverdue, invVendor, invTitle, invoiceDocs, invoiceSums, setInvoice, setInvoiceStatus,
  createInvoice, invoicePatch, contactFromInvoice, pagesOf,
} from '../invoices.js';
import { fmtDate, fmtDayMonth, todayISO, uid, diffDays, isISO } from '../util.js';

// invoices are exact to the cent
const fmtEuro = (n) => (n == null || !Number.isFinite(Number(n)) ? '–' : Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));

const { useState, useEffect, useRef, useMemo } = React;

// ---------- reading in the background ----------
const reading = new Map(); // doc id -> text
const listeners = new Set();
const setReading = (id, text) => {
  text ? reading.set(id, text) : reading.delete(id);
  listeners.forEach((fn) => fn());
};
function useReading() {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return reading;
}

async function readInto(id, blobs) {
  const list = Array.isArray(blobs) ? blobs : [blobs];
  setReading(id, list.length > 1 ? `KI liest ${list.length} Seiten …` : 'KI liest die Rechnung …');
  try {
    const r = await aiReadInvoice(list, getState());
    const d = getState().documents[id];
    if (!d) return;
    const next = invoicePatch(d, r || {});
    if (r && r.isInvoice === false) next.inv.warnings = ['Die KI hat auf dem Bild keine Rechnung erkannt – bitte prüfen.', ...(next.inv.warnings || [])];
    updateDoc('documents', id, () => next, 50);
    const i = next.inv;
    const who = getState().contacts?.[next.contactId];
    toast(
      `Rechnung erfasst: ${who ? contactTitle(who) : i.vendor || 'Absender unbekannt'}${invTotal(next) ? ` · ${fmtEuro(invTotal(next))}` : ''}${i.due ? ` · fällig ${fmtDayMonth(i.due)}` : ''}${next.projectId && !d.projectId ? ` · Projekt „${getState().projects[next.projectId]?.title}“` : ''}`,
      'ok',
      6000,
    );
  } catch (e) {
    toast(`Rechnung konnte nicht ausgelesen werden: ${aiErrorText(e)} Du kannst die Angaben auch von Hand eintragen.`, 'err', 7000);
  } finally {
    setReading(id, null);
  }
}

// one invoice from one or more pages (photos or a PDF): the first page is the document's file, the others
// are kept in doc.pages; all pages go to the AI together
export async function captureInvoice(pages, { projectId = null, ai = true, open = true } = {}) {
  const ids = [];
  const multi = pages.length > 1;
  await uploadFiles([pages[0]], { type: 'rechnung', projectId, ids, silent: true, name: multi ? `Rechnung (${pages.length} Seiten)` : undefined });
  const id = ids[0];
  if (!id) return null;
  const extra = [];
  for (const f of pages.slice(1)) {
    const st = await storeFile(f);
    if (st) extra.push(st);
  }
  updateDoc('documents', id, (d) => ({ ...d, autoName: true, pages: extra, inv: { status: 'offen', items: [], ...(d.inv || {}) } }), 50);
  if (ai) readInto(id, pages);
  else toast(multi ? `Rechnung mit ${1 + extra.length} Seiten abgelegt` : 'Rechnung abgelegt');
  if (open) openDrawer({ type: 'invoice', id });
  return id;
}

// several files, each its own invoice
export async function captureInvoices(files, opts = {}) {
  const made = [];
  for (const f of files) {
    const id = await captureInvoice([f], { ...opts, open: false });
    if (id) made.push(id);
  }
  if (made.length === 1) openDrawer({ type: 'invoice', id: made[0] });
  else if (made.length) toast(`${made.length} Rechnungen werden erfasst`);
  return made;
}

async function pageBlobs(d) {
  const out = [];
  for (const pg of pagesOf(d)) {
    const url = fileUrl(pg);
    if (!url) return null;
    out.push(await (await fetch(url)).blob());
  }
  return out;
}

export async function rereadInvoice(d) {
  try {
    const blobs = await pageBlobs(d);
    if (!blobs?.length) return toast('Die Seiten werden noch geladen – bitte gleich noch einmal versuchen.', 'warn');
    await readInto(d.id, blobs);
  } catch {
    toast('Die Datei konnte nicht geladen werden.', 'err');
  }
}

async function addPages(d, files) {
  const added = [];
  for (const f of files) {
    const st = await storeFile(f);
    if (st) added.push(st);
  }
  if (!added.length) return;
  updateDoc('documents', d.id, (x) => (x.assetId || x.dataUrl ? { ...x, pages: [...(x.pages || []), ...added] } : { ...x, ...added[0], noFile: false, pages: [...(x.pages || []), ...added.slice(1)] }), 50);
  toast(added.length === 1 ? 'Seite hinzugefügt – mit „Neu auslesen“ liest die KI alle Seiten.' : `${added.length} Seiten hinzugefügt – mit „Neu auslesen“ liest die KI alle Seiten.`, 'ok', 5000);
}

async function removePage(d, k) {
  const pages = pagesOf(d);
  const pg = pages[k];
  if (!pg) return;
  if (pg.assetId) {
    const a = await getAssets();
    try {
      await a?.delete(pg.assetId);
    } catch {}
  }
  const rest = pages.filter((_, j) => j !== k);
  updateDoc('documents', d.id, (x) => {
    const [first, ...more] = rest;
    return { ...x, assetId: first?.assetId || null, dataUrl: first?.dataUrl || undefined, contentType: first?.contentType || x.contentType, noFile: !first, pages: more };
  }, 50);
}

// ---------- capture: collect pages, then read them as one invoice ----------
function PageThumb({ file, n, onRemove }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="inv-page">
      {url ? <img src={url} alt={`Seite ${n}`} /> : null}
      <span className="inv-page-n">{n}</span>
      <button type="button" className="inv-page-x" aria-label={`Seite ${n} entfernen`} onClick={onRemove}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

// initialPages/onClose: used by the cockpit, which takes the first photo itself and only shows the page collector
export function InvoiceCapture({ projectId = null, compact, initialPages = null, onClose }) {
  const avail = useAiAvailable();
  const cam = useRef(null);
  const gal = useRef(null);
  const [pages, setPages] = useState(initialPages); // files of the invoice being collected
  useEffect(() => {
    if (onClose && !pages) onClose();
  }, [pages]);
  const [split, setSplit] = useState(false);
  const [busy, setBusy] = useState(false);
  const ai = avail !== false;
  const take = (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    // PDFs already contain all pages: each one is an invoice of its own
    const pdfs = files.filter((f) => f.type === 'application/pdf');
    const imgs = files.filter((f) => f.type !== 'application/pdf');
    if (pdfs.length) captureInvoices(pdfs, { projectId, ai });
    if (imgs.length) setPages((p) => [...(p || []), ...imgs]);
  };
  const done = async () => {
    if (!pages?.length) return;
    setBusy(true);
    if (split && pages.length > 1) await captureInvoices(pages, { projectId, ai });
    else await captureInvoice(pages, { projectId, ai });
    setBusy(false);
    setPages(null);
    setSplit(false);
  };
  return (
    <div className={`inv-capture ${compact ? 'is-compact' : ''}`}>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={take} />
      <input ref={gal} type="file" accept="image/*,application/pdf" multiple hidden onChange={take} />
      {!pages && onClose ? null : pages ? (
        <div className="inv-collect panel">
          <div className="spread">
            <b>
              {pages.length} Seite{pages.length === 1 ? '' : 'n'} {split && pages.length > 1 ? `· ${pages.length} einzelne Rechnungen` : '· eine Rechnung'}
            </b>
            <button className="link small" onClick={() => setPages(null)}>
              Abbrechen
            </button>
          </div>
          <div className="inv-pages">
            {pages.map((f, k) => (
              <PageThumb key={k + f.name + f.size} file={f} n={k + 1} onRemove={() => setPages(pages.length > 1 ? pages.filter((_, j) => j !== k) : null)} />
            ))}
            <button type="button" className="inv-page inv-page-add" onClick={() => cam.current?.click()}>
              <Icon name="camera" size={20} />
              <span>Weitere Seite</span>
            </button>
          </div>
          <div className="inv-collect-actions">
            <Btn small icon="upload" onClick={() => gal.current?.click()}>
              Aus Galerie ergänzen
            </Btn>
            {pages.length > 1 ? (
              <label className="inv-split">
                <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Jedes Bild ist eine eigene Rechnung
              </label>
            ) : null}
          </div>
          {ai && pages.length > 5 && !split ? <p className="small muted">Die KI liest die Seiten 1–4 und die letzte Seite (mit den Summen); gespeichert werden alle Seiten.</p> : null}
          <Btn kind="primary" icon={ai ? 'sparkles' : 'check'} disabled={busy} onClick={done}>
            {busy ? 'Wird abgelegt …' : ai ? (split && pages.length > 1 ? `${pages.length} Rechnungen auslesen` : pages.length > 1 ? `Fertig – ${pages.length} Seiten auslesen` : 'Fertig – Rechnung auslesen') : 'Fertig – ablegen'}
          </Btn>
        </div>
      ) : (
        <>
          <Btn kind="primary" icon="camera" onClick={() => cam.current?.click()}>
            Rechnung fotografieren
          </Btn>
          <Btn icon="upload" onClick={() => gal.current?.click()}>
            Aus Galerie / PDF
          </Btn>
          <Btn kind="ghost" icon="plus" onClick={() => openDrawer({ type: 'invoice', id: createInvoice({ projectId }) })}>
            Von Hand
          </Btn>
          {!compact ? <p className="small muted">{ai ? 'Mehrseitige Rechnungen: Seite für Seite fotografieren oder mehrere Bilder aus der Galerie wählen – alles wird eine Rechnung. Die KI liest Absender, Rechnungsnummer, Datum, Fälligkeit, Beträge und Positionen aus und ordnet Kontakt und – wenn eindeutig – Projekt zu.' : 'Die KI ist hier nicht verfügbar – trage die Angaben nach dem Ablegen selbst ein.'}</p> : null}
        </>
      )}
    </div>
  );
}

// ---------- list ----------
const statusTone = (d) => (invOf(d).status === 'bezahlt' ? 'accent' : isOverdue(d) ? 'danger' : invOf(d).status === 'teilbezahlt' ? 'warn' : 'neutral');
const statusText = (d) => (isOverdue(d) ? 'Überfällig' : INV_STATUS.find((s) => s.key === (invOf(d).status || 'offen'))?.name || 'Offen');

export function InvoiceRow({ d, data, showProject }) {
  const busy = useReading().get(d.id);
  const i = invOf(d);
  const url = fileUrl(d);
  const isImg = (d.contentType || '').startsWith('image/');
  const days = isISO(i.due) ? diffDays(todayISO(), i.due) : null;
  const p = d.projectId ? data.projects?.[d.projectId] : null;
  return (
    <button type="button" className={`inv-row ${isOverdue(d) ? 'is-late' : ''}`} onClick={() => openDrawer({ type: 'invoice', id: d.id })}>
      <span className="inv-thumb">
        {isImg && url ? <img src={url} alt="" loading="lazy" /> : <Icon name="euro" size={20} />}
        {(d.pages || []).length ? <span className="inv-thumb-n">{1 + d.pages.length} S.</span> : null}
      </span>
      <span className="inv-main">
        <b>{busy ? 'Wird ausgelesen …' : invVendor(d, data) || 'Absender unbekannt'}</b>
        <span>
          {[i.number ? `Nr. ${i.number}` : null, i.date ? fmtDate(i.date) : null, showProject ? (p ? p.title : 'Allgemein') : null].filter(Boolean).join(' · ') || d.name}
        </span>
        {i.status !== 'bezahlt' && days != null ? <span className={`inv-due ${days < 0 ? 'is-late' : days <= 7 ? 'is-soon' : ''}`}>{days < 0 ? `seit ${-days} Tagen fällig` : days === 0 ? 'heute fällig' : `fällig ${fmtDayMonth(i.due)} (in ${days} T.)`}</span> : null}
      </span>
      <span className="inv-side">
        <b>{busy ? <span className="spin-dot" /> : fmtEuro(invTotal(d))}</b>
        <Pill tone={statusTone(d)}>{statusText(d)}</Pill>
        {i.status === 'teilbezahlt' ? <span className="small muted">offen {fmtEuro(invOpen(d))}</span> : null}
      </span>
    </button>
  );
}

function SumStrip({ list }) {
  const s = invoiceSums(list);
  return (
    <div className="sum-strip inv-sums">
      <div>
        <span>Offen</span>
        <b>{fmtEuro(s.open)}</b>
        <small>{s.openN} Rechnung{s.openN === 1 ? '' : 'en'}</small>
      </div>
      <div className={s.overdueN ? 'is-late' : ''}>
        <span>Überfällig</span>
        <b>{fmtEuro(s.overdue)}</b>
        <small>{s.overdueN ? `${s.overdueN} Rechnung${s.overdueN === 1 ? '' : 'en'}` : 'keine'}</small>
      </div>
      <div>
        <span>Bezahlt</span>
        <b>{fmtEuro(s.paid)}</b>
        <small>von {fmtEuro(s.total)}</small>
      </div>
    </div>
  );
}

const FILTERS = [
  { key: 'alle', name: 'Alle' },
  { key: 'offen', name: 'Offen' },
  { key: 'teilbezahlt', name: 'Teilbezahlt' },
  { key: 'bezahlt', name: 'Bezahlt' },
  { key: 'ueberfaellig', name: 'Überfällig' },
];
const passes = (d, f) => (f === 'alle' ? true : f === 'ueberfaellig' ? isOverdue(d) : (invOf(d).status || 'offen') === f);

export function InvoicesPanel({ data }) {
  const [f, setF] = useState('alle');
  const [proj, setProj] = useState('alle');
  const all = invoiceDocs(data);
  const list = all.filter((d) => passes(d, f) && (proj === 'alle' || (proj === 'none' ? !d.projectId : d.projectId === proj)));
  const groups = new Map();
  for (const d of list) {
    const k = d.projectId && data.projects?.[d.projectId] ? d.projectId : '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }
  const usedProjects = [...new Set(all.map((d) => d.projectId).filter((id) => id && data.projects?.[id]))];
  return (
    <div className="stack">
      <InvoiceCapture />
      {all.length ? (
        <>
          <SumStrip list={all} />
          <div className="inv-filters">
            <div className="chips">
              {FILTERS.map((x) => (
                <button key={x.key} className={`chip ${f === x.key ? 'is-on' : ''}`} onClick={() => setF(x.key)}>
                  {x.name} <span className="tab-count">{all.filter((d) => passes(d, x.key)).length}</span>
                </button>
              ))}
            </div>
            <Select value={proj} onChange={setProj} options={[{ value: 'alle', label: 'Alle Projekte' }, { value: 'none', label: 'Allgemein (ohne Projekt)' }, ...usedProjects.map((id) => ({ value: id, label: data.projects[id].title }))]} aria-label="Projekt" />
          </div>
          {list.length ? (
            [...groups].map(([pid, items]) => (
              <div key={pid || 'none'} className="inv-group">
                <div className="spread inv-group-head">
                  <span className="field-label">{pid ? data.projects[pid].title : 'Allgemein'}</span>
                  <span className="small muted">
                    {items.length} · {fmtEuro(items.reduce((s, d) => s + invTotal(d), 0))}
                  </span>
                </div>
                {items.map((d) => (
                  <InvoiceRow key={d.id} d={d} data={data} />
                ))}
              </div>
            ))
          ) : (
            <p className="small muted">Keine Rechnungen für diesen Filter.</p>
          )}
        </>
      ) : (
        <Empty icon="euro" title="Noch keine Rechnungen">
          Fotografiere eine Rechnung oder lade sie als PDF hoch – die KI erfasst die wichtigsten Angaben.
        </Empty>
      )}
    </div>
  );
}

export function ProjectInvoices({ p, data }) {
  const list = invoiceDocs(data, p.id);
  const s = invoiceSums(list);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {list.length ? (
        <div className="kv-row small">
          <span>
            Gesamt <b>{fmtEuro(s.total)}</b>
          </span>
          <span>
            bezahlt <b>{fmtEuro(s.paid)}</b>
          </span>
          <span className={s.overdueN ? 'is-late' : ''}>
            offen <b>{fmtEuro(s.open)}</b>
            {s.overdueN ? ` (${s.overdueN} überfällig)` : ''}
          </span>
        </div>
      ) : null}
      {list.map((d) => (
        <InvoiceRow key={d.id} d={d} data={data} />
      ))}
      <InvoiceCapture projectId={p.id} compact />
    </div>
  );
}

// ---------- detail ----------
function Items({ d }) {
  const i = invOf(d);
  const items = i.items || [];
  const setItems = (next) => setInvoice(d.id, { items: next });
  const sum = items.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const total = Number(i.total) || 0;
  const net = Number(i.net) || 0;
  const fits = !items.length || !total || Math.abs(sum - total) < 1 || (net && Math.abs(sum - net) < 1);
  return (
    <div className="inv-items">
      {items.map((x) => (
        <div key={x.id} className="inv-item">
          <TextInput value={x.label} onChange={(v) => setItems(items.map((y) => (y.id === x.id ? { ...y, label: v } : y)))} placeholder="Position" />
          <NumInput value={x.amount} onChange={(v) => setItems(items.map((y) => (y.id === x.id ? { ...y, amount: v } : y)))} unit="€" digits={2} aria-label="Betrag" />
          <IconBtn icon="x" label="Position entfernen" size={15} onClick={() => setItems(items.filter((y) => y.id !== x.id))} />
          {x.qty || x.unitPrice ? (
            <span className="inv-item-sub">
              {x.qty ? `${String(x.qty).replace('.', ',')} ${x.unit || ''}` : ''}
              {x.unitPrice ? ` × ${fmtEuro(x.unitPrice)}` : ''}
            </span>
          ) : null}
        </div>
      ))}
      <div className="spread">
        <button className="link small" onClick={() => setItems([...items, { id: uid('ip'), label: '', amount: null }])}>
          + Position
        </button>
        {items.length ? <span className={`small ${fits ? 'muted' : 'warn-text'}`}>Summe Positionen {fmtEuro(sum)}{fits ? '' : ' – passt nicht zum Gesamtbetrag'}</span> : null}
      </div>
    </div>
  );
}

// all pages of the invoice: open, add (camera or gallery), remove
function InvoicePages({ d }) {
  const cam = useRef(null);
  const gal = useRef(null);
  const pages = pagesOf(d);
  if (!pages.length) return null;
  const add = (e) => {
    const f = [...e.target.files].filter((x) => x.type.startsWith('image/') || x.type === 'application/pdf');
    e.target.value = '';
    if (f.length) addPages(d, f);
  };
  return (
    <div className="inv-pages-strip">
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={add} />
      <input ref={gal} type="file" accept="image/*,application/pdf" multiple hidden onChange={add} />
      <span className="field-label">
        {pages.length} Seite{pages.length === 1 ? '' : 'n'}
      </span>
      <div className="inv-pages">
        {pages.map((pg, k) => {
          const url = fileUrl(pg);
          const img = (pg.contentType || '').startsWith('image/');
          return (
            <div key={k} className="inv-page">
              <a href={url || undefined} target="_blank" rel="noopener noreferrer" aria-label={`Seite ${k + 1} öffnen`}>
                {img && url ? <img src={url} alt={`Seite ${k + 1}`} loading="lazy" /> : <Icon name="file" size={20} />}
              </a>
              <span className="inv-page-n">{k + 1}</span>
              {pages.length > 1 ? (
                <button type="button" className="inv-page-x" aria-label={`Seite ${k + 1} entfernen`} onClick={() => removePage(d, k)}>
                  <Icon name="x" size={13} />
                </button>
              ) : null}
            </div>
          );
        })}
        <button type="button" className="inv-page inv-page-add" onClick={() => cam.current?.click()} title="Weitere Seite fotografieren">
          <Icon name="camera" size={18} />
          <span>Seite</span>
        </button>
        <button type="button" className="inv-page inv-page-add" onClick={() => gal.current?.click()} title="Seiten aus der Galerie hinzufügen">
          <Icon name="upload" size={18} />
          <span>Galerie</span>
        </button>
      </div>
    </div>
  );
}

export function InvoiceDrawer({ data, drawer }) {
  const d = data.documents?.[drawer.id];
  const busy = useReading().get(drawer.id);
  const avail = useAiAvailable();
  const fileRef = useRef(null);
  if (!d)
    return (
      <Drawer title="Rechnung nicht gefunden" onClose={closeDrawer}>
        <Empty title="Diese Rechnung existiert nicht mehr." />
      </Drawer>
    );
  const i = invOf(d);
  const set = (patch) => setInvoice(d.id, patch);
  const setDoc = (patch) => updateDoc('documents', d.id, (x) => ({ ...x, ...patch }), 300);
  const url = fileUrl(d);
  const isImg = (d.contentType || '').startsWith('image/');
  const hasFile = !!(d.assetId || d.dataUrl);
  const p = d.projectId ? data.projects?.[d.projectId] : null;
  const contact = d.contactId ? data.contacts?.[d.contactId] : null;
  const contacts = Object.values(data.contacts || {}).sort((a, b) => contactTitle(a).localeCompare(contactTitle(b)));
  const projects = Object.values(data.projects || {}).filter((x) => !x.archived || x.id === d.projectId);
  const remove = async () => {
    const a = await getAssets();
    for (const pg of pagesOf(d))
      if (pg.assetId)
        try {
          await a?.delete(pg.assetId);
        } catch {}
    deleteDoc('documents', d.id);
    closeDrawer();
    toast('Rechnung gelöscht');
  };
  const toCosts = () => {
    if (!p) return;
    const vendor = invVendor(d, data);
    const items = (i.items || []).filter((x) => Number(x.amount));
    // gross amounts: positions are often net, the project costs count what is paid
    const factor = items.length && i.total && i.net && Math.abs(items.reduce((s, x) => s + Number(x.amount), 0) - i.net) < 1 ? i.total / i.net : 1;
    if (items.length) for (const x of items) addCost(p.id, { label: x.label, actual: Math.round(Number(x.amount) * factor * 100) / 100, vendor, contactId: d.contactId, note: `Rechnung ${i.number || ''}`.trim() });
    else addCost(p.id, { label: `Rechnung ${i.number || ''} ${vendor}`.trim(), actual: invTotal(d), vendor, contactId: d.contactId });
    set({ costsAdded: true });
    toast(`${items.length || 1} Position${(items.length || 1) > 1 ? 'en' : ''} als Ist-Kosten in „${p.title}“ übernommen`);
  };
  return (
    <Drawer
      eyebrow={`${INV_KINDS.find((k) => k.key === i.kind)?.name || 'Rechnung'}${p ? ' · ' + p.title : ' · allgemein'}`}
      title={busy ? 'Wird ausgelesen …' : invTitle(d, data)}
      icon="euro"
      onClose={closeDrawer}
      className="inv-drawer"
      footer={
        <>
          <ConfirmBtn confirmText="Rechnung löschen?" onConfirm={remove} />
          {hasFile && avail !== false ? (
            <Btn kind="ai" icon="sparkles" disabled={!!busy} onClick={() => rereadInvoice(d)}>
              {busy ? 'Liest …' : 'Neu auslesen'}
            </Btn>
          ) : null}
        </>
      }
    >
      <div className="inv-head">
        <div className="inv-preview">
          {hasFile && url ? (
            isImg ? (
              <a href={url} target="_blank" rel="noopener noreferrer" title="Rechnung groß öffnen">
                <img src={url} alt={d.name} />
              </a>
            ) : (
              <a className="inv-pdf" href={url} target="_blank" rel="noopener noreferrer">
                <Icon name="file" size={26} />
                <span>PDF öffnen</span>
              </a>
            )
          ) : (
            <div className="inv-pdf">
              <Icon name="file" size={22} />
              <span>{hasFile ? 'Lädt …' : 'Ohne Beleg'}</span>
              {!hasFile ? (
                <>
                  <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { await addPages(d, [f]); if (avail !== false) readInto(d.id, [f]); } }} />
                  <button className="link small" onClick={() => fileRef.current?.click()}>
                    Beleg anhängen
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>
        <div className="inv-amount">
          <span className="field-label">Gesamtbetrag</span>
          <b>{fmtEuro(invTotal(d))}</b>
          {i.status === 'teilbezahlt' ? <span className="small">offen {fmtEuro(invOpen(d))}</span> : null}
          {isOverdue(d) ? <Pill tone="danger">überfällig seit {fmtDate(i.due)}</Pill> : null}
          {i.skonto?.percent ? <span className="small muted">{String(i.skonto.percent).replace('.', ',')} % Skonto{i.skonto.until ? ` bis ${fmtDate(i.skonto.until)}` : ''}</span> : null}
        </div>
      </div>
      <InvoicePages d={d} />
      {busy ? <div className="callout"><span className="spin-dot" /> {busy}</div> : null}
      {i.summary ? <p className="ai-summary">{i.summary}</p> : null}
      {(i.warnings || []).length ? (
        <ul className="small inv-warn">
          {i.warnings.map((w, k) => (
            <li key={k}>{w}</li>
          ))}
        </ul>
      ) : null}

      <Section title="Status">
        <Seg small value={i.status || 'offen'} onChange={(v) => setInvoiceStatus(d.id, v)} options={INV_STATUS.map((s) => ({ value: s.key, label: s.name }))} />
        {i.status === 'teilbezahlt' ? (
          <div className="grid2" style={{ marginTop: 10 }}>
            <Field label="Bereits bezahlt">
              <NumInput value={i.paid} onChange={(v) => set({ paid: v })} unit="€" digits={2} />
            </Field>
            <Field label="Noch offen">
              <div className="input inv-ro">{fmtEuro(invOpen(d))}</div>
            </Field>
          </div>
        ) : null}
        {i.status === 'bezahlt' ? (
          <Field label="Bezahlt am">
            <DateInput value={i.paidAt} onChange={(v) => set({ paidAt: v })} />
          </Field>
        ) : null}
      </Section>

      <Section title="Rechnungsdaten">
        <div className="grid2">
          <Field label="Rechnungsnummer">
            <TextInput value={i.number || ''} onChange={(v) => set({ number: v })} placeholder="z. B. RE-2026-0142" />
          </Field>
          <Field label="Art">
            <Select value={i.kind || 'rechnung'} onChange={(v) => set({ kind: v })} options={INV_KINDS.map((k) => ({ value: k.key, label: k.name }))} />
          </Field>
          <Field label="Rechnungsdatum">
            <DateInput value={i.date} onChange={(v) => set({ date: v })} />
          </Field>
          <Field label="Fällig am">
            <DateInput value={i.due} onChange={(v) => set({ due: v })} />
          </Field>
        </div>
        <div className="grid3">
          <Field label="Netto">
            <NumInput value={i.net} onChange={(v) => set({ net: v })} unit="€" digits={2} />
          </Field>
          <Field label="MwSt.">
            <NumInput value={i.vat} onChange={(v) => set({ vat: v })} unit="€" digits={2} />
          </Field>
          <Field label="Gesamt (brutto)">
            <NumInput value={i.total} onChange={(v) => set({ total: v })} unit="€" digits={2} />
          </Field>
        </div>
        {i.terms || i.iban ? (
          <div className="small muted">
            {i.terms ? <div>Zahlungsbedingungen: {i.terms}</div> : null}
            {i.iban ? <div>IBAN: {i.iban}</div> : null}
          </div>
        ) : null}
      </Section>

      <Section title="Absender & Zuordnung">
        <Field label="Kontakt (Ansprechpartner)">
          <Select value={d.contactId || ''} placeholder="– kein Kontakt –" onChange={(v) => setDoc({ contactId: v || null })} options={contacts.map((c) => ({ value: c.id, label: contactTitle(c) + (c.company && c.name ? ` (${c.name})` : '') }))} />
        </Field>
        {contact ? (
          <button className="link small" onClick={() => openDrawer({ type: 'contact', id: contact.id })}>
            Kontakt „{contactTitle(contact)}“ öffnen →
          </button>
        ) : i.vendor ? (
          <Btn small icon="plus" onClick={() => { const cid = contactFromInvoice(d); toast(`Kontakt „${i.vendor}“ angelegt`); openDrawer({ type: 'contact', id: cid }); }}>
            „{i.vendor}“ als Kontakt anlegen
          </Btn>
        ) : null}
        <Field label="Projekt">
          <Select value={d.projectId || ''} placeholder="Allgemein (ohne Projekt)" onChange={(v) => setDoc({ projectId: v || null })} options={projects.map((x) => ({ value: x.id, label: x.title }))} />
        </Field>
        {i.projectReason && d.projectId ? <p className="small muted">KI-Zuordnung: {i.projectReason}</p> : null}
        {p ? (
          i.costsAdded ? (
            <p className="small muted">✓ Als Ist-Kosten in „{p.title}“ übernommen.</p>
          ) : (
            <Btn small icon="euro" onClick={toCosts}>
              Als Ist-Kosten ins Projekt übernehmen
            </Btn>
          )
        ) : null}
      </Section>

      <Section title={`Positionen (${(i.items || []).length})`}>
        <Items d={d} />
      </Section>

      <Field label="Notizen">
        <TextInput multiline rows={2} value={d.notes || ''} onChange={(v) => setDoc({ notes: v })} placeholder="z. B. überwiesen per Online-Banking, Rückfrage zu Position 3 …" />
      </Field>
    </Drawer>
  );
}
