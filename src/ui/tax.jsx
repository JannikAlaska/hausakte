// Tax helper UI: the "Steuer" part of an invoice and the yearly overview (Dokumente › Steuer) with
// § 35a (craftsmen, household services) and § 35c (energetic measures), checks and export as PDF / CSV.
import { Icon } from './icons.jsx';
import { Btn, Field, NumInput, Select, Toggle, Section, Pill, Empty } from './common.jsx';
import { useAiAvailable } from './ai-ui.jsx';
import { toast, openDrawer, closeDrawer, setUI, go } from './state.js';
import { getState, updateDoc } from '../store.js';
import { patchProject } from '../actions.js';
import { aiTaxClassify, aiErrorText } from '../ai.js';
import { invOf, taxFromAi } from '../invoices.js';
import { TAX_KINDS, TAX_RESEARCH_DATE, taxKind, taxOf, setTax, taxLine, taxRules, taxYear, taxYears, is35a, is35c, taxCsv, taxPdfDoc } from '../tax.js';
import { buildPdf } from '../pdf.js';
import { saveFile } from '../download.js';
import { fmtDate } from '../util.js';

const { useState, useEffect } = React;
const fmtEuro = (n) => (n == null || !Number.isFinite(Number(n)) ? '–' : Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
const pct = (r) => `${Math.round(r * 100)} %`;

// ---------- AI classification of invoices already entered ----------
const busy = new Set();
const subs = new Set();
const notify = () => subs.forEach((f) => f());
function useTaxBusy() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return busy;
}

export async function classifyInvoices(ids, { quiet = false } = {}) {
  const st = getState();
  const docs = ids.map((id) => st.documents?.[id]).filter((d) => d && !busy.has(d.id));
  if (!docs.length) return 0;
  docs.forEach((d) => busy.add(d.id));
  notify();
  let n = 0;
  try {
    for (let k = 0; k < docs.length; k += 15) {
      const chunk = docs.slice(k, k + 15);
      const r = await aiTaxClassify(chunk, getState());
      for (const it of Array.isArray(r?.items) ? r.items : []) {
        if (!chunk.some((c) => c.id === it.id) || !getState().documents?.[it.id]) continue;
        updateDoc('documents', it.id, (x) => ({ ...x, inv: { ...(x.inv || {}), tax: taxFromAi(it, x.inv?.tax || {}) } }), 50);
        n++;
      }
    }
    if (!quiet) toast(n ? `${n} Rechnung${n === 1 ? '' : 'en'} steuerlich eingeordnet – bitte kurz prüfen.` : 'Die KI konnte keine Rechnung einordnen.', n ? 'ok' : 'warn', 5000);
  } catch (e) {
    if (!quiet) toast('Die KI konnte die Rechnungen nicht einordnen: ' + aiErrorText(e), 'warn', 6000);
  } finally {
    docs.forEach((d) => busy.delete(d.id));
    notify();
  }
  return n;
}

function Issues({ issues }) {
  if (!issues.length) return null;
  return (
    <ul className="tax-issues">
      {issues.map((x, k) => (
        <li key={k} className={`tax-issue is-${x.level}`}>
          <Icon name={x.level === 'info' ? 'info' : 'alert'} size={14} />
          <span>{x.text}</span>
        </li>
      ))}
    </ul>
  );
}

// estimate for one invoice (without the yearly caps of other invoices); unpaid ones: what it brings once paid
const unpaidOnly = (line) => {
  const stops = line.issues.filter((x) => x.level === 'stop');
  return stops.length > 0 && stops.every((x) => /^(Noch nicht bezahlt|Erst teilweise bezahlt)/.test(x.text));
};
function estimate(line) {
  if (!line.counted && !(unpaidOnly(line) && line.base > 0)) return null;
  const e = estimateOf(line);
  return e && !line.counted ? { ...e, title: `Nach Zahlung ca. ${fmtEuro(e.amount)} Steuerersparnis`, text: e.text.replace(/ · Steuerjahr \d{4}/, ' · zählt im Jahr der Zahlung') } : e;
}
function estimateOf(line) {
  const y = line.year || new Date().getFullYear();
  const R = taxRules(y);
  if (is35a(line.kind)) {
    const r = R[line.kind];
    return { amount: Math.min(line.base * r.rate, r.max), text: `${pct(r.rate)} von ${fmtEuro(line.base)} Arbeitskosten · Steuerjahr ${y} (Höchstbetrag ${fmtEuro(r.max)} für alle Rechnungen zusammen)` };
  }
  if (line.kind === 'energie') return { amount: line.base * 0.2, text: `20 % von ${fmtEuro(line.base)}, verteilt auf das Jahr des Abschlusses der Maßnahme und die zwei Jahre danach (7 / 7 / 6 %)` };
  if (line.kind === 'beratung') return { amount: line.base * R.c.advisor, text: `${pct(R.c.advisor)} der Kosten im Jahr des Abschlusses der Maßnahme` };
  return null;
}

