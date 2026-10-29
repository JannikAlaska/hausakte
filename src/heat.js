// Heat load and heat pump check from the 3D model (simplified method after DIN EN 12831 / DIN V 4108-6).
// Areas come from the floor plans and roof; U-values are defaults derived from the building data and can be
// overridden per surface group in house.heat.u. All results are estimates for orientation, not a design.

import { outerOutline, polyArea, pointInPoly, norm, sub, perp } from './geometry.js';
import { roofModel, bearing, bearingName } from './roof.js';
import { sortFloors, roomArea, consumptionByYear } from './metrics.js';
import { roomType } from './catalog.js';

export const HEAT_DEFAULTS = {
  tIn: 20,
  tOut: -14, // Norm-Außentemperatur, nördlicher Harzrand (DIN/TS 12831-1, Ort prüfen)
  ach: 0.6, // Luftwechsel 1/h, unsanierter Altbau
  degreeDays: 3800, // Gradtagzahl G20/15 (Kd/a), Harzvorland
  emitter: 'radiator_old',
  priceOil: 1.05, // €/l
  priceHp: 0.28, // €/kWh Wärmepumpentarif
  oilEff: 0.85,
};

export const EMITTERS = [
  { key: 'floor', name: 'Fußbodenheizung', flow: 35, jaz: 4.0 },
  { key: 'radiator_new', name: 'Große oder neue Heizkörper', flow: 45, jaz: 3.5 },
  { key: 'radiator_mixed', name: 'Heizkörper teilweise getauscht', flow: 50, jaz: 3.2 },
  { key: 'radiator_old', name: 'Alte Heizkörper', flow: 55, jaz: 2.9 },
];

export const ADJ = [
  { key: 'aussen', name: 'Außenluft', b: 1 },
  { key: 'nachbar', name: 'Beheiztes Nachbarhaus', b: 0.15 },
  { key: 'unbeheizt', name: 'Unbeheizter Raum / Anbau', b: 0.5 },
  { key: 'erdreich', name: 'Erdreich', b: 0.45 },
];
const adjOf = (k) => ADJ.find((a) => a.key === k) || ADJ[0];

const HP_SIZES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 25, 30];
const CO2 = { oil: 0.31, power: 0.36 }; // kg CO2 per kWh final energy (Heizöl nach GEG, Strommix 2025)
const WW_PER_PERSON = 750; // kWh useful heat per person and year

// ---------- default U-values from the building data ----------
function yearOf(c) {
  return Number(c?.year) || null;
}
function compsOf(components, gewerk, re) {
  return Object.values(components || {}).filter((c) => c.gewerk === gewerk && (!re || re.test(`${c.name} ${c.material} ${c.notes}`)));
}
export function defaultU(house, components) {
  const built = Number(house?.buildYear) || 1960;
  const fachwerk = /fachwerk/i.test(house?.construction || '');
  const wall = fachwerk ? 1.5 : built < 1949 ? 1.4 : built < 1969 ? 1.2 : built < 1979 ? 1.0 : built < 1995 ? 0.8 : built < 2002 ? 0.5 : 0.3;
  const wins = compsOf(components, 'fenster', /fenster/i);
  const winU = (() => {
    const withU = wins.filter((c) => Number(c.uValue) > 0);
    if (withU.length) return withU.reduce((s, c) => s + Number(c.uValue), 0) / withU.length;
    const ys = wins.map(yearOf).filter(Boolean);
    const y = ys.length ? Math.min(...ys) : built;
    return y < 1978 ? 3.0 : y < 1995 ? 2.7 : y < 2002 ? 1.8 : y < 2016 ? 1.4 : 1.1;
  })();
  const roofIns = compsOf(components, 'dach', /dämm/i);
  const roofU = (() => {
    const c = roofIns.find((x) => Number(x.uValue) > 0);
    if (c) return Number(c.uValue);
    const y = Math.max(0, ...roofIns.map(yearOf).filter(Boolean));
    return !y ? 1.0 : y >= 2014 ? 0.2 : y >= 2002 ? 0.25 : y >= 1995 ? 0.3 : 0.45;
  })();
  const kd = compsOf(components, 'keller', /kellerdecke/i)[0];
  const basementU = Number(kd?.uValue) > 0 ? Number(kd.uValue) : /ungedämmt|kappendecke/i.test(`${kd?.material} ${kd?.notes}`) ? 1.2 : built < 1979 ? 1.0 : 0.6;
  return { wall, window: Math.round(winU * 100) / 100, roof: roofU, ceiling: built < 1979 ? 0.9 : 0.4, basement: basementU, ground: built < 1979 ? 1.0 : 0.5 };
}

// ---------- surfaces from the model ----------
const heatedRoom = (r) => roomType(r.type).living && r.type !== 'balkon';
export function isHeatedFloor(f, house) {
  const over = house?.heat?.heatedFloors?.[f.id];
  if (over != null) return !!over;
  if ((f.elevation ?? 0) <= -1) return false;
  return (f.rooms || []).some(heatedRoom);
}

