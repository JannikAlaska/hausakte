// The areas "Energie" (consumption, heat load & heat pump, sun & PV) and "Finanzen" (budget & funding,
// invoices, tax, applications). Each is one sheet with tabs; the content comes from the existing views.
import { Icon } from './icons.jsx';
import { Sheet, Pill, Empty } from './common.jsx';
import { useUI, setUI, go, openDrawer } from './state.js';
import { ConsumptionSheet, AddReading } from './consumption.jsx';
import { HeatCheck } from './energy.jsx';
import { SolarCheck } from './solar.jsx';
import { InvoicesPanel } from './invoices.jsx';
import { TaxPanel } from './tax.jsx';
import { ApplicationsPanel } from './applications.jsx';
import { liveProjects, projectCost, isDone } from '../metrics.js';
import { invoiceDocs, invoiceSums, invOf, invPaid, invOpen } from '../invoices.js';
import { FUNDING_TYPES, FUNDING_STATUS } from '../catalog.js';
import { applications } from '../applications.js';
import { fmtEuro, fmtDate } from '../util.js';

// ---------- Energie ----------
const ENERGY_TABS = [
  { key: 'verbrauch', label: 'Verbrauch', icon: 'chart' },
  { key: 'heizlast', label: 'Heizlast & Wärmepumpe', icon: 'flame' },
  { key: 'pv', label: 'Sonne & PV', icon: 'sun' },
];

export function EnergySheet({ data }) {
  const ui = useUI();
  const tab = ENERGY_TABS.some((t) => t.key === ui.energyTab) ? ui.energyTab : 'verbrauch';
  const readings = Object.values(data.readings || {});
  return (
    <Sheet
      title="Energie"
      icon="bolt"
      eyebrow={`${readings.length} Verbrauchswerte`}
      onClose={() => go('modell')}
      actions={tab === 'verbrauch' ? <AddReading /> : null}
      tabs={ENERGY_TABS.map((t) => ({ ...t, count: t.key === 'verbrauch' ? readings.length || null : null }))}
      tab={tab}
      onTab={(t) => setUI({ energyTab: t })}
    >
      {tab === 'heizlast' ? <HeatCheck data={data} /> : tab === 'pv' ? <SolarCheck data={data} /> : <ConsumptionSheet data={data} embedded />}
    </Sheet>
  );
}

// ---------- Finanzen ----------
const FIN_TABS = [
  { key: 'budget', label: 'Budget & Förderung', icon: 'chart' },
  { key: 'rechnungen', label: 'Rechnungen', icon: 'euro' },
  { key: 'steuer', label: 'Steuer', icon: 'percent' },
  { key: 'antraege', label: 'Anträge', icon: 'flag' },
];

export function FinanceSheet({ data }) {
  const ui = useUI();
  const tab = FIN_TABS.some((t) => t.key === ui.finTab) ? ui.finTab : 'budget';
  const invoices = invoiceDocs(data);
  const apps = applications(data);
  return (
    <Sheet
      title="Finanzen"
      icon="euro"
      eyebrow={`${invoices.length} Rechnungen · ${apps.length} Anträge`}
      onClose={() => go('modell')}
      tabs={FIN_TABS.map((t) => ({ ...t, count: t.key === 'rechnungen' ? invoices.length || null : t.key === 'antraege' ? apps.length || null : null }))}
      tab={tab}
      onTab={(t) => setUI({ finTab: t })}
    >
      {tab === 'rechnungen' ? <InvoicesPanel data={data} /> : tab === 'steuer' ? <TaxPanel data={data} /> : tab === 'antraege' ? <ApplicationsPanel data={data} /> : <BudgetPanel data={data} />}
    </Sheet>
  );
}

