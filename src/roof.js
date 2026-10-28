// Roof geometry from rectangular roof sections, in plan coordinates plus height: [x, y, z].
// Shared by the 3D scene, the PV estimate and the building metrics.

const D2R = Math.PI / 180;

export const ROOF_TYPES = [
  { key: 'gable', name: 'Satteldach' },
  { key: 'hip', name: 'Walmdach' },
  { key: 'shed', name: 'Pultdach' },
  { key: 'flat', name: 'Flachdach' },
];

const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const v3len = (a) => Math.hypot(a[0], a[1], a[2]);

function polyNormal3(pts) {
  // Newell's method
  let nx = 0,
    ny = 0,
    nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

function area3(pts) {
  let s = [0, 0, 0];
  for (let i = 1; i < pts.length - 1; i++) {
    const c = v3cross(v3sub(pts[i], pts[0]), v3sub(pts[i + 1], pts[0]));
    s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]];
  }
  return v3len(s) / 2;
}

// Compass bearing (deg, 0 = north, 90 = east) of a plan direction, given the plan's north rotation.
export function bearing(dx, dy, northAngle = 0) {
  const b = (Math.atan2(dx, -dy) * 180) / Math.PI + northAngle;
  return ((b % 360) + 360) % 360;
}

export function bearingName(b) {
  const names = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(b / 45) % 8];
}

function makeSlope(pts, northAngle, label) {
  let n = polyNormal3(pts);
  if (n[2] < 0) {
    pts = pts.slice().reverse();
    n = n.map((c) => -c);
  }
  const tilt = (Math.acos(Math.min(1, n[2])) * 180) / Math.PI;
  const horiz = Math.hypot(n[0], n[1]);
  const az = horiz > 1e-6 ? bearing(n[0], n[1], northAngle) : null;
  return { pts, normal: n, tilt, azimuth: az, area: area3(pts), label };
}

