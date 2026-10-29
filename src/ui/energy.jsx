// Heat load and heat pump check: losses per surface from the 3D model, editable U-values, what-if measures,
// running costs oil vs. heat pump and an AI assessment.
import { Icon } from './icons.jsx';
import { Btn, Field, NumInput, Select, Toggle, Pill } from './common.jsx';
import { AiRunner } from './ai-ui.jsx';
import { setUI, go } from './state.js';
import { updateHouse } from '../store.js';
import { heatResult, heatMeasures, applyMeasures, EMITTERS, HEAT_DEFAULTS, isHeatedFloor } from '../heat.js';
import { sortFloors } from '../metrics.js';
import { aiHeat } from '../ai.js';
import { fmtNum, fmtFixed, fmtEuro } from '../util.js';

const { useState, useMemo } = React;

const kw = (v) => `${fmtFixed(v, 1)} kW`;

function useHeat(data, selected) {
  const floors = Object.values(data.floors);
  return useMemo(() => applyMeasures(data.house, floors, data.components, data.readings, selected), [data.house, data.floors, data.components, data.readings, selected]);
}

// Horizontal bars, one hue: watts lost per surface at the design temperature.
function LossBars({ res, onU }) {
  const rows = [
    ...res.surfaces.map((s) => ({ key: s.key, label: s.label, area: s.area, u: s.u, b: s.b, w: s.H * res.dT, edit: true })),
    { key: 'bridges', label: 'Wärmebrücken (Zuschlag 0,1 W/m²K)', w: res.bridges * res.dT },
    { key: 'vent', label: `Lüftung (Luftwechsel ${fmtNum(res.cfg.ach, 2)}/h)`, w: res.HV * res.dT },
  ].sort((a, b) => b.w - a.w);
  const max = Math.max(...rows.map((r) => r.w), 1);
  const total = rows.reduce((s, r) => s + r.w, 0);
  return (
    <div className="lossbars" role="table" aria-label="Wärmeverluste nach Bauteil">
      <div className="lb-row lb-head" role="row">
        <span role="columnheader">Bauteil</span>
        <span role="columnheader" className="r">Fläche</span>
        <span role="columnheader" className="r">U-Wert</span>
        <span role="columnheader">Verlust bei {fmtNum(res.cfg.tOut, 0)} °C</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="lb-row" role="row" title={r.edit ? `${r.label}: ${fmtFixed(r.area, 1)} m² × U ${fmtNum(r.u, 2)} × Faktor ${fmtNum(r.b, 2)} × ${fmtNum(res.dT, 0)} K = ${fmtNum(r.w, 0)} W` : `${r.label}: ${fmtNum(r.w, 0)} W`}>
          <span role="cell" className="lb-label">{r.label}</span>
          <span role="cell" className="r small muted">{r.area ? `${fmtFixed(r.area, 1)} m²` : ''}</span>
          <span role="cell" className="r">
            {r.edit ? <NumInput value={r.u} onChange={(v) => v > 0 && onU(r.key, v)} digits={2} aria-label={`U-Wert ${r.label}`} /> : null}
          </span>
          <span role="cell" className="lb-bar">
            <span className="lb-track" aria-hidden="true">
              <span className="lb-fill" style={{ width: `${(r.w / max) * 100}%` }} />
            </span>
            <b>{fmtNum(Math.round(r.w / 10) * 10, 0)} W</b>
            <small>{fmtNum((r.w / total) * 100, 0)} %</small>
          </span>
        </div>
      ))}
    </div>
  );
}

