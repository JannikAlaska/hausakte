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
import { pvConfig, pvSelection, pvEnergy, pvCosts, layoutSig, feedInFor, inverterKind } from '../pv.js';
import { PvSetup } from './pvsetup.jsx';
import { fmtNum, fmtFixed, fmtEuro } from '../util.js';

const { useState, useEffect, useMemo, useRef } = React;

const YEAR = new Date().getFullYear();
const hhmm = (m) => (m == null ? '–' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`);
const dayLabel = (doy) => dateOfDoy(YEAR, doy).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' });

// Inputs that change the shading result; a stored result is stale when they differ.
export function solarSig(data) {
  const h = data.house || {};
  const floors = Object.values(data.floors || {}).map((f) => [f.id, f.elevation, f.height, f.underRoof, f.kneeWall]).sort();
  // the module layout (size, orientation, count, slopes) changes which modules are analysed
  const lay = h.solar?.cfg ? layoutSig(pvConfig(h)) : '';
  const str = JSON.stringify([h.northAngle, h.geo, h.model?.roofSections, h.model?.chimneys, h.model?.context, h.model?.trees, floors]) + lay;
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
  const sel = useMemo(() => pvSelection(h, Object.values(data.floors || {})), [h, data.floors]);
  const cfg = sel.cfg;
  const en = useMemo(() => (result ? pvEnergy(result, cfg) : null), [result, cfg]);
  const st = {
    household: solar.household ?? defaultHousehold(data),
    battery: solar.battery ?? (/speicher/i.test(pvProject?.title || '') ? 8 : 0),
    withHp: solar.withHp ?? liveProjects(data.projects).some((p) => p.kind === 'heizung' && /wärmepumpe/i.test(p.title || '')),
    priceGrid: solar.priceGrid ?? 0.34,
    feedIn: solar.feedIn ?? feedInFor(en?.kwp ?? sel.kwp),
    feedAuto: solar.feedIn == null,
  };
  const heat = useMemo(() => heatResult(h, Object.values(data.floors), data.components, data.readings), [h, data.floors, data.components, data.readings]);
  const simOf = (battery) => simulateSelfUse({ pvHourly: en.hourly, household: st.household, heatKwh: st.withHp ? heat.heatKwh : 0, wwKwh: st.withHp ? heat.wwKwh : 0, jaz: heat.emitter.jaz, battery, batteryEff: cfg.battery.eff / 100 });
  const sim = useMemo(() => (en ? simOf(st.battery) : null), [en, st.household, st.battery, st.withHp, heat, cfg.battery.eff]);
  const costs = pvCosts(cfg, { modules: en?.n ?? sel.count, kwp: en?.kwp ?? sel.kwp, battery: st.battery, acKw: en?.acKw });
  const invest = solar.invest ?? costs.total;
  const investSource = solar.invest != null ? 'eigene Angabe' : 'Kostenaufstellung';
  const run = async () => {
    const scene = sceneHandle.current;
    if (!scene) return toast('Das 3D-Modell ist noch nicht bereit.', 'warn');
    ctl.current = new AbortController();
    setBusy(0);
    try {
      const r = await scene.analyzePv({ signal: ctl.current.signal, onProgress: (p) => setBusy(p) });
      if (!r) return toast('Keine Module geplant – wähle Dachflächen und Anzahl unter „Anlage planen“.', 'warn');
      set({ result: r, sig: solarSig(data) });
      setUI({ pvHeat: true });
    } catch (e) {
      if (e?.code !== 'cancelled') toast('Berechnung fehlgeschlagen.', 'err');
    } finally {
      setBusy(null);
    }
  };
  // a changed layout (module size, count, slopes) is analysed again automatically
  const sig = solarSig(data);
  const auto = useRef(null);
  useEffect(() => {
    if (!stale || busy != null || auto.current === sig || !sel.count) return;
    const t = setTimeout(() => {
      auto.current = sig;
      run();
    }, 1200);
    return () => clearTimeout(t);
  }, [sig, stale, busy]);
  const savings = sim ? sim.self * st.priceGrid + sim.feed * st.feedIn : 0;
  const econ = usePvEconomics({ data, en, st, cfg, sim, simOf, solar, invest, investSource, costs });
  const m = cfg.module;
  return (
    <div className="stack">
      <p className="small muted">
        Plane die Anlage mit deinen Modulen, dem Wechselrichter und den Kosten aus dem Angebot. Für jedes Modul auf dem Dach prüft die App über ein ganzes Jahr, wann Nachbarhäuser, Schornstein, Bäume oder das eigene Dach Schatten werfen – Grundlage sind der Sonnenstand an deinem Ort und typische Einstrahlungswerte für das Harzvorland.
      </p>
      <PvSetup data={data} sel={sel} en={en} costs={costs} battery={st.battery} invest={invest} investSource={investSource} pvProject={pvProject} />
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
          <Btn kind={result ? 'soft' : 'primary'} icon="sun" onClick={run} disabled={!sel.count}>
            {result ? 'Neu berechnen' : stale ? 'Neu berechnen (Planung geändert)' : 'Verschattung und Ertrag berechnen'}
          </Btn>
        )}
        <Btn kind="ghost" icon="cube" onClick={() => { setUI({ sunOn: true, pvHeat: !!result, mode: 'all', floorId: null, showRoof: true, showLines: false }); go('modell'); }}>
          Sonnenstand im Modell
        </Btn>
      </div>
      {stale && busy == null ? (
        <div className="callout callout-warn">
          <Icon name="alert" size={16} />
          <span>Dach, Umgebung oder Modulbelegung haben sich seit der letzten Berechnung geändert – die Berechnung läuft gleich neu.</span>
        </div>
      ) : null}
      {!result && !stale && sel.max === 0 ? (
        <div className="callout">
          <Icon name="info" size={16} />
          <span>Auf den gewählten Dachflächen ist kein Platz für Module. Wähle unter „Belegung“ weitere Flächen, kleinere Module oder einen kleineren Randabstand – oder prüfe die Dachflächen im Grundriss unter „Dach“.</span>
        </div>
      ) : null}
      {en ? (
        <>
          <div className="stat-grid">
            <div className="stat">
              <span>Module</span>
              <b>
                {en.n} × {fmtNum(m.wp, 0)} Wp
              </b>
              <small>
                {fmtFixed(en.kwp, 2)} kWp · {fmtFixed(en.n * m.area, 1)} m²
              </small>
            </div>
            <div className="stat">
              <span>Jahresertrag</span>
              <b>{fmtNum(Math.round(en.total / 10) * 10, 0)} kWh</b>
              <small>{fmtNum(en.specific, 0)} kWh pro kWp</small>
            </div>
            <div className="stat">
              <span>Verlust durch Verschattung</span>
              <b>{en.loss < 0.001 ? '< 0,1 %' : `${fmtFixed(en.loss * 100, 1)} %`}</b>
              <small>ohne Schatten {fmtNum(Math.round(en.free / 10) * 10, 0)} kWh</small>
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
          <div className="kv-grid pv-losses">
            <div className="kv"><span>Wirkungsgrad der Anlage (Performance Ratio)</span><b>{fmtNum(en.pr * 100, 0)} %</b></div>
            <div className="kv"><span>Verlust durch Wärme ({fmtFixed(m.tc, 2)} %/K)</span><b>{fmtFixed(en.tempLoss * 100, 1)} %</b></div>
            <div className="kv"><span>Wechselrichter {fmtFixed(en.acKw, 1)} kW ({inverterKind(cfg.inverter.kind).name})</span><b>{en.clipShare < 0.001 ? 'keine Begrenzung' : `${fmtFixed(en.clipShare * 100, 1)} % begrenzt`}</b></div>
            <div className="kv"><span>Leistung nach {m.life} Jahren</span><b>ca. {fmtNum(Math.pow(1 - m.deg / 100, m.life) * 100, 0)} %</b></div>
          </div>

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
                  {en.slopes.map((s) => (
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
            <p className="small muted" style={{ marginTop: 8 }}>
              Module mit mehr als 10–15 % Verlust lohnen sich oft nicht oder brauchen Leistungsoptimierer. Gerechnet mit einem typischen Jahr, Modultemperatur aus Einstrahlung und Monatstemperatur, {fmtNum(cfg.losses, 1)} % sonstigen Verlusten und {fmtNum(cfg.inverter.eff, 1)} % Wechselrichter-Wirkungsgrad{cfg.inverter.shade > 1 ? '; beim String-Wechselrichter wirkt Teilverschattung etwas stärker' : ''}.
            </p>
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
              <Field label="Batteriespeicher" hint="Preis und Wirkungsgrad unter „Anlage planen“">
                <NumInput value={st.battery} onChange={(v) => v != null && set({ battery: v })} unit="kWh" digits={1} />
              </Field>
              <Field label="Wärmepumpe einrechnen" hint={`ca. ${fmtNum(Math.round((heat.heatKwh / heat.emitter.jaz + heat.wwKwh / 2.6) / 100) * 100, 0)} kWh/a laut Heizlast-Check`}>
                <Toggle checked={st.withHp} onChange={(v) => set({ withHp: v })} label={st.withHp ? 'ja' : 'nein'} />
              </Field>
              <Field label="Strompreis">
                <NumInput value={st.priceGrid} onChange={(v) => v > 0 && set({ priceGrid: v })} unit="€/kWh" digits={2} />
              </Field>
              <Field label="Einspeisevergütung" hint={st.feedAuto ? `automatisch nach Anlagengröße (bis 10 kWp ca. 7,7 ct, darüber 6,7 ct)` : 'eigene Angabe'}>
                <NumInput value={st.feedAuto ? null : st.feedIn} placeholder={fmtFixed(st.feedIn, 3)} onChange={(v) => set({ feedIn: v != null && v >= 0 ? v : null })} unit="€/kWh" digits={3} />
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

          {econ ? <PvEconomics econ={econ} st={st} set={set} cfg={cfg} /> : null}
        </>
      ) : null}
    </div>
  );
}

// ---------- economics: whole system, PV alone, battery as add-on ----------
// cost estimate without a stored configuration (e.g. for other views): default module and costs
export function pvEstimate(kwp, battery) {
  const cfg = pvConfig({});
  const n = Math.round((kwp * 1000) / cfg.module.wp);
  const c = pvCosts(cfg, { modules: n, kwp, battery });
  return { pv: Math.round(c.pvOnly / 100) * 100, battery: Math.round(c.battery / 100) * 100 };
}

// Savings in year y: self-used power replaces rising grid prices, feed-in tariff is fixed for 20 years;
// the modules lose power every year; after the battery's life the system runs without it.
function pvSaving(simA, st, rise, deg, simAfter, until) {
  return (y) => {
    const s = simAfter && y > until ? simAfter : simA;
    return Math.pow(1 - deg, y - 1) * (s.self * st.priceGrid * Math.pow(1 + rise, y - 1) + s.feed * (y <= 20 ? st.feedIn : 0.05));
  };
}

function usePvEconomics({ data, en, st, cfg, sim, simOf, solar, invest, investSource, costs }) {
  return useMemo(() => {
    if (!en || !sim) return null;
    const rise = solar.priceRise ?? data.house?.heat?.priceRise ?? PRICE_RISE;
    const life = cfg.module.life || LIFE.pv;
    const deg = cfg.module.deg / 100;
    const sim0 = st.battery > 0 ? simOf(0) : sim;
    const batSize = st.battery > 0 ? st.battery : 8;
    const simB = st.battery > 0 ? sim : simOf(batSize);
    const batCost = st.battery > 0 ? Math.min(invest, costs.battery) : batSize * cfg.battery.price;
    const pvCost = st.battery > 0 ? invest - batCost : invest;
    // the inverter is replaced after its life (a bit cheaper than today)
    const invLife = cfg.inverter.life;
    const invRepl = Math.round(costs.inverter * 0.8);
    const extra = (y) => (invLife < life && (y - 1) % invLife === 0 && y > 1 && y <= life ? invRepl : 0);
    const replacements = invLife < life ? Math.floor((life - 1) / invLife) : 0;
    const upkeep = (cost) => Math.round(cost * 0.01);
    const all = economics({ invest, saving: pvSaving(sim, st, rise, deg, st.battery > 0 ? sim0 : null, LIFE.speicher), life, rise, maintenance: upkeep(invest), extra });
    const pvOnly = economics({ invest: pvCost, saving: pvSaving(sim0, st, rise, deg), life, rise, maintenance: upkeep(pvCost), extra });
    // the battery shifts surplus into the evening: each stored kWh saves the grid price but loses the feed-in tariff
    const more = simB.self - sim0.self;
    const bat = economics({ invest: batCost, saving: (y) => Math.pow(1 - deg, y - 1) * more * (st.priceGrid * Math.pow(1 + rise, y - 1) - (y <= 20 ? st.feedIn : 0.05)), life: LIFE.speicher, rise });
    return { invest, source: investSource, rise, life, pvCost, batCost, batSize, hasBattery: st.battery > 0, extra: more, all, pvOnly, bat, invRepl, invLife, replacements };
  }, [en, sim, st.battery, st.household, st.withHp, st.priceGrid, st.feedIn, invest, costs.inverter, costs.battery, cfg, solar.priceRise, data.house?.heat?.priceRise]);
}

function PvEconomics({ econ, st, set, cfg }) {
  const e = econ;
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Lohnt sich die Anlage?</h3>
      </div>
      <div className="grid3">
        <Field label="Investition gesamt" hint={e.source === 'eigene Angabe' ? 'Preis laut Angebot' : 'aus der Kostenaufstellung unter „Anlage planen“'}>
          <div className="input inv-ro">{fmtEuro(e.invest)}</div>
        </Field>
        <Field label="Strompreis-Steigerung">
          <NumInput value={Math.round(e.rise * 1000) / 10} onChange={(v) => v != null && set({ priceRise: v / 100 })} unit="%/a" digits={1} />
        </Field>
      </div>
      <div className="stack" style={{ gap: 8, marginTop: 10 }}>
        <div>
          <span className="field-label">{e.hasBattery ? `Gesamtanlage mit ${fmtNum(st.battery, 1)} kWh Speicher` : 'PV-Anlage'}</span>
          <EconLine e={e.all} hint={`Überschuss nach ${e.life} Jahren ca. ${fmtEuro(Math.round(e.all.benefit / 500) * 500)}`} />
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
        Annahmen: eigener Strom ersetzt Netzstrom (Preis +{fmtNum(e.rise * 100, 1)} %/a), Einspeisevergütung 20 Jahre fest, danach ca. 5 ct/kWh; Wartung und Versicherung 1 % der Investition pro Jahr; Leistungsverlust der Module {fmtFixed(cfg.module.deg, 2)} %/a; Lebensdauer Module {e.life} Jahre, Speicher {LIFE.speicher} Jahre{e.replacements ? `, Wechselrichter ${e.invLife} Jahre – ${e.replacements === 1 ? 'ein Tausch' : `${e.replacements} Tausche`} für je ca. ${fmtEuro(e.invRepl)} eingerechnet` : ''}. PV-Anlagen bis 30 kWp sind von der Mehrwertsteuer befreit und werden nicht bezuschusst. Ein Speicher rechnet sich meist erst mit Wärmepumpe oder E-Auto – oder wenn er günstig ist.
      </p>
    </div>
  );
}

// Compact hint in PV projects.
export function PvHint({ data }) {
  const r = solarResult(data);
  const cfg = pvConfig(data.house);
  const en = r ? pvEnergy(r, cfg) : null;
  return (
    <div className="callout callout-info" style={{ marginTop: 10 }}>
      <Icon name="sun" size={16} />
      <div style={{ flex: 1 }}>
        {en ? (
          <>
            Geplant: <b>{en.n} Module {cfg.module.name} ({fmtFixed(en.kwp, 1)} kWp)</b>, Ertrag ca. <b>{fmtNum(Math.round(en.total / 100) * 100, 0)} kWh/a</b>, Verschattungsverlust {fmtFixed(en.loss * 100, 1)} %.
          </>
        ) : (
          <>Plane Module, Wechselrichter und Kosten und berechne Ertrag, Verschattung und Eigenverbrauch für dein Dach aus dem 3D-Modell.</>
        )}
        <div style={{ marginTop: 6 }}>
          <Btn small icon="sun" onClick={() => { setUI({ buildingTab: 'sonne', drawer: null }); go('gebaeude'); }}>
            {en ? 'PV-Planung öffnen' : 'Jetzt planen'}
          </Btn>
        </div>
      </div>
    </div>
  );
}