// neighbour buildings next to a wall make it a party wall
function autoAdjacency(test, house) {
  for (const b of house?.model?.context || []) {
    if (test[0] >= b.x && test[0] <= b.x + b.w && test[1] >= b.y && test[1] <= b.y + b.d) return b.kind === 'neighbor' ? 'nachbar' : 'unbeheizt';
  }
  return 'aussen';
}

export function heatSurfaces(house, floors, components) {
  const fl = sortFloors(floors || []);
  const heated = fl.filter((f) => isHeatedFloor(f, house));
  const U = { ...defaultU(house, components), ...(house?.heat?.u || {}) };
  const north = house?.northAngle || 0;
  const roofs = roofModel(house, fl);
  const groups = new Map();
  const add = (key, label, area, u, b, extra = {}) => {
    if (!(area > 0.05)) return;
    const g = groups.get(key) || { key, label, area: 0, u, b, ...extra };
    g.area += area;
    groups.set(key, g);
  };
  let netArea = 0,
    volume = 0;
  for (const f of heated) {
    const outline = outerOutline(f.walls || []);
    const area = (f.rooms || []).filter(heatedRoom).reduce((s, r) => s + roomArea(r), 0);
    netArea += area;
    volume += area * Math.max(2.2, f.height - (f.slab ?? 0.2));
    const ridgeAbove = roofs.length ? Math.max(...roofs.map((r) => r.geo.ridgeZ)) - f.elevation : f.height;
    const ridgeAlong = roofs[0]?.sec?.ridge || 'x';
    for (const w of f.walls || []) {
      if (!w.ext) continue;
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      if (L < 0.05) continue;
      const dir = norm(sub(w.b, w.a));
      const n = perp(dir);
      const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
      const probe = [mid[0] + n[0] * (w.t / 2 + 0.05), mid[1] + n[1] * (w.t / 2 + 0.05)];
      const out = outline && pointInPoly(probe, outline) ? [-n[0], -n[1]] : n;
      const test = [mid[0] + out[0] * (w.t / 2 + 0.3), mid[1] + out[1] * (w.t / 2 + 0.3)];
      const adj = w.adj || autoAdjacency(test, house);
      let h = w.h ?? f.height;
      if (f.underRoof) {
        const knee = f.kneeWall ?? 1;
        const gable = ridgeAlong === 'y' ? Math.abs(dir[0]) > 0.7 : Math.abs(dir[1]) > 0.7;
        h = gable ? knee + Math.max(0, ridgeAbove - knee) / 2 : knee;
      }
      const openings = (w.openings || []).filter((o) => o.type !== 'opening').reduce((s, o) => s + o.w * Math.min(o.h, h), 0);
      if (adj === 'aussen') {
        const b = bearingName(bearing(out[0], out[1], north));
        add('wall:' + b, `Außenwand ${b}`, L * h - openings, U['wall:' + b] ?? U.wall, 1, { kind: 'wall', dir: b });
        add('window', 'Fenster und Außentüren', openings, U.window, 1, { kind: 'window' });
      } else {
        const a = adjOf(adj);
        add('adj:' + adj, `Wand zu: ${a.name}`, L * h, U['adj:' + adj] ?? U.wall, a.b, { kind: 'adj' });
      }
    }
  }
  if (heated.length) {
    const top = heated[heated.length - 1];
    const bottom = heated[0];
    const above = fl[fl.indexOf(top) + 1];
    const below = fl[fl.indexOf(bottom) - 1];
    const topArea = Math.abs(polyArea(outerOutline(top.walls || []) || []));
    const botArea = Math.abs(polyArea(outerOutline(bottom.walls || []) || []));
    if (top.underRoof || (!above && roofs.length && !roofs.every((r) => r.sec.type === 'flat'))) {
      const roofArea = roofs.reduce((s, r) => s + r.geo.slopes.reduce((a, sl) => a + sl.area, 0), 0);
      add('roof', 'Dachflächen', roofArea, U.roof, 1, { kind: 'roof' });
    } else if (above) {
      // unheated attic under the roof: the ceiling is the boundary, the attic buffers it
      add('ceiling', `Decke zum ${above.name || 'Dachboden'} (unbeheizt)`, topArea, U.ceiling, U.roof < 0.5 ? 0.7 : 0.9, { kind: 'ceiling' });
    } else {
      add('roof', 'Flachdach', topArea, U.roof, 1, { kind: 'roof' });
    }
    if (below) add('basement', `Decke zum ${below.name || 'Keller'} (unbeheizt)`, botArea, U.basement, 0.5, { kind: 'basement' });
    else add('ground', 'Bodenplatte', botArea, U.ground, 0.45, { kind: 'ground' });
  }
  return { surfaces: [...groups.values()], netArea, volume, heated, U };
}

