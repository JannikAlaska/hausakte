import { Icon } from './icons.jsx';
import { Btn, IconBtn, Field, NumInput, Select, DateInput, TextInput, Pill, Sheet, Empty, Seg, ConfirmBtn } from './common.jsx';
import { AiRunner } from './ai-ui.jsx';
import { go, toast } from './state.js';
import { MEDIA, medium, ENERGY_CLASSES, energyClass } from '../catalog.js';
import { consumptionByYear, heatingIndex, buildingStats, toKwh } from '../metrics.js';
import { updateDoc, deleteDoc, updateHouse } from '../store.js';
import { addReading } from '../actions.js';
import { aiConsumption } from '../ai.js';
import { fmtNum, fmtEuro, fmtDate, fmtFixed } from '../util.js';

const { useState, useMemo } = React;

// kg CO2 per kWh final energy (orientation values, GEG annex 9)
const CO2 = { strom: 0.56, gas: 0.24, oel: 0.31, pellets: 0.02, fernwaerme: 0.28, wp: 0.56 };

const SERIES = [
  { key: 'heat', label: 'Heizenergie', unit: 'kWh', color: 'var(--c-gas)' },
  { key: 'strom', label: 'Strom', unit: 'kWh', color: 'var(--c-strom)' },
  { key: 'wasser', label: 'Wasser', unit: 'm³', color: 'var(--c-wasser)' },
  { key: 'cost', label: 'Kosten', unit: '€', color: 'var(--violet)' },
];

function niceScale(v) {
  if (!(v > 0)) return { max: 1, step: 0.25 };
  const rough = v / 4;
  const p = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= rough);
  return { max: Math.ceil(v / step) * step, step };
}

