// Sun study in the 3D model, PV shading analysis per module and self-consumption with heat pump and battery.
import { Icon } from './icons.jsx';
import { Btn, IconBtn, Field, NumInput, Toggle, Pill } from './common.jsx';
import { useUI, setUI, getUI, go, toast, sceneHandle } from './state.js';
import { updateHouse } from '../store.js';
import { houseGeo, sunPosition, localToUtc, sunTimes, doyOf, dateOfDoy, simulateSelfUse, SHADE_BINS, MONTHS } from '../solar.js';
import { heatResult } from '../heat.js';
import { bearingName } from '../roof.js';
import { consumptionByYear, projectCost, liveProjects } from '../metrics.js';
import { economics, paybackText, LIFE, PRICE_RISE } from '../econ.js';
import { EconLine } from './econ.jsx';
import { fmtNum, fmtFixed, fmtEuro } from '../util.js';

const { useState, useEffect, useMemo, useRef } = React;

const YEAR = new Date().getFullYear();
const hhmm = (m) => (m == null ? '–' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`);
const dayLabel = (doy) => dateOfDoy(YEAR, doy).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' });

// Inputs that change the shading result; a stored result is stale when they differ.
export function solarSig(data) {
  const h = data.house || {};
  const floors = Object.values(data.floors || {}).map((f) => [f.id, f.elevation, f.height, f.underRoof, f.kneeWall]).sort();
  const str = JSON.stringify([h.northAngle, h.geo, h.model?.roofSections, h.model?.chimneys, h.model?.context, h.model?.trees, floors]);
  let x = 0;
  for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) | 0;
  return String(x);
}
export function solarResult(data) {
  const s = data.house?.solar;
  return s?.result && s.sig === solarSig(data) ? s.result : null;
}

// ---------- sun study panel in the model view ----------
export function SunPanel({ data }) {
  const ui = useUI();
  const geo = houseGeo(data.house);
  const doy = ui.sunDoy ?? doyOf(new Date());
  const min = ui.sunMin ?? 13 * 60;
  const pos = sunPosition(localToUtc(YEAR, doy, min), geo.lat, geo.lon);
  const times = useMemo(() => sunTimes(YEAR, doy, geo), [doy, geo.lat, geo.lon]);
  const [play, setPlay] = useState(false);
  useEffect(() => {
    if (!play) return;
    const id = setInterval(() => {
      const u = getUI();
      let m = (u.sunMin ?? 780) + 8;
      if (m > (times.set ?? 1260) + 15) m = Math.max(0, (times.rise ?? 300) - 15);
      setUI({ sunMin: m });
    }, 70);
    return () => clearInterval(id);
  }, [play, times]);
  const result = solarResult(data);
  const presets = [
    { label: 'Frühling', doy: 80 },
    { label: 'Sommer', doy: 172 },
    { label: 'Herbst', doy: 266 },
    { label: 'Winter', doy: 355 },
    { label: 'Heute', doy: doyOf(new Date()) },
  ];
  return (
    <div className="sunpanel float" role="region" aria-label="Sonnenstand">
      <div className="spread">
        <b className="sun-title">
          <Icon name="sun" size={16} /> Sonnenstand
        </b>
        <IconBtn icon="x" label="Sonnenstand schließen" size={16} onClick={() => { setPlay(false); setUI({ sunOn: false }); }} />
      </div>
      <div className="chips">
        {presets.map((p) => (
          <button key={p.label} className={`chip ${doy === p.doy ? 'is-on' : ''}`} onClick={() => setUI({ sunDoy: p.doy })}>
            {p.label}
          </button>
        ))}
      </div>
      <label className="sun-slider">
        <span>{dayLabel(doy)}</span>
        <input type="range" min="1" max="365" value={doy} onChange={(e) => setUI({ sunDoy: Number(e.target.value) })} aria-label="Datum" />
      </label>
      <div className="sun-time">
        <IconBtn icon={play ? 'pause' : 'play'} label={play ? 'Anhalten' : 'Tagesverlauf abspielen'} size={16} active={play} onClick={() => setPlay(!play)} />
        <label className="sun-slider">
          <span>{hhmm(min)} Uhr</span>
          <input type="range" min="0" max="1435" step="5" value={min} onChange={(e) => { setPlay(false); setUI({ sunMin: Number(e.target.value) }); }} aria-label="Uhrzeit" />
        </label>
      </div>
      <div className="sun-read small">
        {pos.altitude > 0 ? (
          <span>
            Sonnenhöhe <b>{fmtNum(pos.altitude, 0)}°</b> · aus <b>{bearingName(pos.azimuth)}</b> ({fmtNum(pos.azimuth, 0)}°)
          </span>
        ) : (
          <span>Sonne unter dem Horizont</span>
        )}
        <span className="muted">
          Aufgang {hhmm(times.rise)} · Untergang {hhmm(times.set)}
        </span>
      </div>
      {result ? (
        <Toggle checked={!!ui.pvHeat} onChange={(v) => setUI({ pvHeat: v })} label="PV-Verschattung auf dem Dach zeigen" />
      ) : (
        <button className="link small" onClick={() => { setUI({ buildingTab: 'sonne' }); go('gebaeude'); }}>
          PV-Verschattung berechnen →
        </button>
      )}
    </div>
  );
}

export function ShadeLegend() {
  return (
    <div className="shade-legend" aria-label="Legende Verschattungsverlust">
      <span className="small muted">Verlust durch Verschattung</span>
      <div>
        {SHADE_BINS.map((b) => (
          <span key={b.label}>
            <i style={{ background: b.color }} />
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- monthly chart: PV yield vs. consumption (two series, one axis) ----------
function niceMax(v) {
  if (!(v > 0)) return { max: 1, step: 0.25 };
  const rough = v / 4;
  const p = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= rough);
  return { max: Math.ceil(v / step) * step, step };
}
function MonthlyChart({ rows }) {
  const [hover, setHover] = useState(null);
  const W = 640,
    H = 220,
    L = 50,
    R = 8,
    T = 12,
    B = 26;
  const { max, step } = niceMax(Math.max(...rows.flatMap((r) => [r.pv, r.load]), 0) * 1.05);
  const ticks = [];
  for (let t = 0; t <= max + step / 2; t += step) ticks.push(t);
  const slot = (W - L - R) / 12;
  const bw = Math.min(16, slot * 0.34);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const bar = (x, v, fill, dim) => {
    const h = Math.max(0, y(0) - y(v));
    if (h <= 0) return null;
    const rr = Math.min(4, h / 2, bw / 2);
    return <path d={`M${x},${y(0)} V${y(v) + rr} Q${x},${y(v)} ${x + rr},${y(v)} H${x + bw - rr} Q${x + bw},${y(v)} ${x + bw},${y(v) + rr} V${y(0)} Z`} fill={fill} opacity={dim ? 0.4 : 1} />;
  };
  return (
    <div style={{ position: 'relative' }}>
      <div className="legend-row small">
        <span>
          <i style={{ background: 'var(--chart-pv)' }} /> PV-Ertrag
        </span>
        <span>
          <i style={{ background: 'var(--chart-use)' }} /> Stromverbrauch
        </span>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="PV-Ertrag und Stromverbrauch pro Monat in kWh">
        {ticks.map((t, i) => (
          <g key={i}>
            <line className="grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end">
              {fmtNum(t, 0)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x0 = L + slot * i + (slot - 2 * bw - 2) / 2;
          const dim = hover != null && hover !== i;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + slot * i} y={T} width={slot} height={H - T - B} fill="transparent" />
              {bar(x0, r.pv, 'var(--chart-pv)', dim)}
              {bar(x0 + bw + 2, r.load, 'var(--chart-use)', dim)}
              <text x={L + slot * i + slot / 2} y={H - 8} textAnchor="middle">
                {MONTHS[i]}
              </text>
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--line-2)" strokeWidth="1" />
      </svg>
      {hover != null ? (
        <div className="selcard chart-tip" style={{ left: `${((L + slot * hover + slot / 2) / W) * 100}%` }}>
          <b className="small">{MONTHS[hover]}</b>
          <div className="small">PV-Ertrag {fmtNum(rows[hover].pv, 0)} kWh</div>
          <div className="small">Verbrauch {fmtNum(rows[hover].load, 0)} kWh</div>
          <div className="small muted">davon selbst genutzt {fmtNum(rows[hover].self, 0)} kWh</div>
        </div>
      ) : null}
      <details className="small" style={{ marginTop: 6 }}>
        <summary>Als Tabelle</summary>
        <table className="tbl">
          <thead>
            <tr>
              <th>Monat</th>
              <th className="r">PV-Ertrag</th>
              <th className="r">Verbrauch</th>
              <th className="r">Selbst genutzt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{MONTHS[i]}</td>
                <td className="r">{fmtNum(r.pv, 0)} kWh</td>
                <td className="r">{fmtNum(r.load, 0)} kWh</td>
                <td className="r">{fmtNum(r.self, 0)} kWh</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// ---------- tab in the building sheet ----------
function defaultHousehold(data) {
  const years = consumptionByYear(Object.values(data.readings || {}));
  const y = Object.keys(years)
    .sort()
    .reverse()
    .find((k) => years[k].strom?.amount > 0);
  if (y) return Math.round(years[y].strom.amount);
  return 1500 + 700 * (Number(data.house?.persons) || 2);
}

export function SolarCheck({ data }) {
  const ui = useUI();
  const h = data.house;
  const solar = h.solar || {};
  const result = solarResult(data);
  const stale = !!solar.result && !result;
  const [busy, setBusy] = useState(null);
  const ctl = useRef(null);
  const set = (patch) => updateHouse((x) => ({ ...x, solar: { ...(x.solar || {}), ...patch } }), 300);
  const pvProject = liveProjects(data.projects).find((p) => p.kind === 'pv');
  const st = {
    household: solar.household ?? defaultHousehold(data),
    battery: solar.battery ?? (/speicher/i.test(pvProject?.title || '') ? 8 : 0),
    withHp: solar.withHp ?? liveProjects(data.projects).some((p) => p.kind === 'heizung' && /wärmepumpe/i.test(p.title || '')),
    priceGrid: solar.priceGrid ?? 0.34,
    feedIn: solar.feedIn ?? 0.078,
  };
  const heat = useMemo(() => heatResult(h, Object.values(data.floors), data.components, data.readings), [h, data.floors, data.components, data.readings]);
  const sim = useMemo(
    () => (result ? simulateSelfUse({ pvHourly: result.hourly, household: st.household, heatKwh: st.withHp ? heat.heatKwh : 0, wwKwh: st.withHp ? heat.wwKwh : 0, jaz: heat.emitter.jaz, battery: st.battery }) : null),
    [result, st.household, st.battery, st.withHp, heat],
  );
  const run = async () => {
    const scene = sceneHandle.current;
    if (!scene) return toast('Das 3D-Modell ist noch nicht bereit.', 'warn');
    ctl.current = new AbortController();
    setBusy(0);
    try {
      const r = await scene.analyzePv({ signal: ctl.current.signal, onProgress: (p) => setBusy(p) });
      if (!r) return toast('Keine geeignete Dachfläche für PV-Module gefunden.', 'warn');
      set({ result: r, sig: solarSig(data) });
      setUI({ pvHeat: true });
    } catch (e) {
      if (e?.code !== 'cancelled') toast('Berechnung fehlgeschlagen.', 'err');
    } finally {
      setBusy(null);
    }
  };
  const panelsCount = sceneHandle.current?.pvPanels().length ?? 0;
  const savings = sim ? sim.self * st.priceGrid + sim.feed * st.feedIn : 0;
  const econ = usePvEconomics({ data, result, st, heat, sim, pvProject, solar });
  return (
    <div className="stack">
      <p className="small muted">
        Für jedes mögliche PV-Modul auf deinem Dach prüft die App über ein ganzes Jahr, wann Nachbarhäuser, Schornstein, Bäume oder das eigene Dach Schatten werfen. Grundlage sind der Sonnenstand an deinem Ort und typische Einstrahlungswerte für das Harzvorland. Den Schattenwurf zu jeder Uhrzeit siehst du im 3D-Modell über das Sonnen-Symbol.
      </p>
      <div className="hstack" style={{ flexWrap: 'wrap' }}>
        {busy != null ? (
          <>
            <div className="progress" role="progressbar" aria-valuenow={Math.round(busy * 100)} aria-valuemin="0" aria-valuemax="100">
              <span style={{ width: `${busy * 100}%` }} />
            </div>
            <span className="small muted">{fmtNum(busy * 100, 0)} %</span>
            <Btn small kind="ghost" icon="stop" onClick={() => ctl.current?.abort()}>
              Abbrechen
            </Btn>
          </>
        ) : (
          <Btn kind={result ? 'soft' : 'primary'} icon="sun" onClick={run}>
            {result ? 'Neu berechnen' : stale ? 'Neu berechnen (Modell geändert)' : 'Verschattung und Ertrag berechnen'}
          </Btn>
        )}
        <Btn kind="ghost" icon="cube" onClick={() => { setUI({ sunOn: true, pvHeat: !!result, mode: 'all', floorId: null, showRoof: true, showLines: false }); go('modell'); }}>
          Sonnenstand im Modell
        </Btn>
      </div>
      {stale ? (
        <div className="callout callout-warn">
          <Icon name="alert" size={16} />
          <span>Dach, Umgebung oder Ausrichtung haben sich seit der letzten Berechnung geändert. Bitte neu berechnen.</span>
        </div>
      ) : null}
      {!result && !stale && panelsCount === 0 ? (
        <div className="callout">
          <Icon name="info" size={16} />
          <span>Auf den Dachflächen ist kein Platz für Module mit gutem Ertrag (Ausrichtung Ost über Süd bis West). Prüfe die Dachflächen im Grundriss unter „Dach“.</span>
        </div>
      ) : null}
      {result ? (
        <>
          <div className="stat-grid">
            <div className="stat">
              <span>Module</span>
              <b>{result.modules.length} Stück</b>
              <small>{fmtFixed(result.kwp, 1)} kWp (430 Wp je Modul)</small>
            </div>
            <div className="stat">
              <span>Jahresertrag</span>
              <b>{fmtNum(Math.round(result.total / 10) * 10, 0)} kWh</b>
              <small>{fmtNum(result.total / result.kwp, 0)} kWh pro kWp</small>
            </div>
            <div className="stat">
              <span>Verlust durch Verschattung</span>
              <b>{result.loss < 0.001 ? '< 0,1 %' : `${fmtFixed(result.loss * 100, 1)} %`}</b>
              <small>ohne Schatten {fmtNum(Math.round(result.free / 10) * 10, 0)} kWh</small>
            </div>
            {sim ? (
              <div className="stat">
                <span>Ersparnis pro Jahr</span>
                <b>{fmtEuro(savings)}</b>
                <small>
                  {fmtNum(sim.selfRate * 100, 0)} % Eigenverbrauch · {fmtNum(sim.autarky * 100, 0)} % autark
                </small>
              </div>
            ) : null}
          </div>
          {econ ? <EconLine e={econ.all} hint={`bei ${fmtEuro(econ.invest)} Investition`} /> : null}

          <div className="panel">
            <div className="panel-head">
              <h3>Verschattung je Modul</h3>
              <Toggle checked={!!ui.pvHeat} onChange={(v) => setUI({ pvHeat: v })} label="Im 3D-Modell zeigen" />
            </div>
            <ShadeLegend />
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Dachfläche</th>
                    <th className="r">Module</th>
                    <th className="r">kWp</th>
                    <th className="r">Ertrag/a</th>
                    <th className="r">Verschattung</th>
                  </tr>
                </thead>
                <tbody>
                  {result.slopes.map((s) => (
                    <tr key={s.key}>
                      <td>
                        {s.label} {s.azimuth != null ? `${bearingName(s.azimuth)} (${fmtNum(s.azimuth, 0)}°)` : 'flach'}, {fmtNum(s.tilt, 0)}°
                      </td>
                      <td className="r">{s.modules}</td>
                      <td className="r">{fmtFixed(s.kwp, 1)}</td>
                      <td className="r">{fmtNum(Math.round(s.kwh / 10) * 10, 0)} kWh</td>
                      <td className="r">
                        <Pill tone={s.loss < 0.05 ? 'accent' : s.loss < 0.15 ? 'warn' : 'danger'}>{s.loss < 0.001 ? '< 0,1' : fmtFixed(s.loss * 100, 1)} %</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>Module mit mehr als 10–15 % Verlust lohnen sich oft nicht oder brauchen Leistungsoptimierer. Berechnet mit einem typischen Jahr, 86 % Systemwirkungsgrad, Schatten nur auf die direkte Sonne.</p>
          </div>

          {sim ? (
            <div className="panel">
              <div className="panel-head">
                <h3>Ertrag und Verbrauch pro Monat</h3>
              </div>
              <MonthlyChart rows={sim.monthly} />
            </div>
          ) : null}

          <div className="panel">
            <div className="panel-head">
              <h3>Eigenverbrauch</h3>
            </div>
            <div className="grid3">
              <Field label="Haushaltsstrom" hint="ohne Wärmepumpe">
                <NumInput value={st.household} onChange={(v) => v > 0 && set({ household: v })} unit="kWh/a" digits={0} />
              </Field>
              <Field label="Batteriespeicher">
                <NumInput value={st.battery} onChange={(v) => v != null && set({ battery: v })} unit="kWh" digits={1} />
              </Field>
              <Field label="Wärmepumpe einrechnen" hint={`ca. ${fmtNum(Math.round((heat.heatKwh / heat.emitter.jaz + heat.wwKwh / 2.6) / 100) * 100, 0)} kWh/a laut Heizlast-Check`}>
                <Toggle checked={st.withHp} onChange={(v) => set({ withHp: v })} label={st.withHp ? 'ja' : 'nein'} />
              </Field>
              <Field label="Strompreis">
                <NumInput value={st.priceGrid} onChange={(v) => v > 0 && set({ priceGrid: v })} unit="€/kWh" digits={2} />
              </Field>
              <Field label="Einspeisevergütung" hint="bis 10 kWp, Teileinspeisung">
                <NumInput value={st.feedIn} onChange={(v) => v != null && set({ feedIn: v })} unit="€/kWh" digits={3} />
              </Field>
            </div>
            {sim ? (
              <div className="kv-grid" style={{ marginTop: 10 }}>
                <div className="kv"><span>Stromverbrauch gesamt</span><b>{fmtNum(Math.round(sim.load / 10) * 10, 0)} kWh</b></div>
                <div className="kv"><span>Davon aus PV (inkl. Speicher)</span><b>{fmtNum(Math.round(sim.self / 10) * 10, 0)} kWh</b></div>
                <div className="kv"><span>Eingespeist</span><b>{fmtNum(Math.round(sim.feed / 10) * 10, 0)} kWh</b></div>
                <div className="kv"><span>Netzbezug</span><b>{fmtNum(Math.round(sim.grid / 10) * 10, 0)} kWh</b></div>
              </div>
            ) : null}
            <p className="small muted" style={{ marginTop: 8 }}>Stündliche Simulation mit typischen Tagen je Monat (Standardlastprofil Haushalt, Wärmepumpe nach Heizgradtagen). Echte Werte schwanken mit Wetter und Gewohnheiten um ±10–15 %.</p>
          </div>

          {econ ? <PvEconomics econ={econ} st={st} set={set} /> : null}
        </>
      ) : null}
    </div>
  );
}

// ---------- economics: whole system, PV alone, battery as add-on ----------
const PV_EUR_KWP = 1400,
  PV_FIXED = 1500, // scaffold, meter cabinet, registration
  BATTERY_EUR_KWH = 650,
  DEGRADATION = 0.005;

export function pvEstimate(kwp, battery) {
  return { pv: Math.round((PV_FIXED + PV_EUR_KWP * kwp) / 100) * 100, battery: Math.round((BATTERY_EUR_KWH * battery) / 100) * 100 };
}

// Savings in year y: self-used power replaces rising grid prices, feed-in tariff is fixed for 20 years.
function pvSaving(sim, st, rise) {
  return (y) => Math.pow(1 - DEGRADATION, y - 1) * (sim.self * st.priceGrid * Math.pow(1 + rise, y - 1) + sim.feed * (y <= 20 ? st.feedIn : 0.05));
}

function usePvEconomics({ data, result, st, heat, sim, pvProject, solar }) {
  return useMemo(() => {
    if (!result || !sim) return null;
    const rise = solar.priceRise ?? data.house?.heat?.priceRise ?? PRICE_RISE;
    const planned = pvProject ? projectCost(pvProject).best : 0;
    const est = pvEstimate(result.kwp, st.battery);
    const invest = solar.invest ?? (planned || est.pv + est.battery);
    const source = solar.invest != null ? 'eigene Angabe' : planned ? 'aus deinem PV-Projekt' : 'Schätzung';
    const sim0 = st.battery > 0 ? simulateSelfUse({ pvHourly: result.hourly, household: st.household, heatKwh: st.withHp ? heat.heatKwh : 0, wwKwh: st.withHp ? heat.wwKwh : 0, jaz: heat.emitter.jaz, battery: 0 }) : sim;
    const batSize = st.battery > 0 ? st.battery : 8;
    const simB = st.battery > 0 ? sim : simulateSelfUse({ pvHourly: result.hourly, household: st.household, heatKwh: st.withHp ? heat.heatKwh : 0, wwKwh: st.withHp ? heat.wwKwh : 0, jaz: heat.emitter.jaz, battery: batSize });
    const batCost = st.battery > 0 ? Math.min(invest, est.battery) : pvEstimate(0, batSize).battery;
    const pvCost = st.battery > 0 ? invest - batCost : invest;
    const upkeep = (cost) => Math.round(cost * 0.01);
    const all = economics({ invest, saving: pvSaving(sim, st, rise), life: LIFE.pv, rise, maintenance: upkeep(invest) });
    const pvOnly = economics({ invest: pvCost, saving: pvSaving(sim0, st, rise), life: LIFE.pv, rise, maintenance: upkeep(pvCost) });
    // the battery shifts surplus into the evening: each stored kWh saves the grid price but loses the feed-in tariff
    const extra = simB.self - sim0.self;
    const bat = economics({ invest: batCost, saving: (y) => extra * (st.priceGrid * Math.pow(1 + rise, y - 1) - (y <= 20 ? st.feedIn : 0.05)), life: LIFE.speicher, rise });
    return { invest, source, rise, pvCost, batCost, batSize, hasBattery: st.battery > 0, extra, all, pvOnly, bat, planned, est };
  }, [result, sim, st.battery, st.household, st.withHp, st.priceGrid, st.feedIn, heat, pvProject, solar.invest, solar.priceRise, data.house?.heat?.priceRise]);
}

function PvEconomics({ econ, st, set }) {
  const e = econ;
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Lohnt sich die Anlage?</h3>
      </div>
      <div className="grid3">
        <Field label="Investition gesamt" hint={e.source === 'Schätzung' ? `Schätzung: ${fmtEuro(PV_EUR_KWP)}/kWp + ${fmtEuro(PV_FIXED)}${st.battery > 0 ? ` + ${fmtEuro(BATTERY_EUR_KWH)}/kWh Speicher` : ''}` : e.source}>
          <NumInput value={e.invest} onChange={(v) => set({ invest: v > 0 ? v : null })} unit="€" digits={0} />
        </Field>
        <Field label="Strompreis-Steigerung">
          <NumInput value={Math.round(e.rise * 1000) / 10} onChange={(v) => v != null && set({ priceRise: v / 100 })} unit="%/a" digits={1} />
        </Field>
      </div>
      <div className="stack" style={{ gap: 8, marginTop: 10 }}>
        <div>
          <span className="field-label">{e.hasBattery ? `Gesamtanlage mit ${fmtNum(st.battery, 1)} kWh Speicher` : 'PV-Anlage'}</span>
          <EconLine e={e.all} hint={`Überschuss nach ${LIFE.pv} Jahren ca. ${fmtEuro(Math.round(e.all.benefit / 500) * 500)}`} />
        </div>
        {e.hasBattery ? (
          <div>
            <span className="field-label">Nur PV, ohne Speicher (ca. {fmtEuro(e.pvCost)})</span>
            <EconLine e={e.pvOnly} />
          </div>
        ) : null}
        <div>
          <span className="field-label">
            {e.hasBattery ? `Speicher allein (ca. ${fmtEuro(e.batCost)})` : `Mit ${fmtNum(e.batSize, 0)} kWh Speicher zusätzlich (ca. ${fmtEuro(e.batCost)})`}
          </span>
          <EconLine e={e.bat} hint={`+${fmtNum(Math.round(e.extra / 10) * 10, 0)} kWh Eigenverbrauch pro Jahr`} />
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Annahmen: eigener Strom ersetzt Netzstrom (Preis +{fmtNum(e.rise * 100, 1)} %/a), Einspeisevergütung 20 Jahre fest, danach ca. 5 ct/kWh; Wartung und Versicherung 1 % der Investition pro Jahr; Leistungsverlust der Module 0,5 %/a; Lebensdauer PV {LIFE.pv} Jahre, Speicher {LIFE.speicher} Jahre. PV-Anlagen bis 30 kWp sind von der Mehrwertsteuer befreit und werden nicht bezuschusst. Ein Speicher rechnet sich meist erst mit Wärmepumpe oder E-Auto – oder wenn er günstig ist.
      </p>
    </div>
  );
}

// Compact hint in PV projects.
export function PvHint({ data }) {
  const r = solarResult(data);
  return (
    <div className="callout callout-info" style={{ marginTop: 10 }}>
      <Icon name="sun" size={16} />
      <div style={{ flex: 1 }}>
        {r ? (
          <>
            Laut 3D-Modell passen <b>{r.modules.length} Module ({fmtFixed(r.kwp, 1)} kWp)</b> aufs Dach, Ertrag ca. <b>{fmtNum(Math.round(r.total / 100) * 100, 0)} kWh/a</b>, Verschattungsverlust {fmtFixed(r.loss * 100, 1)} %.
          </>
        ) : (
          <>Berechne Ertrag, Verschattung und Eigenverbrauch für dein Dach aus dem 3D-Modell.</>
        )}
        <div style={{ marginTop: 6 }}>
          <Btn small icon="sun" onClick={() => { setUI({ buildingTab: 'sonne', drawer: null }); go('gebaeude'); }}>
            {r ? 'PV-Analyse öffnen' : 'Jetzt berechnen'}
          </Btn>
        </div>
      </div>
    </div>
  );
}