// ---------- results ----------
export function heatResult(house, floors, components, readings, override = {}) {
  const saved = Object.fromEntries(Object.entries(house?.heat || {}).filter(([, v]) => v != null));
  const cfg = { ...HEAT_DEFAULTS, ...saved, ...override };
  const base = heatSurfaces(house, floors, components);
  const uOver = override.u || {};
  const surfaces = base.surfaces.map((s) => {
    const u = uOver[s.key] ?? s.u;
    return { ...s, u, H: s.area * u * s.b };
  });
  const dT = cfg.tIn - cfg.tOut;
  const bridges = 0.1 * surfaces.filter((s) => s.b > 0).reduce((a, s) => a + s.area * s.b, 0);
  const HT = surfaces.reduce((a, s) => a + s.H, 0) + bridges;
  const HV = 0.34 * cfg.ach * base.volume;
  const loadW = (HT + HV) * dT;
  const persons = Number(house?.persons) || 2;
  const wwKwh = persons * WW_PER_PERSON * 1.2;
  // gains and partial heating reduce the demand of old houses compared to the steady-state loss
  const heatKwh = ((HT + HV) * cfg.degreeDays * 24) / 1000 * 0.85;
  const hpNeed = loadW / 1000 + 0.25 * persons;
  const hpSize = HP_SIZES.find((s) => s >= hpNeed - 0.2) || Math.ceil(hpNeed);
  const em = EMITTERS.find((e) => e.key === cfg.emitter) || EMITTERS[3];
  const oilLiters = (heatKwh + wwKwh) / cfg.oilEff / 10;
  const hpKwh = heatKwh / em.jaz + wwKwh / 2.6;
  // actual consumption, if oil readings exist
  let actual = null;
  const years = consumptionByYear(Object.values(readings || {}));
  const lastOil = Object.keys(years)
    .sort()
    .reverse()
    .find((y) => years[y].oel?.amount > 0);
  if (lastOil) {
    const liters = years[lastOil].oel.amount;
    const useful = liters * 10 * cfg.oilEff;
    actual = { year: lastOil, liters, useful, loadKw: Math.max(0, useful - wwKwh) / 2000 };
  }
  return {
    cfg,
    surfaces: surfaces.sort((a, b) => b.H - a.H),
    bridges,
    HT,
    HV,
    dT,
    loadKw: loadW / 1000,
    perM2: base.netArea ? loadW / base.netArea : 0,
    netArea: base.netArea,
    volume: base.volume,
    heated: base.heated,
    heatKwh,
    wwKwh,
    persons,
    hpSize,
    emitter: em,
    oil: { liters: oilLiters, cost: oilLiters * cfg.priceOil, co2: ((heatKwh + wwKwh) / cfg.oilEff) * CO2.oil / 1000 },
    hp: { kwh: hpKwh, cost: hpKwh * cfg.priceHp, co2: (hpKwh * CO2.power) / 1000 },
    actual,
    U: base.U,
  };
}

// What-if measures that fit this house; each sets new U-values (and optionally air change).
export function heatMeasures(res) {
  const out = [];
  const has = (k) => res.surfaces.find((s) => s.key === k);
  const kd = has('basement');
  if (kd && kd.u > 0.4) out.push({ key: 'kellerdecke', label: 'Kellerdecke von unten dämmen (ca. 12 cm)', u: { basement: 0.25 }, cost: kd.area * 60, area: kd.area });
  const ogd = has('ceiling');
  if (ogd && ogd.u > 0.3) out.push({ key: 'ogd', label: 'Oberste Geschossdecke dämmen (ca. 20 cm)', u: { ceiling: 0.18 }, cost: ogd.area * 45, area: ogd.area });
  const roof = has('roof');
  if (roof && roof.u > 0.35) out.push({ key: 'dach', label: 'Dach dämmen', u: { roof: 0.2 }, cost: roof.area * 220, area: roof.area });
  const win = has('window');
  if (win && win.u > 1.2) out.push({ key: 'fenster', label: 'Fenster tauschen (3-fach, Uw 0,95)', u: { window: 0.95 }, ach: -0.1, cost: win.area * 850, area: win.area });
  for (const s of res.surfaces.filter((x) => x.kind === 'wall' && x.u > 0.6))
    out.push({ key: s.key, label: `${s.label} dämmen (U 0,28)`, u: { [s.key]: 0.28 }, cost: s.area * 200, area: s.area });
  return out;
}

export function applyMeasures(house, floors, components, readings, keys) {
  const base = heatResult(house, floors, components, readings);
  const ms = heatMeasures(base).filter((m) => keys.includes(m.key));
  if (!ms.length) return { base, after: base, measures: ms };
  const u = Object.assign({}, ...ms.map((m) => m.u));
  const ach = Math.max(0.3, base.cfg.ach + ms.reduce((a, m) => a + (m.ach || 0), 0));
  const after = heatResult(house, floors, components, readings, { u, ach });
  return { base, after, measures: ms };
}