// Returns {slopes, gables, ridgeZ, eaveZ, base} for one section. base = eave line height on the wall.
export function sectionGeometry(sec, base, northAngle = 0) {
  const type = sec.type || 'gable';
  const o = sec.overhang ?? 0.5;
  const pitch = type === 'flat' ? 0 : Math.max(3, Math.min(70, sec.pitch ?? 38));
  const t = Math.tan(pitch * D2R);
  let { x, y, w, d } = sec;
  let ridge = sec.ridge || (w >= d ? 'x' : 'y');
  const slopes = [],
    gables = [];
  // Work in a local frame where the ridge runs along u (= x) and the span is v (= y); map back afterwards.
  const swap = ridge === 'y';
  const U0 = swap ? y : x,
    V0 = swap ? x : y,
    LU = swap ? d : w,
    LV = swap ? w : d;
  const P = (u, v, z) => (swap ? [v, u, z] : [u, v, z]);
  // separate overhang at the two ridge ends (e.g. 0 at a shared party wall)
  const oS = sec.oStart ?? o,
    oE = sec.oEnd ?? o;

  if (type === 'flat') {
    const z = base + 0.12;
    const pts = [P(U0 - oS, V0 - o, z), P(U0 + LU + oE, V0 - o, z), P(U0 + LU + oE, V0 + LV + o, z), P(U0 - oS, V0 + LV + o, z)];
    slopes.push(makeSlope(pts, northAngle, 'Dachfläche'));
    return { slopes, gables, ridgeZ: z, eaveZ: z, base, pitch: 0, type };
  }

  if (type === 'shed') {
    const flip = !!sec.flip;
    // high side at v = V0 (unless flipped)
    const zHigh = base + LV * t;
    const zAt = (v) => (flip ? base + (v - V0) * t : zHigh - (v - V0) * t);
    const v0 = V0 - o,
      v1 = V0 + LV + o;
    slopes.push(makeSlope([P(U0 - oS, v0, zAt(v0)), P(U0 + LU + oE, v0, zAt(v0)), P(U0 + LU + oE, v1, zAt(v1)), P(U0 - oS, v1, zAt(v1))], northAngle, 'Pultfläche'));
    const vh = flip ? V0 + LV : V0;
    gables.push([P(U0, vh, base), P(U0 + LU, vh, base), P(U0 + LU, vh, zHigh), P(U0, vh, zHigh)]);
    for (const u of [U0, U0 + LU]) gables.push([P(u, V0, base), P(u, V0 + LV, base), P(u, vh, zHigh)]);
    return { slopes, gables, ridgeZ: zHigh, eaveZ: base - o * t, base, pitch, type };
  }

  const half = LV / 2;
  const zR = base + half * t;
  const zE = base - o * t;
  const vm = V0 + half;
  const ua = U0 - oS,
    ub = U0 + LU + oE,
    va = V0 - o,
    vb = V0 + LV + o;

  if (type === 'hip') {
    const r0 = Math.min(U0 + half, U0 + LU / 2),
      r1 = Math.max(U0 + LU - half, U0 + LU / 2);
    slopes.push(makeSlope([P(ua, va, zE), P(ub, va, zE), P(r1, vm, zR), P(r0, vm, zR)], northAngle, 'Hauptfläche'));
    slopes.push(makeSlope([P(ub, vb, zE), P(ua, vb, zE), P(r0, vm, zR), P(r1, vm, zR)], northAngle, 'Hauptfläche'));
    slopes.push(makeSlope([P(ua, vb, zE), P(ua, va, zE), P(r0, vm, zR)], northAngle, 'Walmfläche'));
    slopes.push(makeSlope([P(ub, va, zE), P(ub, vb, zE), P(r1, vm, zR)], northAngle, 'Walmfläche'));
    return { slopes, gables, ridgeZ: zR, eaveZ: zE, base, pitch, type };
  }

  // gable
  slopes.push(makeSlope([P(ua, va, zE), P(ub, va, zE), P(ub, vm, zR), P(ua, vm, zR)], northAngle, 'Dachfläche'));
  slopes.push(makeSlope([P(ub, vb, zE), P(ua, vb, zE), P(ua, vm, zR), P(ub, vm, zR)], northAngle, 'Dachfläche'));
  for (const u of [U0, U0 + LU]) gables.push([P(u, V0, base), P(u, V0 + LV, base), P(u, vm, zR)]);
  return { slopes, gables, ridgeZ: zR, eaveZ: zE, base, pitch, type };
}

// Planes (in plan+height coordinates) bounding the space under a section's roof: n·p <= c is inside.
export function sectionClipPlanes(geo) {
  return geo.slopes
    .filter((s) => s.tilt > 0.5)
    .map((s) => {
      const n = s.normal;
      const p = s.pts[0];
      return { n, c: n[0] * p[0] + n[1] * p[1] + n[2] * p[2] };
    });
}

// Estimated yield factor (1.0 = south, ~35°) for German latitudes.
export function yieldFactor(azimuth, tilt) {
  if (azimuth == null || tilt < 3) return 0.87;
  const dAz = Math.abs(((azimuth - 180 + 540) % 360) - 180); // 0 = south, 180 = north
  const tiltF = 1 - Math.abs(tilt - 35) / 220;
  const azLoss = (dAz / 180) ** 1.6 * (0.18 + tilt / 120);
  return Math.max(0.35, Math.min(1, tiltF - azLoss));
}

const PANEL = { w: 1.134, h: 1.722, wp: 430 };