function BarChart({ rows, unit, color }) {
  const [hover, setHover] = useState(null);
  const W = 640,
    H = 230,
    L = 56,
    R = 12,
    T = 18,
    B = 28;
  const { max, step } = niceScale(Math.max(...rows.map((r) => r.v), 0) * 1.05);
  const ticks = [];
  for (let t = 0; t <= max + step / 2; t += step) ticks.push(t);
  const n = rows.length || 1;
  const slot = (W - L - R) / n;
  const bw = Math.min(46, slot * 0.56);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const fmtV = (v) => (unit === '€' ? fmtEuro(v) : `${fmtNum(v, 0)} ${unit}`);
  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Balkendiagramm ${unit} pro Jahr`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line className="grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end">
              {fmtNum(t, t < 10 ? 1 : 0)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = L + slot * i + (slot - bw) / 2;
          const h = Math.max(0, y(0) - y(r.v));
          const rr = Math.min(4, h / 2);
          return (
            <g key={r.year} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + slot * i} y={T} width={slot} height={H - T - B} fill="transparent" />
              {h > 0 ? (
                <path
                  d={`M${x},${y(0)} V${y(r.v) + rr} Q${x},${y(r.v)} ${x + rr},${y(r.v)} H${x + bw - rr} Q${x + bw},${y(r.v)} ${x + bw},${y(r.v) + rr} V${y(0)} Z`}
                  fill={color}
                  opacity={hover == null || hover === i ? 1 : 0.45}
                />
              ) : null}
              <text x={x + bw / 2} y={H - 8} textAnchor="middle">
                {r.year}
              </text>
              {i === rows.length - 1 && h > 0 ? (
                <text x={x + bw / 2} y={y(r.v) - 6} textAnchor="middle" style={{ fill: 'var(--ink)', fontWeight: 600 }}>
                  {unit === '€' ? fmtNum(r.v, 0) : fmtNum(r.v, 0)}
                </text>
              ) : null}
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--line-2)" strokeWidth="1" />
      </svg>
      {hover != null && rows[hover] ? (
        <div
          className="selcard"
          style={{ position: 'absolute', left: `${((L + slot * hover + slot / 2) / W) * 100}%`, top: 0, bottom: 'auto', width: 'auto', transform: 'translateX(-50%)', padding: '6px 10px', pointerEvents: 'none', whiteSpace: 'nowrap' }}
        >
          <b className="small">{rows[hover].year}</b>
          <div className="small">{fmtV(rows[hover].v)}</div>
          {rows[hover].sub ? <div className="small muted">{rows[hover].sub}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function ClassBar({ value }) {
  const cls = value ? energyClass(value) : null;
  return (
    <div>
      <div className="ec-bar" role="img" aria-label={cls ? `Effizienzklasse ${cls.c}` : 'Keine Effizienzklasse'}>
        {ENERGY_CLASSES.map((e) => (
          <span key={e.c} style={{ background: e.color }} className={cls?.c === e.c ? 'is-on' : ''}>
            {e.c}
          </span>
        ))}
      </div>
      <div className="spread small muted" style={{ marginTop: 4 }}>
        <span>0</span>
        <span>kWh/(m²·a) Endenergie</span>
        <span>&gt; 250</span>
      </div>
    </div>
  );
}

export function ConsumptionSheet({ data }) {
  const readings = Object.values(data.readings);
  const st = buildingStats(data.house, Object.values(data.floors));
  const years = consumptionByYear(readings);
  const hi = heatingIndex(readings, st.living);
  const [series, setSeries] = useState('heat');
  const ys = Object.keys(years).sort();
  const lastY = ys[ys.length - 1];
  const last = lastY ? years[lastY] : {};
  const co2 = Object.entries(last).reduce((s, [k, v]) => s + (CO2[k] ? v.kwh * CO2[k] : 0), 0);
  const costLast = Object.values(last).reduce((s, v) => s + v.cost, 0);
  const rows = ys.map((y) => {
    const e = years[y];
    if (series === 'heat') {
      const heat = Object.entries(e).filter(([k]) => medium(k).heat).reduce((s, [, v]) => s + v.kwh, 0);
      return { year: y, v: heat, sub: st.living ? `${fmtNum(heat / st.living, 0)} kWh/m²` : null };
    }
    if (series === 'cost') return { year: y, v: Object.values(e).reduce((s, v) => s + v.cost, 0) };
    return { year: y, v: e[series]?.amount || 0 };
  });
  const S = SERIES.find((s) => s.key === series);
  return (
    <Sheet title="Verbräuche" icon="chart" eyebrow={`${readings.length} Einträge`} onClose={() => go('modell')} actions={<AddReading />}>
      {!readings.length ? (
        <div className="stack">
          <Empty icon="chart" title="Noch keine Verbräuche">
            Trage die Werte aus deinen Jahresabrechnungen für Strom, Gas/Öl und Wasser ein. Daraus berechnet die Hausakte den Energiekennwert und die Effizienzklasse.
          </Empty>
          <ReadingForm />
        </div>
      ) : (
        <div className="stack">
          <div className="stat-grid">
            <div className="stat">
              <span>Heizenergie {hi.last?.year || ''}</span>
              <b>{hi.last ? fmtNum(hi.last.heat, 0) : '–'} kWh</b>
              <small>{hi.last?.perM2 ? `${fmtNum(hi.last.perM2, 0)} kWh/m² · Klasse ${hi.cls.c}` : 'Wohnfläche fehlt'}</small>
            </div>
            <div className="stat">
              <span>Strom {lastY}</span>
              <b>{last.strom ? fmtNum(last.strom.amount, 0) : '–'} kWh</b>
              <small>{data.house.persons ? `${fmtNum((last.strom?.amount || 0) / data.house.persons, 0)} kWh je Person` : ''}</small>
            </div>
            <div className="stat">
              <span>Energiekosten {lastY}</span>
              <b>{fmtEuro(costLast)}</b>
              <small>{fmtEuro(costLast / 12)} pro Monat</small>
            </div>
            <div className="stat">
              <span>CO₂ {lastY}</span>
              <b>{fmtFixed(co2 / 1000, 1)} t</b>
              <small>Orientierungswerte GEG</small>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>Effizienzklasse aus Verbrauch</h3>
              {data.house.energyCert?.cls ? <Pill>Energieausweis: {data.house.energyCert.cls}</Pill> : null}
            </div>
            <ClassBar value={hi.last?.perM2} />
            <p className="small muted" style={{ marginTop: 8 }}>
              Heizenergie {hi.last?.year} geteilt durch {fmtFixed(st.living, 0)} m² Wohnfläche. Ohne Witterungsbereinigung – ein Verbrauchsausweis kann abweichen.
            </p>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>
                {S.label} pro Jahr <span className="muted small">({S.unit})</span>
              </h3>
              <Seg small value={series} onChange={setSeries} options={SERIES.map((s) => ({ value: s.key, label: s.label }))} />
            </div>
            <BarChart rows={rows} unit={S.unit} color={S.color} />
          </div>
          <AiRunner
            title="Verbrauch analysieren"
            icon="chart"
            desc="Vergleicht deine Werte mit typischen Häusern gleicher Größe und Baujahr und schlägt Einsparmaßnahmen vor."
            saved={data.house?.ai?.consumption}
            run={(signal) => aiConsumption(data, { signal })}
            onSave={(rec) => updateHouse((h) => ({ ...h, ai: { ...(h.ai || {}), consumption: rec } }), 100)}
            cta="Analysieren"
            render={(r) => (
              <div className="stack" style={{ gap: 8 }}>
                {r.summary ? <p className="ai-summary">{r.summary}</p> : null}
                {r.benchmark ? <div className="callout"><Icon name="chart" size={16} /><span>{r.benchmark}</span></div> : null}
                {(r.findings || []).length ? (
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {r.findings.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                ) : null}
                <ul className="ai-list">
                  {(r.tips || []).map((t, i) => (
                    <li key={i} className="ai-item">
                      <div className="ai-item-head">
                        <b>{t.title}</b>
                        {t.effort ? <Pill>{t.effort === 'gering' ? 'wenig Aufwand' : t.effort === 'mittel' ? 'mittlerer Aufwand' : 'großer Aufwand'}</Pill> : null}
                      </div>
                      {t.saving ? <p>Ersparnis: {t.saving}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          />
          <div className="panel">
            <div className="panel-head">
              <h3>Einträge</h3>
            </div>
            <ReadingTable readings={readings} />
          </div>
        </div>
      )}
    </Sheet>
  );
}

function AddReading() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn small kind="primary" icon="plus" onClick={() => setOpen(!open)}>
        Verbrauch
      </Btn>
      {open ? (
        <div className="welcome" style={{ width: 'min(520px, calc(100% - 32px))' }} role="dialog" aria-label="Verbrauch erfassen">
          <div className="spread">
            <h2 style={{ fontSize: 19 }}>Verbrauch erfassen</h2>
            <IconBtn icon="x" label="Schließen" onClick={() => setOpen(false)} />
          </div>
          <ReadingForm onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </>
  );
}

function ReadingForm({ onDone }) {
  const y = new Date().getFullYear() - 1;
  const [m, setM] = useState('strom');
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(`${y}-12-31`);
  const [amount, setAmount] = useState(null);
  const [cost, setCost] = useState(null);
  const [unitAlt, setUnitAlt] = useState(false);
  const md = medium(m);
  const save = () => {
    if (amount == null) return toast('Bitte eine Menge eintragen.', 'warn');
    const amt = unitAlt && md.alt ? amount * md.alt.factor : amount;
    addReading({ medium: m, from, to, amount: Math.round(amt), cost, note: unitAlt && md.alt ? `${fmtNum(amount, 0)} ${md.alt.unit} × ${md.alt.factor}` : '' });
    toast('Verbrauch gespeichert');
    setAmount(null);
    setCost(null);
    onDone?.();
  };
  return (
    <div className="stack">
      <div className="grid2">
        <Field label="Medium">
          <Select id="rd-medium" value={m} onChange={(v) => { setM(v); setUnitAlt(false); }} options={MEDIA.map((x) => ({ value: x.key, label: x.name }))} />
        </Field>
        <Field label="Abrechnungsjahr" hint="Setzt den Zeitraum">
          <Select id="rd-year" value={from.slice(0, 4)} onChange={(v) => { setFrom(`${v}-01-01`); setTo(`${v}-12-31`); }} options={Array.from({ length: 8 }, (_, i) => String(y + 1 - i)).map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label="Von">
          <DateInput id="rd-from" value={from} onChange={setFrom} />
        </Field>
        <Field label="Bis">
          <DateInput id="rd-to" value={to} onChange={setTo} />
        </Field>
        <Field label={`Menge (${unitAlt && md.alt ? md.alt.unit : md.unit})`} hint={md.alt ? <button type="button" className="link" onClick={() => setUnitAlt(!unitAlt)}>{unitAlt ? `in ${md.unit} eingeben` : `in ${md.alt.unit} eingeben (×${String(md.alt.factor).replace('.', ',')})`}</button> : null}>
          <NumInput id="rd-amount" value={amount} onChange={setAmount} digits={1} />
        </Field>
        <Field label="Kosten">
          <NumInput id="rd-cost" value={cost} onChange={setCost} unit="€" digits={2} />
        </Field>
      </div>
      <div>
        <Btn kind="primary" icon="check" onClick={save}>
          Speichern
        </Btn>
      </div>
    </div>
  );
}

function ReadingTable({ readings }) {
  const rows = [...readings].sort((a, b) => (a.to < b.to ? 1 : -1));
  const set = (id, patch) => updateDoc('readings', id, (r) => ({ ...r, ...patch, example: false }));
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Medium</th>
            <th>Zeitraum</th>
            <th className="r">Menge</th>
            <th className="r">Kosten</th>
            <th className="r">kWh</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const md = medium(r.medium);
            const k = toKwh(r);
            return (
              <tr key={r.id}>
                <td>
                  <span className="hstack" style={{ gap: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: md.color, display: 'inline-block' }} />
                    {md.name}
                    {r.example ? <Pill className="pill-example">Beispiel</Pill> : null}
                  </span>
                </td>
                <td className="mono">
                  {fmtDate(r.from)} – {fmtDate(r.to)}
                </td>
                <td className="r" style={{ width: 150 }}>
                  <NumInput value={r.amount} onChange={(v) => set(r.id, { amount: v })} unit={md.unit} digits={1} aria-label="Menge" />
                </td>
                <td className="r" style={{ width: 120 }}>
                  <NumInput value={r.cost} onChange={(v) => set(r.id, { cost: v })} unit="€" digits={2} aria-label="Kosten" />
                </td>
                <td className="r mono">{k != null ? fmtNum(k, 0) : '–'}</td>
                <td>
                  <IconBtn icon="trash" label="Eintrag löschen" size={15} onClick={() => deleteDoc('readings', r.id)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
