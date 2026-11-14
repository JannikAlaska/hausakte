// Planning the PV system: module type and data sheet values, layout on the roof, inverter, battery and
// cost breakdown. Everything is stored in house.solar.cfg and used by layout, yield and economics.
import { Icon } from './icons.jsx';
import { Btn, Field, NumInput, Select, Toggle, Seg, TextInput } from './common.jsx';
import { toast, useUI } from './state.js';
import { updateHouse } from '../store.js';
import { patchProject } from '../actions.js';
import { MODULE_PRESETS, INVERTER_KINDS, ORIENTS, inverterKind, autoInverterKw, slopeUsedByDefault, COST_DEFAULTS } from '../pv.js';
import { bearingName } from '../roof.js';
import { fmtNum, fmtFixed, uid } from '../util.js';

const euro = (n) => (n == null || !Number.isFinite(Number(n)) ? '–' : Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }));
const pct = (v, d = 1) => `${fmtFixed(v * 100, d)} %`;

const setSolar = (fn) => updateHouse((x) => ({ ...x, solar: fn(x.solar || {}) }), 300);
const setCfg = (patch) => setSolar((s) => ({ ...s, cfg: { ...(s.cfg || {}), ...patch } }));
const setPart = (part) => (patch) => setSolar((s) => ({ ...s, cfg: { ...(s.cfg || {}), [part]: { ...(s.cfg?.[part] || {}), ...patch } } }));
const setModule = setPart('module');
const setInv = setPart('inverter');
const setBat = setPart('battery');
const setCosts = setPart('costs');

function Sec({ title, value, icon, children, open }) {
  return (
    <details className="pv-sec" open={open}>
      <summary>
        <Icon name={icon} size={16} />
        <b>{title}</b>
        <span className="pv-sec-val">{value}</span>
        <Icon name="chevD" size={15} className="pv-sec-chev" />
      </summary>
      <div className="pv-sec-body">{children}</div>
    </details>
  );
}

const slopeName = (p) => `${p.label ? p.label + ' ' : ''}${p.azimuth != null ? `${bearingName(p.azimuth)} (${fmtNum(p.azimuth, 0)}°)` : 'flach'}, ${fmtNum(p.tilt, 0)}° Neigung`;