// Lays out PV modules on one slope (portrait), keeping a margin to all edges.
export function pvLayout(slope, margin = 0.45) {
  const pts = slope.pts;
  if (pts.length < 3) return { panels: [], kwp: 0, count: 0 };
  // slope-local axes: e1 horizontal along eave, e2 up the slope
  const n = slope.normal;
  let e1 = Math.hypot(n[0], n[1]) < 1e-6 ? [1, 0, 0] : [-n[1], n[0], 0];
  const l1 = v3len(e1);
  e1 = e1.map((c) => c / l1);
  const e2 = v3cross(n, e1);
  const o = pts[0];
  const to2 = (p) => {
    const d = v3sub(p, o);
    return [d[0] * e1[0] + d[1] * e1[1] + d[2] * e1[2], d[0] * e2[0] + d[1] * e2[1] + d[2] * e2[2]];
  };
  const poly = pts.map(to2);
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (const [u, v] of poly) {
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const inside = (q) => {
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i],
        [xj, yj] = poly[j];
      if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  };
  const edgeDist = (q) => {
    let d = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length];
      const ab = [b[0] - a[0], b[1] - a[1]];
      const l2 = ab[0] * ab[0] + ab[1] * ab[1];
      let tt = l2 ? ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / l2 : 0;
      tt = Math.max(0, Math.min(1, tt));
      d = Math.min(d, Math.hypot(q[0] - a[0] - ab[0] * tt, q[1] - a[1] - ab[1] * tt));
    }
    return d;
  };
  const ok = (q) => inside(q) && edgeDist(q) >= margin - 1e-6;
  const gap = 0.02;
  const cols = Math.floor((maxU - minU - 2 * margin + gap) / (PANEL.w + gap));
  const rows = Math.floor((maxV - minV - 2 * margin + gap) / (PANEL.h + gap));
  const panels = [];
  if (cols > 0 && rows > 0) {
    const usedW = cols * (PANEL.w + gap) - gap;
    const u0 = minU + (maxU - minU - usedW) / 2;
    const v0 = minV + margin;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const a = [u0 + c * (PANEL.w + gap), v0 + r * (PANEL.h + gap)];
        const corners = [a, [a[0] + PANEL.w, a[1]], [a[0] + PANEL.w, a[1] + PANEL.h], [a[0], a[1] + PANEL.h]];
        if (!corners.every(ok)) continue;
        const lift = 0.34; // above the roof skin (0.26 m)
        panels.push(corners.map(([u, v]) => [o[0] + e1[0] * u + e2[0] * v + n[0] * lift, o[1] + e1[1] * u + e2[1] * v + n[1] * lift, o[2] + e1[2] * u + e2[2] * v + n[2] * lift]));
      }
  }
  return { panels, count: panels.length, kwp: (panels.length * PANEL.wp) / 1000 };
}

// Eave height for sections without an explicit base: top of the highest floor, or knee wall for attic floors.
export function autoRoofBase(floors) {
  if (!floors || !floors.length) return 3;
  const top = floors.reduce((a, f) => (f.elevation > a.elevation ? f : a), floors[0]);
  if (top.underRoof) return top.elevation + (top.kneeWall ?? 1.0);
  return top.elevation + top.height;
}

export function roofModel(house, floors) {
  const sections = house?.model?.roofSections || [];
  const north = house?.northAngle || 0;
  const autoBase = autoRoofBase(floors);
  return sections.map((sec) => {
    const base = sec.base ?? autoBase;
    const geo = sectionGeometry(sec, base, north);
    return { sec, base, geo };
  });
}

// PV potential for every slope: kWp, yield and estimated annual output.
export function pvPotential(house, floors) {
  const out = [];
  for (const { sec, geo } of roofModel(house, floors)) {
    geo.slopes.forEach((s, i) => {
      const lay = pvLayout(s);
      const f = yieldFactor(s.azimuth, s.tilt);
      out.push({
        key: sec.id + ':' + i,
        sectionId: sec.id,
        index: i,
        label: s.label,
        area: s.area,
        tilt: s.tilt,
        azimuth: s.azimuth,
        factor: f,
        modules: lay.count,
        kwp: lay.kwp,
        kwhYear: lay.kwp * 950 * f,
        slope: s,
        layout: lay,
      });
    });
  }
  return out;
}
