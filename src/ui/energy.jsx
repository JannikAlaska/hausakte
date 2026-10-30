// Heat load and heat pump check: losses per surface from the 3D model, editable U-values, what-if measures,
// running costs oil vs. heat pump and an AI assessment.
import { Icon } from './icons.jsx';
import { Btn, Field, NumInput, Select, Toggle, Pill } from './common.jsx';
import { AiRunner } from './ai-ui.jsx';
import { setUI, go } from './state.js';
import { updateHouse } from '../store.js';
import { heatResult, heatMeasures, applyMeasures, EMITTERS, HEAT_DEFAULTS, isHeatedFloor } from '../heat.js';
import { sortFloors, projectCost, liveProjects } from '../metrics.js';
import { economics, kfw458, LIFE, PRICE_RISE } from '../econ.js';
import { EconLine, AiVerdict } from './econ.jsx';
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
          return [m.key, { dKw: base.loadKw - r.loadKw, dCost: base.hp.cost - r.hp.cost, dOil: base.oil.cost - r.oil.cost }];
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
  // economics settings
  const fund = heat.fundEnvelope ?? 0.2;
  const rise = heat.priceRise ?? PRICE_RISE;
  const lifeOf = (m) => (m.key === 'fenster' ? LIFE.fenster : LIFE.daemmung);
  const econOf = (m, saving) => economics({ invest: m.cost, funding: m.cost * fund, saving, life: lifeOf(m), rise });
  const sumCost = measures.reduce((a, m) => a + m.cost, 0);
  const eAll = has ? economics({ invest: sumCost, funding: sumCost * fund, saving: base.hp.cost - after.hp.cost, life: Math.min(...measures.map(lifeOf)), rise }) : null;
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
              const d = singles[m.key] || { dKw: 0, dCost: 0, dOil: 0 };
              const e = econOf(m, d.dCost);
              const wallHint = m.key.startsWith('wall:') && e.verdict !== 'gut' ? 'rechnet sich meist nur zusammen mit ohnehin nötigen Fassadenarbeiten (Gerüst, Putz) – dann zählen nur die Mehrkosten' : null;
              return (
                <li key={m.key} className={selected.includes(m.key) ? 'is-on' : ''}>
                  <div className="measure-row">
                    <Toggle checked={selected.includes(m.key)} onChange={() => toggle(m.key)} label={m.label} />
                    <span className="measure-fig">
                      <b>− {kw(d.dKw)}</b>
                      <small>
                        − {fmtEuro(d.dCost)}/a mit WP (mit Öl − {fmtEuro(d.dOil)}/a) · grob {fmtEuro(Math.round(m.cost / 500) * 500)}, nach Förderung {fmtEuro(Math.round(e.net / 500) * 500)}
                      </small>
                    </span>
                  </div>
                  <EconLine e={e} hint={wallHint} />
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
              die Heizkosten sinken um ca. {fmtEuro(base.hp.cost - after.hp.cost)} pro Jahr. Kosten der Maßnahmen grob {fmtEuro(Math.round(sumCost / 1000) * 1000)}, nach Förderung {fmtEuro(Math.round(eAll.net / 1000) * 1000)}.
              <EconLine e={eAll} />
            </span>
          </div>
        ) : null}
        <p className="small muted" style={{ marginTop: 8 }}>
          Kosten sind grobe Richtwerte (Material + Handwerker). Förderung: {fund ? `${fmtNum(fund * 100, 0)} % (${fund >= 0.2 ? 'Steuerbonus § 35c, oft günstiger als 15 % BAFA' : 'BAFA BEG EM'})` : 'keine'}. Energiepreise steigen mit {fmtNum(rise * 100, 1)} % pro Jahr. Wirtschaftlich heißt: amortisiert sich in weniger als der halben Lebensdauer. Nicht eingerechnet sind Komfort, Werterhalt und eine kleinere Wärmepumpe.
        </p>
      </div>

      <HpEconomics data={data} base={has ? after : base} heat={heat} rise={rise} />

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
          <Field label="Förderung Dämmung & Fenster">
            <Select value={String(fund)} onChange={(v) => setHeat({ fundEnvelope: Number(v) })} options={[{ value: '0.2', label: '20 % Steuerbonus (§ 35c)' }, { value: '0.15', label: '15 % BAFA-Zuschuss' }, { value: '0', label: 'keine' }]} />
          </Field>
          <Field label="KfW-Einkommensbonus" hint="zu versteuerndes Einkommen bis 40.000 €">
            <Select value={String(heat.incomeBonus ?? 0)} onChange={(v) => setHeat({ incomeBonus: Number(v) })} options={[{ value: '0', label: 'keiner' }, { value: '0.1', label: '10 %' }, { value: '0.3', label: '30 %' }, { value: '0.4', label: '40 %' }]} />
          </Field>
          <Field label="Preissteigerung Energie">
            <NumInput value={rise * 100} onChange={(v) => v != null && setHeat({ priceRise: v / 100 })} unit="%/a" digits={1} />
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