const openTax = () => {
  closeDrawer();
  setUI({ docTab: 'steuer' });
  go('dokumente');
};

// ---------- section in the invoice drawer ----------
export function TaxSection({ d, data }) {
  const t = taxOf(d);
  const line = taxLine(d, data);
  const k = taxKind(t.kind);
  const avail = useAiAvailable();
  const working = useTaxBusy().has(d.id);
  const set = (patch) => setTax(d.id, { ...patch, source: 'manuell' });
  const est = estimate(line);
  const issues = line.issues.filter((x) => !(x.text.startsWith('Noch nicht eingeordnet') && !t.kind));
  return (
    <Section
      title="Steuer"
      aside={k ? <Pill tone={line.counted ? 'accent' : k.key === 'keine' ? 'neutral' : 'warn'}>{k.short}</Pill> : <Pill tone="neutral">offen</Pill>}
      className="tax-sec"
    >
      <Field label="Einordnung">
        <Select value={t.kind || ''} placeholder="– noch nicht eingeordnet –" onChange={(v) => set({ kind: v || null })} options={TAX_KINDS.map((x) => ({ value: x.key, label: `${x.name}${x.law ? ` (${x.law})` : ''}` }))} />
      </Field>
      {k ? <p className="small muted tax-hint">{k.hint}</p> : null}
      {!t.kind && avail !== false ? (
        <Btn small kind="ai" icon="sparkles" disabled={working} onClick={() => classifyInvoices([d.id])}>
          {working ? 'KI ordnet ein …' : 'Mit KI einordnen'}
        </Btn>
      ) : null}
      {is35a(t.kind) ? (
        <div className="grid2">
          <Field label="Arbeits-, Fahrt- & Maschinenkosten" hint="brutto, inkl. MwSt. – ohne Material">
            <NumInput value={t.labor} onChange={(v) => set({ labor: v })} unit="€" digits={2} />
          </Field>
          <div className="tax-toggles">
            <Toggle checked={t.laborShown !== false} onChange={(v) => set({ laborShown: v })} label="Steht gesondert auf der Rechnung" />
          </div>
        </div>
      ) : null}
      {t.kind && t.kind !== 'keine' ? (
        <div className="tax-toggles">
          <Toggle checked={!!t.cash} onChange={(v) => set({ cash: v })} label="Bar bezahlt" />
          {line.funded ? <Toggle checked={!!t.override} onChange={(v) => set({ override: v })} label="Trotzdem ansetzen – dieser Teil ist nicht gefördert" /> : null}
        </div>
      ) : null}
      {t.kind === 'energie' && line.project ? (
        <div className="tax-toggles">
          <Toggle checked={!!line.project.tax35c?.cert} onChange={(v) => patchProject(line.project.id, (x) => ({ ...x, tax35c: { ...(x.tax35c || {}), cert: v } }))} label={`Bescheinigung des Fachunternehmens liegt vor (${line.project.title})`} />
        </div>
      ) : null}
      <Issues issues={t.kind ? issues : []} />
      {est ? (
        <div className="callout callout-accent tax-est">
          <Icon name="euro" size={16} />
          <div>
            <b>{est.title || `Steuerersparnis ca. ${fmtEuro(est.amount)}`}</b>
            <div>{est.text}</div>
          </div>
        </div>
      ) : null}
      {t.reason && t.source === 'ki' ? <p className="small muted">KI: {t.reason}</p> : null}
      <button className="link small" onClick={openTax}>
        Zur Steuer-Übersicht →
      </button>
    </Section>
  );
}

// ---------- yearly overview ----------
function TaxRow({ l, right, sub }) {
  const i = invOf(l.d);
  return (
    <button type="button" className="tax-row" onClick={() => openDrawer({ type: 'invoice', id: l.d.id })}>
      <span className="tax-row-main">
        <b>{l.vendor || 'Absender unbekannt'}</b>
        <span>{[i.paidAt ? `bezahlt ${fmtDate(i.paidAt)}` : i.date ? fmtDate(i.date) : null, i.number ? `Nr. ${i.number}` : null, l.project?.title || null].filter(Boolean).join(' · ')}</span>
        {sub ? <span className="tax-row-sub">{sub}</span> : null}
      </span>
      <span className="tax-row-side">{right}</span>
    </button>
  );
}