export function HeatCheck({ data }) {
  const h = data.house;
  const heat = h.heat || {};
  const [selected, setSelected] = useState(heat.measures || []);
  const { base, after, measures } = useHeat(data, selected);
  const all = useMemo(() => heatMeasures(base), [base]);
  const floors = sortFloors(Object.values(data.floors));
  const singles = useMemo(
    () =>
      Object.fromEntries(
        all.map((m) => {
          const r = applyMeasures(h, Object.values(data.floors), data.components, data.readings, [m.key]).after;
          return [m.key, { dKw: base.loadKw - r.loadKw, dCost: base.hp.cost - r.hp.cost }];
        }),
      ),
    [all, base],
  );
  const setHeat = (patch) => updateHouse((x) => ({ ...x, heat: { ...(x.heat || {}), ...patch } }), 300);
  const setU = (key, v) => setHeat({ u: { ...(heat.u || {}), [key]: v } });
  const toggle = (k) => {
    const next = selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k];
    setSelected(next);
    setHeat({ measures: next });
  };
  const cfg = base.cfg;
  const has = measures.length > 0;
  if (!base.heated.length)
    return (
      <div className="callout">
        <Icon name="info" size={16} />
        <span>Keine beheizte Etage gefunden. Lege im Grundriss Wohnräume an oder markiere unten eine Etage als beheizt.</span>
      </div>
    );
  return (
    <div className="stack">
      <p className="small muted">
        Vereinfachte Heizlast nach DIN EN 12831 aus deinem 3D-Modell: Flächen aus den Grundrissen, U-Werte als Schätzung aus Baujahr und Bauteilen – passe sie unten an, wenn du sie kennst. Für Förderanträge und die Auslegung der Wärmepumpe ist eine raumweise Heizlastberechnung durch den Fachbetrieb nötig.
      </p>
      <div className="stat-grid">
        <div className="stat">
          <span>Heizlast bei {fmtNum(cfg.tOut, 0)} °C</span>
          <b>{kw(base.loadKw)}</b>
          <small>{has ? `mit Maßnahmen ${kw(after.loadKw)}` : `${fmtNum(base.perM2, 0)} W/m² beheizte Fläche`}</small>
        </div>
        <div className="stat">
          <span>Wärmepumpe (rechnerisch)</span>
          <b>{has ? after.hpSize : base.hpSize} kW</b>
          <small>{has ? `ohne Maßnahmen ${base.hpSize} kW` : `inkl. Warmwasser für ${base.persons} Personen`}</small>
        </div>
        <div className="stat">
          <span>Heizwärmebedarf</span>
          <b>{fmtNum(Math.round((has ? after : base).heatKwh / 100) * 100, 0)} kWh/a</b>
          <small>{fmtNum((has ? after : base).heatKwh / base.netArea, 0)} kWh/m² · {fmtFixed(base.netArea, 0)} m² beheizt</small>
        </div>
        <div className="stat">
          <span>Heizkosten pro Jahr</span>
          <b>{fmtEuro((has ? after : base).hp.cost)}</b>
          <small>mit Wärmepumpe · heute mit Öl {fmtEuro(base.oil.cost)}</small>
        </div>
      </div>

      {base.actual ? (
        <div className="callout">
          <Icon name="chart" size={16} />
          <span>
            Dein Ölverbrauch {base.actual.year}: {fmtNum(base.actual.liters, 0)} l. Daraus ergibt sich eine Heizlast von ca. <b>{kw(base.actual.loadKw)}</b> (Verbrauchsmethode, 2.000 Volllaststunden) – das Modell liegt bei {kw(base.loadKw)}.
            {base.actual.loadKw < base.loadKw * 0.75 ? ' Wahrscheinlich sind einige U-Werte zu pessimistisch oder nicht alle Räume werden voll beheizt.' : ''}
          </span>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-head">
          <h3>Wärmeverluste nach Bauteil</h3>
          <span className="small muted">Summe {kw(base.loadKw)}</span>
        </div>
        <LossBars res={base} onU={setU} />
        <p className="small muted" style={{ marginTop: 8 }}>
          Faktoren für Flächen gegen unbeheizte Bereiche: Keller 0,5, Dachboden 0,7–0,9, beheiztes Nachbarhaus 0,15. Wände zum Nachbarhaus erkennt die App am Lageplan; im Grundriss kannst du das je Wand ändern.
        </p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Was wäre, wenn …</h3>
          {has ? <Pill tone="accent">{kw(base.loadKw)} → {kw(after.loadKw)}</Pill> : null}
        </div>
        {all.length ? (
          <ul className="measure-list">
            {all.map((m) => {
              const d = singles[m.key] || { dKw: 0, dCost: 0 };
              return (
                <li key={m.key} className={selected.includes(m.key) ? 'is-on' : ''}>
                  <Toggle checked={selected.includes(m.key)} onChange={() => toggle(m.key)} label={m.label} />
                  <span className="measure-fig">
                    <b>− {kw(d.dKw)}</b>
                    <small>− {fmtEuro(d.dCost)}/a mit WP · grob {fmtEuro(Math.round(m.cost / 500) * 500)}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="small muted">Die Gebäudehülle ist schon gut gedämmt – keine typischen Maßnahmen offen.</p>
        )}
        {has ? (
          <div className="callout callout-info" style={{ marginTop: 10 }}>
            <Icon name="flame" size={16} />
            <span>
              Mit {measures.length === 1 ? 'dieser Maßnahme' : `diesen ${measures.length} Maßnahmen`} sinkt die Heizlast auf <b>{kw(after.loadKw)}</b>. {after.hpSize < base.hpSize ? (
                <>
                  Eine Wärmepumpe mit ca. <b>{after.hpSize} kW</b> statt {base.hpSize} kW reicht,
                </>
              ) : (
                <>Die Wärmepumpe bleibt bei ca. {after.hpSize} kW,</>
              )}{' '}
              die Heizkosten sinken um ca. {fmtEuro(base.hp.cost - after.hp.cost)} pro Jahr. Kosten der Maßnahmen grob {fmtEuro(Math.round(measures.reduce((s, m) => s + m.cost, 0) / 1000) * 1000)} vor Förderung.
            </span>
          </div>
        ) : null}
        <p className="small muted" style={{ marginTop: 8 }}>Kosten sind grobe Richtwerte (Material + Handwerker), ohne Förderung. Gedämmte Flächen senken auch die nötige Vorlauftemperatur – das verbessert die Effizienz der Wärmepumpe zusätzlich.</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Kosten und CO₂ pro Jahr</h3>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Variante</th>
                <th className="r">Energie</th>
                <th className="r">Kosten</th>
                <th className="r">CO₂</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Ölheizung (heute)</td>
                <td className="r">{fmtNum(base.oil.liters, 0)} l</td>
                <td className="r">{fmtEuro(base.oil.cost)}</td>
                <td className="r">{fmtFixed(base.oil.co2, 1)} t</td>
              </tr>
              <tr>
                <td>Wärmepumpe</td>
                <td className="r">{fmtNum(base.hp.kwh, 0)} kWh</td>
                <td className="r">{fmtEuro(base.hp.cost)}</td>
                <td className="r">{fmtFixed(base.hp.co2, 1)} t</td>
              </tr>
              {has ? (
                <tr>
                  <td>Wärmepumpe + Maßnahmen</td>
                  <td className="r">{fmtNum(after.hp.kwh, 0)} kWh</td>
                  <td className="r">{fmtEuro(after.hp.cost)}</td>
                  <td className="r">{fmtFixed(after.hp.co2, 1)} t</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Öl {fmtNum(cfg.priceOil, 2)} €/l bei {fmtNum(cfg.oilEff * 100, 0)} % Nutzungsgrad, Wärmepumpe {fmtNum(cfg.priceHp, 2)} €/kWh mit JAZ {fmtNum(base.emitter.jaz, 1)} ({base.emitter.name}, Vorlauf ca. {base.emitter.flow} °C). CO₂: Heizöl 0,31 kg/kWh, Strommix 0,36 kg/kWh. Ohne Grundgebühren und Wartung.
        </p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Annahmen</h3>
          <Btn small kind="ghost" onClick={() => setHeat({ tIn: null, tOut: null, ach: null, priceOil: null, priceHp: null, emitter: null, degreeDays: null })}>
            Standardwerte
          </Btn>
        </div>
        <div className="grid3">
          <Field label="Raumtemperatur">
            <NumInput value={cfg.tIn} onChange={(v) => v != null && setHeat({ tIn: v })} unit="°C" digits={1} />
          </Field>
          <Field label="Norm-Außentemperatur" hint="DIN/TS 12831-1, für deinen Ort prüfen">
            <NumInput value={cfg.tOut} onChange={(v) => v != null && setHeat({ tOut: v })} unit="°C" digits={1} />
          </Field>
          <Field label="Luftwechsel" hint="Altbau 0,6–0,8 · neue Fenster 0,5">
            <NumInput value={cfg.ach} onChange={(v) => v > 0 && setHeat({ ach: v })} unit="1/h" digits={2} />
          </Field>
          <Field label="Personen im Haushalt" hint="für den Warmwasserbedarf">
            <NumInput value={h.persons} onChange={(v) => updateHouse((x) => ({ ...x, persons: v }), 300)} digits={0} placeholder="2" />
          </Field>
          <Field label="Heizflächen">
            <Select value={cfg.emitter} onChange={(v) => setHeat({ emitter: v })} options={EMITTERS.map((e) => ({ value: e.key, label: `${e.name} (${e.flow} °C)` }))} />
          </Field>
          <Field label="Gradtagzahl" hint="G20/15, Harzvorland ca. 3.800">
            <NumInput value={cfg.degreeDays} onChange={(v) => v > 0 && setHeat({ degreeDays: v })} unit="Kd" digits={0} />
          </Field>
          <Field label="Heizölpreis">
            <NumInput value={cfg.priceOil} onChange={(v) => v > 0 && setHeat({ priceOil: v })} unit="€/l" digits={2} />
          </Field>
          <Field label="Wärmepumpen-Strom">
            <NumInput value={cfg.priceHp} onChange={(v) => v > 0 && setHeat({ priceHp: v })} unit="€/kWh" digits={2} />
          </Field>
        </div>
        <div className="divider" />
        <span className="field-label">Beheizte Etagen</span>
        <div className="chips" style={{ marginTop: 6 }}>
          {floors.map((f) => {
            const on = isHeatedFloor(f, h);
            return (
              <button key={f.id} className={`chip ${on ? 'is-on' : ''}`} onClick={() => setHeat({ heatedFloors: { ...(heat.heatedFloors || {}), [f.id]: !on } })}>
                {f.short || f.name} {on ? 'beheizt' : 'unbeheizt'}
              </button>
            );
          })}
        </div>
      </div>

      <AiRunner
        title="Mit KI einordnen"
        icon="flame"
        desc="Bewertet die Schätzung, die Eignung für eine Wärmepumpe, die sinnvolle Reihenfolge der Maßnahmen und die passende Förderung."
        saved={heat.ai}
        run={(signal) => aiHeat(data, base, after, measures, { signal })}
        onSave={(rec) => setHeat({ ai: rec })}
        cta="Einordnen"
        render={(r) => <HeatAi r={r} />}
      />
    </div>
  );
}

function HeatAi({ r }) {
  const tone = { gut: 'accent', bedingt: 'warn', kritisch: 'danger' }[r.hpFit?.verdict] || 'neutral';
  return (
    <div className="stack" style={{ gap: 8 }}>
      {r.summary ? <p className="ai-summary">{r.summary}</p> : null}
      {r.hpFit ? (
        <div className="callout">
          <Pill tone={tone}>Wärmepumpe: {r.hpFit.verdict}</Pill>
          <span>{r.hpFit.reason}</span>
        </div>
      ) : null}
      {r.sizing ? <p className="small"><b>Leistung:</b> {r.sizing}</p> : null}
      {r.plausibility ? <p className="small muted">{r.plausibility}</p> : null}
      {(r.steps || []).length ? (
        <ul className="ai-list">
          {r.steps.map((s, i) => (
            <li key={i} className="ai-item">
              <div className="ai-item-head">
                <b>{s.title}</b>
                {s.when ? <Pill>{s.when}</Pill> : null}
              </div>
              <span className="small">{s.why}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {(r.funding || []).length ? (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {r.funding.map((f, i) => (
            <li key={i}>
              <b>{f.program}</b>
              {f.amount ? ` – ${f.amount}` : ''}
              {f.note ? `: ${f.note}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {(r.warnings || []).length ? (
        <ul className="small" style={{ margin: 0, paddingLeft: 18, color: 'var(--warn-ink)' }}>
          {r.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Compact hint for heating projects, linking to the full check.
export function HeatHint({ data }) {
  const r = useMemo(() => heatResult(data.house, Object.values(data.floors), data.components, data.readings), [data.house, data.floors, data.components, data.readings]);
  if (!r.heated.length) return null;
  return (
    <div className="callout callout-info" style={{ marginTop: 10 }}>
      <Icon name="flame" size={16} />
      <div style={{ flex: 1 }}>
        Heizlast laut 3D-Modell ca. <b>{kw(r.loadKw)}</b> → Wärmepumpe ca. <b>{r.hpSize} kW</b>. Heizkosten mit Wärmepumpe ca. {fmtEuro(r.hp.cost)} statt {fmtEuro(r.oil.cost)} mit Öl.
        <div style={{ marginTop: 6 }}>
          <Btn small icon="flame" onClick={() => { setUI({ buildingTab: 'energie', drawer: null }); go('gebaeude'); }}>
            Heizlast-Check öffnen
          </Btn>
        </div>
      </div>
    </div>
  );
}