// Does the heat pump pay off? Against keeping the old boiler and against a new oil boiler.
const OIL_BOILER = 12000;
function hpEconomics(data, base, heat, rise) {
  const proj = liveProjects(data.projects).find((p) => p.kind === 'heizung');
  const planned = proj ? projectCost(proj).best : 0;
  const invest = planned || 12000 + 1600 * base.hpSize;
  const grant = kfw458(invest, { replaceFossil: true, incomeBonus: heat.incomeBonus ?? 0, efficiency: !!heat.efficiencyBonus });
  const riseOil = rise + 0.01, // includes the rising CO₂ price
    risePower = Math.max(0, rise - 0.01);
  const saving = (y) => base.oil.cost * Math.pow(1 + riseOil, y - 1) - base.hp.cost * Math.pow(1 + risePower, y - 1) + 100;
  const eKeep = economics({ invest, funding: grant.amount, saving, life: LIFE.waermepumpe });
  const eNew = economics({ invest: Math.max(0, invest - grant.amount), funding: OIL_BOILER, saving, life: LIFE.waermepumpe });
  return { planned, invest, grant, riseOil, risePower, saving, eKeep, eNew };
}

function HpEconomics({ data, base, heat, rise }) {
  const { planned, invest, grant, riseOil, risePower, saving, eKeep, eNew } = hpEconomics(data, base, heat, rise);
  const oilBoiler = OIL_BOILER;
  let oil20 = oilBoiler,
    hp20 = invest - grant.amount;
  for (let y = 1; y <= 20; y++) {
    oil20 += base.oil.cost * Math.pow(1 + riseOil, y - 1);
    hp20 += base.hp.cost * Math.pow(1 + risePower, y - 1) - 100;
  }
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Lohnt sich die Wärmepumpe?</h3>
      </div>
      <div>
        <div className="kv"><span>Investition {planned ? '(aus deinem Heizungsprojekt)' : '(Schätzung)'}</span><b>{fmtEuro(invest)}</b></div>
        <div className="kv"><span>KfW-Zuschuss 458 ({fmtNum(grant.rate * 100, 0)} % von max. 28.000 €)</span><b>− {fmtEuro(grant.amount)}</b></div>
        <div className="kv"><span>Eigenanteil</span><b>{fmtEuro(invest - grant.amount)}</b></div>
        <div className="kv"><span>Ersparnis im 1. Jahr gegenüber Öl</span><b>{fmtEuro(saving(1))}</b></div>
        <div className="kv"><span>Kosten über 20 Jahre: neuer Ölkessel + Öl</span><b>{fmtEuro(Math.round(oil20 / 1000) * 1000)}</b></div>
        <div className="kv"><span>Kosten über 20 Jahre: Wärmepumpe + Strom</span><b>{fmtEuro(Math.round(hp20 / 1000) * 1000)}</b></div>
      </div>
      <div className="stack" style={{ gap: 6, marginTop: 10 }}>
        <div>
          <span className="field-label">Statt alten Kessel weiter zu betreiben</span>
          <EconLine e={eKeep} />
        </div>
        <div>
          <span className="field-label">Statt eines neuen Ölkessels (ca. {fmtEuro(oilBoiler)})</span>
          <EconLine e={eNew} />
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Der Ölkessel von 1992 muss nach dem Eigentümerwechsel womöglich ohnehin ersetzt werden (Austauschpflicht prüfen) – dann ist der Vergleich mit einem neuen Ölkessel der richtige. Annahmen: Öl +{fmtNum(riseOil * 100, 1)} %/a (inkl. CO₂-Preis), Strom +{fmtNum(risePower * 100, 1)} %/a, Wartung Wärmepumpe 100 €/a günstiger. Neue Ölheizungen brauchen ab 2029 steigende Bio-Anteile, das verteuert Öl zusätzlich.
      </p>
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
              <AiVerdict verdict={s.verdict} payback={s.payback} />
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
  const hp = hpEconomics(data, r, data.house.heat || {}, data.house.heat?.priceRise ?? PRICE_RISE);
  return (
    <div className="callout callout-info" style={{ marginTop: 10 }}>
      <Icon name="flame" size={16} />
      <div style={{ flex: 1 }}>
        Heizlast laut 3D-Modell ca. <b>{kw(r.loadKw)}</b> → Wärmepumpe ca. <b>{r.hpSize} kW</b>. Heizkosten mit Wärmepumpe ca. {fmtEuro(r.hp.cost)} statt {fmtEuro(r.oil.cost)} mit Öl.
        <EconLine e={hp.eNew} hint="gegenüber einem neuen Ölkessel, nach KfW-Zuschuss" />
        <div style={{ marginTop: 6 }}>
          <Btn small icon="flame" onClick={() => { setUI({ buildingTab: 'energie', drawer: null }); go('gebaeude'); }}>
            Heizlast-Check öffnen
          </Btn>
        </div>
      </div>
    </div>
  );
}
