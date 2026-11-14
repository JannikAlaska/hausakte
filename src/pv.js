// Configurable PV system: module (size, power, temperature behaviour, ageing, price), layout (count,
// orientation, margins, roof slopes), inverter, battery and costs. Stored in house.solar.cfg.
// - pvSelection: the modules actually planned on the roof (3D model, shading analysis, key figures)
// - pvEnergy: electrical yield from the stored irradiation of the shading analysis (temperature,
//   other losses, inverter efficiency and clipping, shading behaviour of the inverter type)
// - pvCosts: cost breakdown and total investment
import { pvPotential } from './roof.js';

// typical module data (as of 2026, examples – the data sheet of the offered module counts)
export const MODULE_PRESETS = [
  { key: 'std430', name: 'Standard 430 Wp', tech: 'TOPCon, Glas-Folie', w: 1.134, h: 1.722, wp: 430, tc: -0.3, deg: 0.4, life: 25, price: 95 },
  { key: 'gg450', name: 'Glas-Glas 450 Wp', tech: 'TOPCon, Glas-Glas, bifazial', w: 1.134, h: 1.762, wp: 450, tc: -0.29, deg: 0.4, life: 30, price: 120 },
  { key: 'black420', name: 'Full Black 420 Wp', tech: 'TOPCon, ganz schwarz – unauffällig auf dunklem Dach', w: 1.134, h: 1.722, wp: 420, tc: -0.3, deg: 0.4, life: 25, price: 120 },
  { key: 'hjt440', name: 'Heterojunction 440 Wp', tech: 'HJT, wenig Leistungsverlust bei Hitze', w: 1.134, h: 1.722, wp: 440, tc: -0.24, deg: 0.25, life: 30, price: 140 },
  { key: 'perc400', name: 'Mono-PERC 400 Wp', tech: 'ältere Technik, günstig', w: 1.134, h: 1.722, wp: 400, tc: -0.35, deg: 0.55, life: 25, price: 75 },
  { key: 'xl510', name: 'Großformat 510 Wp', tech: 'TOPCon, für große Dachflächen', w: 1.134, h: 1.961, wp: 510, tc: -0.29, deg: 0.4, life: 25, price: 120 },
];
export const modulePreset = (k) => MODULE_PRESETS.find((m) => m.key === k) || null;

export const INVERTER_KINDS = [
  { key: 'string', name: 'String-Wechselrichter', hint: 'günstig; ein verschattetes Modul bremst den ganzen Strang etwas mit', eff: 97.5, life: 15, shade: 1.25 },
  { key: 'hybrid', name: 'Hybrid-Wechselrichter', hint: 'mit Anschluss für einen Batteriespeicher', eff: 97, life: 15, shade: 1.25 },
  { key: 'micro', name: 'Modul-Wechselrichter / Optimierer', hint: 'jedes Modul arbeitet für sich – gut bei Teilverschattung', eff: 96, life: 25, shade: 1 },
];
export const inverterKind = (k) => INVERTER_KINDS.find((x) => x.key === k) || INVERTER_KINDS[0];
export const ORIENTS = [
  { key: 'hoch', name: 'Hochkant' },
  { key: 'quer', name: 'Quer' },
  { key: 'auto', name: 'Automatisch' },
];

// cost defaults (turnkey, private home; PV up to 30 kWp without VAT)
export const COST_DEFAULTS = { mount: 190, electric: 2200, scaffold: 1200, other: 600, batteryKwh: 600 };
// typical inverter prices by kind and size
export function inverterPrice(kind, kw, modules) {
  if (kind === 'micro') return Math.round((modules * 140) / 50) * 50;
  if (kind === 'hybrid') return Math.round((900 + 160 * kw) / 50) * 50;
  return Math.round((600 + 110 * kw) / 50) * 50;
}
const INV_SIZES = [0.8, 1.6, 2, 3, 3.6, 4, 5, 6, 8, 10, 12, 15, 17, 20, 25, 30];
export const autoInverterKw = (kwp) => INV_SIZES.find((s) => s >= kwp * 0.9) || Math.ceil(kwp);

// feed-in tariff (partial feed-in, start of operation 08/2026–01/2027): ca. 7.7 ct up to 10 kWp, 6.7 ct above
export const feedInFor = (kwp) => (kwp > 10 ? (10 * 0.077 + (kwp - 10) * 0.067) / kwp : 0.077);