function PartCard({ title, law, part }) {
  const share = part.max ? Math.min(1, part.deduction / part.max) : 0;
  return (
    <div className="tax-card">
      <span className="tax-card-law">{law}</span>
      <b className="tax-card-title">{title}</b>
      <span className="tax-card-val">{fmtEuro(part.deduction)}</span>
      <span className="small muted">
        {pct(part.rate)} von {fmtEuro(part.sum)} Arbeitskosten
      </span>
      <span className="tax-bar" aria-hidden="true">
        <span style={{ width: `${share * 100}%` }} />
      </span>
      <span className="small muted">{part.raw >= part.max ? `Höchstbetrag ${fmtEuro(part.max)} erreicht` : `Höchstbetrag ${fmtEuro(part.max)} – noch ${fmtEuro(part.room)} Arbeitskosten möglich`}</span>
    </div>
  );
}

function Measure({ m, year }) {
  const p = m.project;
  const now = new Date().getFullYear();
  const years = [...new Set([m.year, ...Array.from({ length: 7 }, (_, k) => now - 3 + k)])].sort();
  const setP = (patch) => p && patchProject(p.id, (x) => ({ ...x, tax35c: { ...(x.tax35c || {}), ...patch } }));
  return (
    <div className="tax-measure">
      <div className="spread">
        <b>{m.title}</b>
        <span className="small">{fmtEuro(m.cost + m.advisor)}</span>
      </div>
      <div className="small muted">
        {m.lines.length} Rechnung{m.lines.length === 1 ? '' : 'en'}
        {m.advisor ? ` · davon Energieberater ${fmtEuro(m.advisor)}` : ''}
        {m.prelim ? ' · Maßnahme läuft noch – Verteilung vorläufig' : ''}
      </div>
      <div className="tax-sched">
        {m.schedule.map((s) => (
          <span key={s.year} className={`tax-sched-y ${s.year === year ? 'is-on' : ''}`}>
            <small>{s.year}</small>
            <b>{fmtEuro(s.amount)}</b>
          </span>
        ))}
      </div>
      {p ? (
        <div className="tax-measure-set">
          <Field label="Abgeschlossen im Jahr">
            <Select value={String(p.tax35c?.year || '')} placeholder={`automatisch (${m.year})`} onChange={(v) => setP({ year: v ? Number(v) : null })} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
          </Field>
          <Toggle checked={!!p.tax35c?.cert} onChange={(v) => setP({ cert: v })} label="Bescheinigung liegt vor" />
        </div>
      ) : null}
      <div className="tax-list">
        {m.lines.map((l) => (
          <TaxRow key={l.d.id} l={l} right={<b>{fmtEuro(l.base)}</b>} />
        ))}
      </div>
    </div>
  );
}