// budget, payments and funding of all projects at a glance
function BudgetPanel({ data }) {
  const live = liveProjects(data.projects);
  const invs = invoiceDocs(data);
  const rows = live
    .map((p) => {
      const c = projectCost(p);
      const pi = invs.filter((d) => d.projectId === p.id);
      const paid = pi.reduce((s, d) => s + invPaid(d), 0);
      const open = pi.reduce((s, d) => s + invOpen(d), 0);
      return { p, c, paid, open, own: Math.max(0, c.best - c.funding) };
    })
    .sort((a, b) => Number(isDone(a.p)) - Number(isDone(b.p)) || b.c.best - a.c.best);
  const sum = (k) => rows.reduce((s, r) => s + (typeof k === 'function' ? k(r) : r[k]), 0);
  const general = invs.filter((d) => !d.projectId);
  const gs = invoiceSums(general);
  const funding = live.flatMap((p) => (p.funding || []).map((f) => ({ f, p }))).sort((a, b) => (a.f.deadline || '9') < (b.f.deadline || '9') ? -1 : 1);
  const all = invoiceSums(invs);
  const openProject = (p, section) => openDrawer({ type: 'project', id: p.id, tab: section });
  return (
    <div className="stack">
      <div className="stat-grid">
        <div className="stat">
          <span>Budget geplant</span>
          <b>{fmtEuro(sum((r) => r.c.best))}</b>
          <small>{rows.length} Projekte</small>
        </div>
        <div className="stat">
          <span>Förderung</span>
          <b>{fmtEuro(sum((r) => r.c.funding))}</b>
          <small>davon gesichert {fmtEuro(sum((r) => r.c.fundingSecured))}</small>
        </div>
        <div className="stat">
          <span>Eigenanteil</span>
          <b>{fmtEuro(sum('own'))}</b>
          <small>Budget minus Förderung</small>
        </div>
        <div className="stat">
          <span>Rechnungen</span>
          <b>{fmtEuro(all.paid)}</b>
          <small>bezahlt · offen {fmtEuro(all.open)}</small>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Je Projekt</h3>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="tbl fin-tbl">
              <thead>
                <tr>
                  <th>Projekt</th>
                  <th className="r">Budget</th>
                  <th className="r">Förderung</th>
                  <th className="r">Bezahlt</th>
                  <th className="r">Offen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.p.id} className="clickable" onClick={() => openProject(r.p, 'kosten')}>
                    <td>
                      {r.p.title}
                      {isDone(r.p) ? <Pill>fertig</Pill> : null}
                    </td>
                    <td className="r">{r.c.best ? fmtEuro(r.c.best) : '–'}</td>
                    <td className="r">{r.c.funding ? fmtEuro(r.c.funding) : '–'}</td>
                    <td className="r">{r.paid ? fmtEuro(r.paid) : '–'}</td>
                    <td className={`r ${r.open ? 'warn-text' : ''}`}>{r.open ? fmtEuro(r.open) : '–'}</td>
                  </tr>
                ))}
                {general.length ? (
                  <tr className="clickable" onClick={() => go('rechnungen')}>
                    <td className="muted">Allgemein (ohne Projekt)</td>
                    <td className="r">–</td>
                    <td className="r">–</td>
                    <td className="r">{gs.paid ? fmtEuro(gs.paid) : '–'}</td>
                    <td className={`r ${gs.open ? 'warn-text' : ''}`}>{gs.open ? fmtEuro(gs.open) : '–'}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="tasks" title="Noch keine Projekte">
            Lege Projekte an – Kosten, Förderung und Rechnungen erscheinen dann hier zusammengefasst.
          </Empty>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Förderungen ({funding.length})</h3>
          <button className="link small" onClick={() => setUI({ finTab: 'antraege' })}>
            Antrag vorbereiten →
          </button>
        </div>
        {funding.length ? (
          <ul className="fin-funding">
            {funding.map(({ f, p }) => (
              <li key={p.id + f.id}>
                <button type="button" className="fin-fund" onClick={() => openProject(p, 'foerderung')}>
                  <span className="fin-fund-main">
                    <b>{f.program}</b>
                    <span>
                      {p.title}
                      {f.provider ? ` · ${f.provider}` : ''} · {FUNDING_TYPES.find((t) => t.key === f.type)?.name || f.type}
                      {f.deadline ? ` · Frist ${fmtDate(f.deadline)}` : ''}
                    </span>
                  </span>
                  <span className="fin-fund-side">
                    {f.amount ? <b>{fmtEuro(f.amount)}</b> : null}
                    <Pill tone={['bewilligt', 'ausgezahlt'].includes(f.status) ? 'accent' : f.status === 'abgelehnt' ? 'danger' : f.status === 'beantragt' ? 'info' : 'neutral'}>{FUNDING_STATUS.find((s) => s.key === f.status)?.name || f.status}</Pill>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">Noch keine Förderung erfasst. Im Projekt unter „Geld“ prüft die KI passende Programme, der Antragsassistent hilft beim Ausfüllen.</p>
        )}
      </div>
    </div>
  );
}