// complete configuration with defaults
export function pvConfig(house) {
  const c = house?.solar?.cfg || {};
  const m = c.module || {};
  const pre = modulePreset(m.preset || 'std430') || MODULE_PRESETS[0];
  const pick = (k) => (m[k] != null && Number.isFinite(Number(m[k])) ? Number(m[k]) : pre[k]);
  const module = { preset: m.preset || 'std430', custom: m.preset === 'custom', name: m.preset === 'custom' ? m.name || 'Eigenes Modul' : pre.name, tech: m.preset === 'custom' ? '' : pre.tech, w: pick('w'), h: pick('h'), wp: pick('wp'), tc: pick('tc'), deg: pick('deg'), life: pick('life'), price: pick('price') };
  module.area = module.w * module.h;
  module.eff = module.wp / (module.area * 1000);
  const inv = c.inverter || {};
  const ik = inverterKind(inv.kind);
  return {
    module,
    orient: c.orient || 'hoch',
    margin: c.margin ?? 0.45,
    gap: c.gap ?? 0.02,
    count: c.count ?? null, // null = as many as fit
    slopes: c.slopes || {}, // key -> true/false (default: good slopes)
    inverter: { kind: ik.key, kw: inv.kw ?? null, eff: inv.eff ?? ik.eff, life: inv.life ?? ik.life, price: inv.price ?? null, shade: ik.shade },
    battery: { price: c.battery?.price ?? COST_DEFAULTS.batteryKwh, eff: c.battery?.eff ?? 90 },
    losses: c.losses ?? 9, // cables, soiling, mismatch, low light, ageing in the first year (%)
    costs: { mount: c.costs?.mount ?? COST_DEFAULTS.mount, electric: c.costs?.electric ?? COST_DEFAULTS.electric, scaffold: c.costs?.scaffold ?? COST_DEFAULTS.scaffold, other: c.costs?.other ?? COST_DEFAULTS.other },
  };
}

export const layoutOpts = (cfg) => ({ w: cfg.module.w, h: cfg.module.h, wp: cfg.module.wp, orient: cfg.orient, margin: cfg.margin, gap: cfg.gap });
// inputs that change which modules lie where (a stored shading result is stale when they change)
export const layoutSig = (cfg) => JSON.stringify([cfg.module.w, cfg.module.h, cfg.orient, cfg.margin, cfg.gap, cfg.count, cfg.slopes]);

export const slopeUsedByDefault = (p) => p.factor >= 0.8;

// the planned modules: chosen slopes, best yield first, limited to the wanted number
export function pvSelection(house, floors, cfg = pvConfig(house)) {
  const all = pvPotential(house, floors, layoutOpts(cfg));
  const used = (p) => (cfg.slopes[p.key] != null ? !!cfg.slopes[p.key] : slopeUsedByDefault(p));
  const cand = all.filter((p) => p.modules > 0 && used(p)).sort((a, b) => b.factor - a.factor);
  const max = cand.reduce((s, p) => s + p.modules, 0);
  let left = cfg.count != null ? Math.max(0, Math.min(cfg.count, max)) : max;
  const slopes = [];
  for (const p of cand) {
    const n = Math.min(p.modules, left);
    left -= n;
    if (!n) continue;
    const panels = p.layout.panels.slice(0, n);
    slopes.push({ ...p, modules: n, kwp: (n * cfg.module.wp) / 1000, kwhYear: ((n * cfg.module.wp) / 1000) * 950 * p.factor, layout: { ...p.layout, panels, count: n } });
  }
  const count = slopes.reduce((s, p) => s + p.modules, 0);
  return { all, used, slopes, count, max, kwp: (count * cfg.module.wp) / 1000, cfg };
}

// ---------- electrical yield ----------
// daytime air temperature per month, northern Harz foreland (°C)
const T_DAY = [2, 3, 7, 12, 16, 19, 21, 21, 17, 12, 6, 3];
// spread of days around the typical day (share, irradiation factor, warmer/cooler than average in °C):
// bright days drive the modules hot and hit the inverter limit, dull days do neither
const DAY_MIX = [
  [0.3, 1.7, 4],
  [0.4, 1.0, 0],
  [0.3, 0.37, -3],
];
const MIX_MEAN = DAY_MIX.reduce((s, [a, f]) => s + a * f, 0);
const T_RISE = 0.035; // module above air temperature per W/m² (mounted on the roof with a small gap)
const OLD_KWP = 0.43,
  OLD_PR = 0.86;

// irradiation data of a shading result (version 1 stored kWh for 430 Wp modules and 86 % PR)
function irrOf(r) {
  if (r.v >= 2) return r;
  const k = 1 / (OLD_KWP * OLD_PR);
  return {
    n: r.modules.length,
    irr: r.total * k,
    freeIrr: r.free * k,
    hourlyIrr: r.hourly.map((row) => row.map((v) => v * k)),
    modules: r.modules.map((m) => ({ s: m.s, loss: m.loss, irr: m.kwh * k })),
    slopes: r.slopes.map((s) => ({ ...s, irr: s.kwh * k })),
  };
}