export function TaxPanel({ data }) {
  const now = new Date().getFullYear();
  const years = taxYears(data);
  const [year, setYear] = useState(now);
  const avail = useAiAvailable();
  const working = useTaxBusy();
  const ty = taxYear(data, year);
  const anyInvoice = Object.values(data.documents || {}).some((d) => d.type === 'rechnung');
  if (!anyInvoice)
    return (
      <Empty icon="euro" title="Noch keine Rechnungen">
        Erfasse Handwerker-Rechnungen unter „Rechnungen“ – hier siehst du dann, wie viel davon du von der Steuer absetzen kannst.
      </Empty>
    );
  const nextNote = taxRules(year + 1).note && !ty.rules.note && year === now;
  const pdf = () => {
    const doc = buildPdf(taxPdfDoc(ty, data.house), { title: `Steuer-Übersicht ${year}`, footer: `Hausakte · Steuer-Übersicht ${year}` });
    saveFile(`Steuer-Uebersicht-${year}.pdf`, 'application/pdf', doc);
  };
  const csv = () => saveFile(`Steuer-${year}.csv`, 'text/csv', taxCsv(ty));
  const unclassified = ty.unclassified.map((l) => l.d.id);
  const running = unclassified.some((id) => working.has(id));
  return (
    <div className="stack tax-panel">
      <div className="chips tax-years" role="tablist" aria-label="Steuerjahr">
        {years.map((y) => (
          <button key={y} className={`chip ${y === year ? 'is-on' : ''}`} onClick={() => setYear(y)}>
            {y}
          </button>
        ))}
      </div>
      <div className="tax-hero">
        <span>Steuerersparnis {year} (geschätzt)</span>
        <b>{fmtEuro(ty.total)}</b>
        <small>wird direkt von deiner Einkommensteuer abgezogen</small>
      </div>
      {ty.rules.note ? (
        <div className="callout callout-warn">
          <Icon name="alert" size={16} />
          <div>{ty.rules.note}</div>
        </div>
      ) : null}
      {nextNote && ty.handwerk.room > 0 ? (
        <div className="callout callout-info">
          <Icon name="info" size={16} />
          <div>
            <b>Tipp:</b> Bis zum Höchstbetrag {year} fehlen noch {fmtEuro(ty.handwerk.room)} Arbeitskosten. Für 2027 ist eine Kürzung auf 15 % / 900 € geplant – anstehende Handwerkerrechnungen lohnt es sich eher noch {year} zu bezahlen.
          </div>
        </div>
      ) : null}
      {unclassified.length ? (
        <div className="callout tax-unclassified">
          <Icon name="sparkles" size={16} />
          <div>
            <b>
              {unclassified.length} Rechnung{unclassified.length === 1 ? ' ist' : 'en sind'} noch nicht steuerlich eingeordnet.
            </b>
            <div>Die KI erkennt aus Absender und Positionen, ob es eine Handwerkerleistung ist und wie hoch die Arbeitskosten sind.</div>
            {avail !== false ? (
              <Btn small kind="ai" icon="sparkles" disabled={running} onClick={() => classifyInvoices(unclassified)}>
                {running ? 'KI ordnet ein …' : `Mit KI einordnen (${unclassified.length})`}
              </Btn>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="tax-cards">
        <PartCard title="Handwerkerleistungen" law="§ 35a Abs. 3" part={ty.handwerk} />
        <PartCard title="Haushaltsnahe Dienstleistungen" law="§ 35a Abs. 2" part={ty.haushalt} />
        <div className="tax-card">
          <span className="tax-card-law">§ 35c</span>
          <b className="tax-card-title">Energetische Maßnahmen</b>
          <span className="tax-card-val">{fmtEuro(ty.cSum)}</span>
          <span className="small muted">{ty.c.length ? `Anteil ${year} aus ${ty.c.length} Maßnahme${ty.c.length === 1 ? '' : 'n'}` : 'keine Maßnahme in diesem Jahr'}</span>
          <span className="small muted">20 % auf Lohn und Material, verteilt auf 3 Jahre, bis 40.000 €</span>
        </div>
      </div>

      {ty.check.length ? (
        <Section title={`Bitte prüfen (${ty.check.length})`} className="tax-check">
          <div className="tax-list">
            {ty.check.map((l) => (
              <TaxRow key={l.d.id} l={l} right={l.kind ? <Pill tone="warn">{taxKind(l.kind).short}</Pill> : <Pill>offen</Pill>} sub={<Issues issues={l.issues.filter((x) => x.level !== 'info')} />} />
            ))}
          </div>
        </Section>
      ) : null}

      {[
        ['Handwerkerleistungen', ty.handwerk],
        ['Haushaltsnahe Dienstleistungen', ty.haushalt],
      ].map(([title, part]) =>
        part.list.length ? (
          <Section key={title} title={`${title} ${year}`} aside={<span className="small muted">{fmtEuro(part.sum)}</span>}>
            <div className="tax-list">
              {part.list.map((l) => (
                <TaxRow
                  key={l.d.id}
                  l={l}
                  right={
                    <>
                      <b>{fmtEuro(l.base)}</b>
                      <small>≈ {fmtEuro(l.base * part.rate)}</small>
                    </>
                  }
                  sub={l.issues.some((x) => x.level === 'warn') ? <Issues issues={l.issues.filter((x) => x.level === 'warn')} /> : null}
                />
              ))}
            </div>
          </Section>
        ) : null,
      )}

      {ty.measures.length ? (
        <Section title="Energetische Maßnahmen (§ 35c)">
          {ty.measures.map((m) => (
            <Measure key={m.key} m={m} year={year} />
          ))}
        </Section>
      ) : null}

      {ty.pending.length ? (
        <p className="small muted">
          {ty.pending.length} eingeordnete Rechnung{ty.pending.length === 1 ? ' ist noch nicht bezahlt – sie zählt' : 'en sind noch nicht bezahlt – sie zählen'} im Jahr der Zahlung.
        </p>
      ) : null}

      <div className="tax-export">
        <Btn icon="download" onClick={pdf}>
          Übersicht als PDF
        </Btn>
        <Btn icon="download" onClick={csv}>
          Tabelle (CSV)
        </Btn>
      </div>
      <p className="small muted">
        Vereinfachte Berechnung ohne Gewähr, keine Steuerberatung. Voraussetzungen: Rechnung und Zahlung aufs Konto, selbst genutztes Haus, keine Förderung für dieselbe Maßnahme; Höchstbeträge gelten je Haushalt. § 35a zählt im Jahr der Zahlung, § 35c ab dem Jahr, in dem die Maßnahme abgeschlossen ist. Stand der Regeln: {TAX_RESEARCH_DATE}.
      </p>
    </div>
  );
}