// sel: pvSelection, en: pvEnergy (or null before the analysis), costs: pvCosts, battery: kWh
export function PvSetup({ data, sel, en, costs, battery, invest, investSource, pvProject }) {
  const ui = useUI();
  const cfg = sel.cfg;
  const m = cfg.module;
  const raw = data.house?.solar?.cfg?.module || {};
  const overridden = ['w', 'h', 'wp', 'tc', 'deg', 'life', 'price'].some((k) => raw[k] != null) && !m.custom;
  const inv = cfg.inverter;
  const ik = inverterKind(inv.kind);
  const acAuto = autoInverterKw(sel.kwp);
  const acKw = inv.kw ?? acAuto;
  const after = Math.pow(1 - m.deg / 100, m.life);
  const toProject = () => {
    if (!pvProject) return;
    const items = costs.items.map((x) => ({ id: uid('k'), label: x.label, estimate: Math.round(x.amount), offer: null, actual: null, vendor: '', note: 'aus der PV-Planung', src: 'pvplan' }));
    patchProject(pvProject.id, (p) => ({ ...p, costs: [...(p.costs || []).filter((c) => c.src !== 'pvplan'), ...items] }));
    toast(`${items.length} Kostenpositionen (${euro(costs.total)}) als Schätzung in „${pvProject.title}“ übernommen`);
  };
  return (
    <div className="panel pv-setup">
      <div className="panel-head">
        <h3>Anlage planen</h3>
        <span className="small muted">
          {sel.count} Module · {fmtFixed(sel.kwp, 2)} kWp · {fmtFixed(sel.count * m.area, 1)} m²
        </span>
      </div>

      <Sec title="Module" icon="sun" value={`${m.name} · ${fmtNum(m.wp, 0)} Wp`} open={!ui.mobile}>
        <Field label="Modultyp">
          <Select
            value={m.preset}
            onChange={(v) => setCfg({ module: { preset: v } })}
            options={[...MODULE_PRESETS.map((x) => ({ value: x.key, label: `${x.name} – ${x.tech}` })), { value: 'custom', label: 'Eigenes Modul (Werte aus dem Datenblatt)' }]}
          />
        </Field>
        {m.custom ? (
          <Field label="Bezeichnung">
            <TextInput value={raw.name || ''} onChange={(v) => setModule({ name: v })} placeholder="z. B. Hersteller und Modell aus dem Angebot" />
          </Field>
        ) : null}
        <div className="grid3">
          <Field label="Breite" hint="kurze Seite">
            <NumInput value={m.w} onChange={(v) => v > 0.3 && setModule({ w: v })} unit="m" digits={3} />
          </Field>
          <Field label="Länge" hint="lange Seite">
            <NumInput value={m.h} onChange={(v) => v > 0.3 && setModule({ h: v })} unit="m" digits={3} />
          </Field>
          <Field label="Nennleistung" hint="Wp unter Standardbedingungen">
            <NumInput value={m.wp} onChange={(v) => v > 10 && setModule({ wp: v })} unit="Wp" digits={0} />
          </Field>
          <Field label="Temperaturkoeffizient" hint="Leistung je °C über 25 °C">
            <NumInput value={m.tc} onChange={(v) => v != null && v <= 0 && v > -1 && setModule({ tc: v })} unit="%/K" digits={2} />
          </Field>
          <Field label="Leistungsverlust" hint="Alterung pro Jahr">
            <NumInput value={m.deg} onChange={(v) => v != null && v >= 0 && v < 3 && setModule({ deg: v })} unit="%/a" digits={2} />
          </Field>
          <Field label="Lebensdauer" hint="für die Wirtschaftlichkeit">
            <NumInput value={m.life} onChange={(v) => v >= 10 && v <= 40 && setModule({ life: Math.round(v) })} unit="Jahre" digits={0} />
          </Field>
          <Field label="Preis je Modul">
            <NumInput value={m.price} onChange={(v) => v != null && v >= 0 && setModule({ price: v })} unit="€" digits={0} />
          </Field>
          <Field label="Sonstige Verluste" hint="Kabel, Verschmutzung, Schwachlicht">
            <NumInput value={cfg.losses} onChange={(v) => v != null && v >= 0 && v < 30 && setCfg({ losses: v })} unit="%" digits={1} />
          </Field>
        </div>
        <p className="small muted pv-facts">
          {fmtFixed(m.area, 2)} m² je Modul · Wirkungsgrad {pct(m.eff)} · nach {m.life} Jahren noch ca. {fmtNum(after * 100, 0)} % Leistung
          {overridden ? (
            <>
              {' · '}
              <button className="link small" onClick={() => setCfg({ module: { preset: m.preset } })}>
                Werte des Modultyps wiederherstellen
              </button>
            </>
          ) : null}
        </p>
      </Sec>

      <Sec title="Belegung" icon="layers" value={`${sel.count} von max. ${sel.max} Modulen · ${ORIENTS.find((o) => o.key === cfg.orient)?.name}`}>
        <div className="grid3">
          <Field label="Anzahl Module" hint={`es passen bis zu ${sel.max} auf die gewählten Flächen`}>
            <NumInput value={cfg.count} placeholder={`alle (${sel.max})`} onChange={(v) => setCfg({ count: v == null ? null : Math.max(0, Math.round(v)) })} unit="Stück" digits={0} />
          </Field>
          <Field label="Ausrichtung der Module">
            <Seg small value={cfg.orient} onChange={(v) => setCfg({ orient: v })} options={ORIENTS.map((o) => ({ value: o.key, label: o.name }))} />
          </Field>
          <Field label="Randabstand" hint="zu First, Traufe, Ortgang">
            <NumInput value={cfg.margin} onChange={(v) => v != null && v >= 0 && v < 3 && setCfg({ margin: v })} unit="m" digits={2} />
          </Field>
          <Field label="Abstand zwischen Modulen">
            <NumInput value={Math.round(cfg.gap * 1000) / 10} onChange={(v) => v != null && v >= 0 && v < 50 && setCfg({ gap: v / 100 })} unit="cm" digits={1} />
          </Field>
        </div>
        {cfg.count != null ? (
          <button className="link small" onClick={() => setCfg({ count: null })}>
            So viele Module wie möglich
          </button>
        ) : null}
        <span className="field-label" style={{ marginTop: 8 }}>
          Dachflächen
        </span>
        <div className="pv-slopes">
          {sel.all
            .filter((p) => p.area > 1)
            .map((p) => {
              const on = sel.used(p);
              const planned = sel.slopes.find((x) => x.key === p.key)?.modules || 0;
              return (
                <div key={p.key} className={`pv-slope ${on ? '' : 'is-off'}`}>
                  <Toggle checked={on} onChange={(v) => setCfg({ slopes: { ...cfg.slopes, [p.key]: v } })} label={slopeName(p)} />
                  <span className="small muted">
                    {p.modules ? `${p.modules} Module möglich` : 'zu klein'} · Ertrag {fmtNum(p.factor * 100, 0)} % {on && planned ? `· geplant ${planned}` : ''}
                    {!on && p.modules && slopeUsedByDefault(p) ? ' · gute Fläche' : ''}
                  </span>
                </div>
              );
            })}
        </div>
        <p className="small muted">Gefüllt werden zuerst die Flächen mit dem besten Ertrag. Bei einem Doppelhaus verlangt die Landesbauordnung zur Brandwand oft einen größeren Abstand (je nach Land 0,5–1,25 m) – den Randabstand dann entsprechend wählen.</p>
      </Sec>

      <Sec title="Wechselrichter" icon="bolt" value={`${ik.name} · ${fmtFixed(acKw, 1)} kW`}>
        <Field label="Art">
          <Select value={inv.kind} onChange={(v) => setCfg({ inverter: { kind: v } })} options={INVERTER_KINDS.map((k) => ({ value: k.key, label: k.name }))} />
        </Field>
        <p className="small muted" style={{ marginTop: -4 }}>
          {ik.hint}
        </p>
        <div className="grid3">
          <Field label="Leistung (AC)" hint={inv.kw == null ? `automatisch: ${fmtFixed(acAuto, 1)} kW` : `DC/AC-Verhältnis ${fmtFixed(sel.kwp / acKw || 0, 2)}`}>
            <NumInput value={inv.kw} placeholder={fmtFixed(acAuto, 1)} onChange={(v) => setInv({ kw: v > 0 ? v : null })} unit="kW" digits={1} />
          </Field>
          <Field label="Wirkungsgrad" hint="Europäischer Wirkungsgrad">
            <NumInput value={inv.eff} onChange={(v) => v > 80 && v <= 100 && setInv({ eff: v })} unit="%" digits={1} />
          </Field>
          <Field label="Lebensdauer" hint="danach Tausch eingerechnet">
            <NumInput value={inv.life} onChange={(v) => v >= 5 && v <= 40 && setInv({ life: Math.round(v) })} unit="Jahre" digits={0} />
          </Field>
          <Field label="Preis" hint={inv.price == null ? `geschätzt ${euro(costs.invAuto)}` : 'eigene Angabe'}>
            <NumInput value={inv.price} placeholder={String(costs.invAuto)} onChange={(v) => setInv({ price: v != null && v >= 0 ? v : null })} unit="€" digits={0} />
          </Field>
        </div>
        {en ? (
          <p className="small muted">
            Begrenzung durch den Wechselrichter: {en.clipShare < 0.001 ? 'praktisch keine' : `ca. ${pct(en.clipShare)} des Ertrags (${fmtNum(Math.round(en.clip / 10) * 10, 0)} kWh/a)`}. Etwas kleiner als die Modulleistung (DC/AC bis ca. 1,2) ist üblich und kostet kaum Ertrag.
          </p>
        ) : null}
      </Sec>

      <Sec title="Speicher" icon="layers" value={battery > 0 ? `${fmtNum(battery, 1)} kWh` : 'ohne'}>
        <div className="grid3">
          <Field label="Nutzbare Kapazität">
            <NumInput value={battery} onChange={(v) => v != null && v >= 0 && setSolar((s) => ({ ...s, battery: v }))} unit="kWh" digits={1} />
          </Field>
          <Field label="Preis je kWh" hint="inkl. Einbau">
            <NumInput value={cfg.battery.price} onChange={(v) => v != null && v >= 0 && setBat({ price: v })} unit="€" digits={0} />
          </Field>
          <Field label="Wirkungsgrad" hint="Laden und Entladen zusammen">
            <NumInput value={cfg.battery.eff} onChange={(v) => v >= 50 && v <= 100 && setBat({ eff: v })} unit="%" digits={0} />
          </Field>
        </div>
        {battery > 0 && inv.kind === 'string' ? <p className="small muted">Für einen Speicher brauchst du einen Hybrid-Wechselrichter oder einen eigenen Batterie-Wechselrichter (AC-gekoppelt).</p> : null}
      </Sec>

      <Sec title="Kosten" icon="euro" value={`${euro(invest)}${investSource === 'eigene Angabe' ? ' (Angebot)' : ''}`}>
        <div className="grid3">
          <Field label="Unterkonstruktion & Montage" hint="je Modul">
            <NumInput value={cfg.costs.mount} placeholder={String(COST_DEFAULTS.mount)} onChange={(v) => v != null && v >= 0 && setCosts({ mount: v })} unit="€" digits={0} />
          </Field>
          <Field label="Elektro & Zählerschrank" hint="inkl. Anmeldung">
            <NumInput value={cfg.costs.electric} onChange={(v) => v != null && v >= 0 && setCosts({ electric: v })} unit="€" digits={0} />
          </Field>
          <Field label="Gerüst" hint="0, wenn es schon steht">
            <NumInput value={cfg.costs.scaffold} onChange={(v) => v != null && v >= 0 && setCosts({ scaffold: v })} unit="€" digits={0} />
          </Field>
          <Field label="Planung & Sonstiges">
            <NumInput value={cfg.costs.other} onChange={(v) => v != null && v >= 0 && setCosts({ other: v })} unit="€" digits={0} />
          </Field>
        </div>
        <table className="tbl pv-costs">
          <tbody>
            {costs.items.map((x) => (
              <tr key={x.key}>
                <td>{x.label}</td>
                <td className="r">{euro(x.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <b>Summe</b> <span className="small muted">· PV ohne Speicher {euro(costs.perKwp)}/kWp</span>
              </td>
              <td className="r">
                <b>{euro(costs.total)}</b>
              </td>
            </tr>
          </tfoot>
        </table>
        <Field label="Preis laut Angebot" hint="ersetzt die Summe in der Wirtschaftlichkeit (leer = Summe der Positionen)">
          <NumInput value={data.house?.solar?.invest ?? null} placeholder={String(Math.round(costs.total))} onChange={(v) => setSolar((s) => ({ ...s, invest: v > 0 ? v : null }))} unit="€" digits={0} />
        </Field>
        <p className="small muted">PV-Anlagen bis 30 kWp auf Wohnhäusern sind von der Mehrwertsteuer befreit – die Preise sind Endpreise. Richtwerte 2026, Angebote können deutlich abweichen.</p>
        {pvProject ? (
          <Btn small icon="euro" onClick={toProject}>
            Als Kostenschätzung ins Projekt „{pvProject.title}“ übernehmen
          </Btn>
        ) : null}
      </Sec>
    </div>
  );
}