// energy for the current configuration; inverterKw null = automatic size
export function pvEnergy(result, cfg) {
  if (!result) return null;
  const R = irrOf(result);
  const n = R.n || R.modules.length;
  const kwpMod = cfg.module.wp / 1000;
  const kwp = n * kwpMod;
  const inv = cfg.inverter;
  const acKw = inv.kw ?? autoInverterKw(kwp);
  const effInv = inv.eff / 100;
  const other = 1 - cfg.losses / 100;
  // a string inverter loses a bit more under partial shading than module-level electronics
  const shadeLoss = R.freeIrr ? 1 - R.irr / R.freeIrr : 0;
  const shadeAdj = R.irr > 0 ? Math.max(0, R.freeIrr - (R.freeIrr - R.irr) * inv.shade) / R.irr : 1;
  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const hourly = [];
  const monthly = [];
  let dc = 0,
    clip = 0,
    ideal = 0,
    tempSum = 0;
  for (let m = 0; m < 12; m++) {
    const row = [];
    let mon = 0;
    for (let h = 0; h < 24; h++) {
      const irr = (R.hourlyIrr[m]?.[h] || 0) * shadeAdj; // kWh/m² summed over modules, typical day
      const g = n ? (irr * 1000) / n : 0; // mean irradiance on one module in this hour (W/m²)
      ideal += irr * kwpMod * DAYS[m];
      // per kind of day: module temperature (hot modules deliver less) and the inverter's AC limit
      let ac = 0,
        cl = 0,
        dcH = 0;
      for (const [share, f, dt] of DAY_MIX) {
        const k = f / MIX_MEAN;
        const tCell = T_DAY[m] + dt + g * k * T_RISE;
        const tf = 1 + (cfg.module.tc / 100) * (tCell - 25);
        const d = irr * k * kwpMod * other * tf;
        tempSum += share * irr * k * kwpMod * (tf - 1) * DAYS[m];
        const p = d * effInv;
        const lim = Math.min(p, acKw);
        ac += share * lim;
        cl += share * (p - lim);
        dcH += share * d;
      }
      dc += dcH * DAYS[m];
      clip += cl * DAYS[m];
      row.push(ac);
      mon += ac * DAYS[m];
    }
    hourly.push(row);
    monthly.push(mon);
  }
  const total = monthly.reduce((a, b) => a + b, 0);
  const freeFactor = R.irr > 0 ? R.freeIrr / (R.irr * shadeAdj) : 1;
  const perIrr = R.irr > 0 ? total / (R.irr * shadeAdj) : 0; // kWh AC per kWh/m² (for modules and slopes)
  return {
    n,
    kwp,
    acKw,
    dcAc: acKw ? kwp / acKw : 0,
    total,
    free: total * freeFactor,
    loss: 1 - (R.irr * shadeAdj) / (R.freeIrr || 1),
    shadeLossIrr: shadeLoss,
    clip,
    clipShare: dc ? clip / (dc * effInv) : 0,
    tempLoss: ideal ? -tempSum / ideal : 0,
    pr: ideal ? total / ideal : 0,
    specific: kwp ? total / kwp : 0,
    hourly,
    monthly,
    modules: R.modules.map((m) => ({ s: m.s, loss: m.loss, kwh: m.irr * shadeAdj * perIrr })),
    slopes: R.slopes.map((s) => ({ ...s, kwp: s.modules * kwpMod, kwh: (s.irr ?? 0) * shadeAdj * perIrr })),
  };
}

// ---------- costs ----------
export function pvCosts(cfg, { modules, kwp, battery = 0, acKw }) {
  const inv = cfg.inverter;
  const kw = acKw ?? inv.kw ?? autoInverterKw(kwp);
  const invAuto = inverterPrice(inv.kind, kw, modules);
  const invPrice = inv.price ?? invAuto;
  const items = [
    { key: 'module', label: `PV-Module (${modules} × ${Math.round(cfg.module.price)} €)`, amount: modules * cfg.module.price },
    { key: 'inverter', label: `Wechselrichter (${inverterKind(inv.kind).name}, ${String(kw).replace('.', ',')} kW)`, amount: invPrice, auto: inv.price == null },
    { key: 'mount', label: `Unterkonstruktion und Montage (${modules} × ${Math.round(cfg.costs.mount)} €)`, amount: modules * cfg.costs.mount },
    { key: 'electric', label: 'Elektroinstallation, Zählerschrank, Anmeldung', amount: cfg.costs.electric },
    { key: 'scaffold', label: 'Gerüst', amount: cfg.costs.scaffold },
    { key: 'other', label: 'Planung und Sonstiges', amount: cfg.costs.other },
  ];
  if (battery > 0) items.push({ key: 'battery', label: `Batteriespeicher (${String(battery).replace('.', ',')} kWh × ${Math.round(cfg.battery.price)} €)`, amount: battery * cfg.battery.price });
  const total = items.reduce((s, x) => s + x.amount, 0);
  const pvOnly = total - (items.find((x) => x.key === 'battery')?.amount || 0);
  return { items, total, pvOnly, battery: total - pvOnly, inverter: invPrice, invAuto, perKwp: kwp ? pvOnly / kwp : 0 };
}
