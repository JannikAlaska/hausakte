// Electrical plan (Elektroplan) of one or more storeys as a vector PDF, like an electrician's installation plan:
// walls, doors, windows, room names and (optionally) furniture for orientation; every lamp, switch, socket and
// connection as its symbol (lamps red, switches green, sockets/connections blue) with the number of gangs and
// the height above the floor; a legend, a summary per room and optionally a list of all connections.
import { add, mul, sub, norm, perp, dist, labelPoint, bbox, pointInPoly, segIntersect } from './geometry.js';
import { fixtureKind, comboParts } from './catalog.js';
import { roomArea, sortFloors } from './metrics.js';
import { statusShown } from './focus.js';
import { furnCorners } from './furniture.js';
import { linePlanPts, roomOfPoint } from './planops.js';
import { buildDrawingPdf, textWidth, PAPER } from './pdf.js';
import { fmtFixed, fmtDate, todayISO } from './util.js';

export const ELEC = { lamp: '#d32f2f', switch: '#2e8b3a', socket: '#1f6fd1', net: '#7b4fc9', water: '#1f6fd1', gas: '#9a6a22', off: '#9aa0a8' };
const INK = '#2b2f38';
const MUTED = '#6b7180';
const PT_PER_M = 2834.6457; // 1 m at 1:1 in points
const SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500];
const FILTER_NAMES = { alle: 'Bestand + geplant', bestand: 'Nur Bestand', geplant: 'Nur geplant' };

// gangs per fixture: what the summary counts
export function gangs(q) {
  const k = fixtureKind(q.kind);
  if (k.combo) {
    const c = comboParts(q);
    return { switches: c.switches, sockets: c.sockets };
  }
  const n = Math.max(1, q.count || 1);
  if (q.kind === 'steckdose') return { sockets: n };
  if (q.kind === 'schalter') return { switches: n };
  if (q.kind === 'lampe') return { lamps: 1 };
  if (q.kind === 'netzwerk') return { net: n };
  if (q.kind === 'wasser') return { water: 1 };
  if (q.kind === 'gas') return { gas: 1 };
  return {};
}

const fmtH = (z) => `${fmtFixed(z ?? 0, 2)} m`;
// the short text at a symbol: number of gangs and height ("3× · 0,30 m", "1+2 · 1,05 m")
function shortLabel(q) {
  const k = fixtureKind(q.kind);
  const parts = [];
  if (k.combo) {
    const c = comboParts(q);
    parts.push(`${c.switches}+${c.sockets}`);
  } else if ((q.count || 1) > 1) parts.push(`${q.count}×`);
  if (q.kind === 'netzwerk') parts.unshift('LAN');
  // ceiling lamps hang from the ceiling, no height needed
  if (!(q.kind === 'lampe' && q.rot == null)) parts.push(fmtH(q.z));
  return parts.join(' · ');
}

export function floorsWithFixtures(data) {
  return sortFloors(Object.values(data.floors || {})).filter((f) => (f.points || []).length);
}

// ---------- one storey ----------
function drawFloor(g, floor, data, opts) {
  const { W, H } = g;
  const M = 26;
  const legendW = opts.paper === 'A3' ? 250 : 196;
  const headH = 40;
  const area = { x: M, y: M + headH, w: W - 2 * M - legendW - 14, h: H - 2 * M - headH - 30 };
  const points = (floor.points || []).filter((q) => statusShown(opts.filter, q.status || 'bestand'));
  const walls = floor.walls || [];

  // extent of the storey: walls, rooms and connections
  const pts = [];
  for (const w of walls) pts.push(w.a, w.b);
  for (const r of floor.rooms || []) pts.push(...(r.poly || []));
  for (const q of points) pts.push([q.x, q.y]);
  const bb = pts.length ? bbox(pts) : { minX: 0, minY: 0, maxX: 10, maxY: 8, w: 10, h: 8 };
  const pad = 0.6;
  const mw = (bb.maxX - bb.minX) + 2 * pad,
    mh = (bb.maxY - bb.minY) + 2 * pad;
  const denom = SCALES.find((d) => (mw * PT_PER_M) / d <= area.w && (mh * PT_PER_M) / d <= area.h) || SCALES[SCALES.length - 1];
  const k = PT_PER_M / denom;
  const ox = area.x + (area.w - mw * k) / 2 - (bb.minX - pad) * k;
  const oy = area.y + (area.h - mh * k) / 2 - (bb.minY - pad) * k;
  const P = (p) => [ox + p[0] * k, oy + p[1] * k];
  const sym = opts.paper === 'A3' ? 1.2 : 1;

  // header
  const house = data.house || {};
  g.text(M, M + 14, `Elektroplan · ${floor.name || 'Etage'}${floor.short ? ` (${floor.short})` : ''}`, { size: 15, bold: true, color: INK });
  g.text(M, M + 28, [house.name || house.street, [house.zip, house.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Hausakte', { size: 8.5, color: MUTED });
  g.text(W - M, M + 14, `Maßstab 1:${denom} (${opts.paper} quer)`, { size: 9, bold: true, color: INK, anchor: 'end' });
  g.text(W - M, M + 28, `Stand ${fmtDate(todayISO())} · ${FILTER_NAMES[opts.filter] || FILTER_NAMES.alle}`, { size: 8.5, color: MUTED, anchor: 'end' });
  g.line(M, M + headH - 6, W - M, M + headH - 6, { stroke: '#c9ccd3', w: 0.6 });

  g.clip(area.x, area.y, area.w, area.h);
  // rooms (white floor), furniture, stairs
  for (const r of floor.rooms || []) if (r.poly?.length > 2) g.path(r.poly.map(P), { close: true, fill: '#ffffff' });
  if (opts.furniture)
    for (const f of floor.furniture || []) {
      if (f.hidden) continue;
      g.path(furnCorners(f).map(P), { close: true, stroke: '#b9bcc4', w: 0.45, fill: '#f6f6f7' });
    }
  for (const it of floor.items || []) {
    if (it.type !== 'stairs') continue;
    const ns = it.dir === 'e' || it.dir === 'w';
    const L = ns ? it.l : it.w,
      D = ns ? it.w : it.l;
    g.path([P([it.x, it.y]), P([it.x + L, it.y]), P([it.x + L, it.y + D]), P([it.x, it.y + D])], { close: true, stroke: '#9aa0aa', w: 0.5 });
    const steps = Math.max(3, Math.round((floor.height || 2.6) / 0.18));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (ns) g.line(...P([it.x + it.l * t, it.y]), ...P([it.x + it.l * t, it.y + it.w]), { stroke: '#c3c6cd', w: 0.35 });
      else g.line(...P([it.x, it.y + it.l * t]), ...P([it.x + it.w, it.y + it.l * t]), { stroke: '#c3c6cd', w: 0.35 });
    }
  }
  // power lines, if wanted
  if (opts.lines)
    for (const l of floor.lines || []) {
      if (l.kind !== 'strom' || !statusShown(opts.filter, l.status || 'bestand')) continue;
      const lp = linePlanPts(l);
      if (lp.length > 1) g.path(lp.map(P), { stroke: '#e0a800', w: 0.7, dash: l.status === 'geplant' ? [3, 2] : null });
    }
  // walls with their openings (the solid pieces are kept: labels avoid them)
  const wallPolys = [];
  for (const w of walls) {
    const L = dist(w.a, w.b);
    if (L < 0.01) continue;
    const u = norm(sub(w.b, w.a)),
      n = perp(u);
    const e = w.ext ? w.t / 2 : 0,
      h = w.t / 2;
    const ops = [...(w.openings || [])].sort((a, b) => a.pos - b.pos);
    let cur = -e;
    const segs = [];
    for (const o of ops) {
      const o0 = Math.max(0, o.pos - o.w / 2),
        o1 = Math.min(L, o.pos + o.w / 2);
      if (o0 > cur) segs.push([cur, o0]);
      cur = Math.max(cur, o1);
    }
    if (L + e > cur) segs.push([cur, L + e]);
    for (const [s0, s1] of segs) {
      const p0 = add(w.a, mul(u, s0)),
        p1 = add(w.a, mul(u, s1));
      const poly = [add(p0, mul(n, h)), add(p1, mul(n, h)), add(p1, mul(n, -h)), add(p0, mul(n, -h))].map(P);
      wallPolys.push(poly);
      g.path(poly, { close: true, fill: w.ext ? '#3a3f4b' : '#5b616e' });
    }
    for (const o of ops) {
      const c = add(w.a, mul(u, o.pos));
      const a0 = add(c, mul(u, -o.w / 2)),
        a1 = add(c, mul(u, o.w / 2));
      const rect = [add(a0, mul(n, h)), add(a1, mul(n, h)), add(a1, mul(n, -h)), add(a0, mul(n, -h))].map(P);
      if (o.type === 'window') {
        g.path(rect, { close: true, fill: '#ffffff', stroke: '#3a3f4b', w: 0.5 });
        g.line(...P(a0), ...P(a1), { stroke: '#3a3f4b', w: 0.4 });
      } else if (o.type === 'door') {
        const side = o.flip ? -1 : 1;
        const hinge = o.hinge === 'b' ? a1 : a0;
        const other = o.hinge === 'b' ? a0 : a1;
        const leaf = add(hinge, mul(n, side * o.w));
        g.line(...P(hinge), ...P(leaf), { stroke: '#555b67', w: 0.6 });
        const hp = P(hinge);
        const aLeaf = Math.atan2(P(leaf)[1] - hp[1], P(leaf)[0] - hp[0]);
        let aOther = Math.atan2(P(other)[1] - hp[1], P(other)[0] - hp[0]);
        // the quarter circle between leaf and the other jamb
        let d = aOther - aLeaf;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        g.arc(hp[0], hp[1], o.w * k, aLeaf, aLeaf + d, { stroke: '#8a909b', w: 0.4, dash: [2, 1.5] });
      }
    }
  }
  // room names
  for (const r of floor.rooms || []) {
    if (!r.poly?.length) continue;
    const lp = P(labelPoint(r.poly));
    g.text(lp[0], lp[1] - 2, r.name || '', { size: 8.5 * sym, bold: true, color: '#7a808c', anchor: 'middle' });
    g.text(lp[0], lp[1] + 8 * sym, `${fmtFixed(roomArea(r), 1)} m²`, { size: 6.5 * sym, color: '#9aa0aa', anchor: 'middle' });
  }

  // symbols, then their labels where there is room
  const boxes = [];
  for (const r of floor.rooms || []) {
    if (!r.poly?.length) continue;
    const lp = P(labelPoint(r.poly));
    const tw = Math.max(textWidth(r.name || '', 8.5 * sym, true), 30);
    boxes.push({ x: lp[0] - tw / 2, y: lp[1] - 11 * sym, w: tw, h: 22 * sym });
  }
  const labels = [];
  for (const q of points) {
    const kd = fixtureKind(q.kind);
    const W0 = P([q.x, q.y]);
    const a = ((q.rot ?? 90) * Math.PI) / 180;
    const nn = q.rot == null ? [0, -1] : [Math.cos(a), Math.sin(a)];
    const tt = perp(nn);
    const off = q.status === 'stillgelegt';
    const dash = q.status === 'geplant' ? [1.6, 1] : null;
    const col = (c) => (off ? ELEC.off : c);
    const ext = drawSymbol(g, q, W0, nn, tt, { col, dash, sym, kd });
    boxes.push(ext);
    labels.push({ q, W0, nn, tt, ext, text: shortLabel(q), color: off ? ELEC.off : '#3a3f4b' });
  }
  const fs = 5.8 * sym;
  for (const L of labels) {
    if (!L.text) continue;
    const tw = textWidth(L.text, fs);
    const cx = L.ext.x + L.ext.w / 2,
      cy = L.ext.y + L.ext.h / 2;
    const reach = Math.max(L.ext.w, L.ext.h) / 2 + 3;
    // beyond the symbol into the room, then to the sides along the wall, then further out; the spot that
    // covers the least (other labels and symbols, walls, the edge of the plan) wins
    const cands = [];
    for (const dd of [reach, reach + 7, reach + 14, reach + 22, reach + 31])
      for (const [sn, st] of [[1, 0], [0.7, 0.9], [0.7, -0.9], [0, 1.3], [0, -1.3]]) cands.push([cx + L.nn[0] * dd * sn + L.tt[0] * (tw / 2 + 4) * st, cy + L.nn[1] * dd * sn + L.tt[1] * (tw / 2 + 4) * st]);
    const boxAt = (c) => ({ x: c[0] - tw / 2 - 1, y: c[1] - fs * 0.75 - 1, w: tw + 2, h: fs + 2 });
    const overlap = (b) => boxes.reduce((sum, o) => sum + Math.max(0, Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x)) * Math.max(0, Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y)), 0);
    const inArea = (b) => b.x > area.x && b.y > area.y && b.x + b.w < area.x + area.w && b.y + b.h < area.y + area.h;
    const score = (c, i) => {
      const b = boxAt(c);
      return overlap(b) * 4 + (wallPolys.some((wp) => boxHitsPoly(b, wp)) ? 400 : 0) + (inArea(b) ? 0 : 5000) + i * 0.8;
    };
    let pick = cands[0],
      best = Infinity;
    cands.forEach((c, i) => {
      const sc = score(c, i);
      if (sc < best) (best = sc), (pick = c);
    });
    const b = boxAt(pick);
    // a label that had to move further away gets a thin line to its symbol
    if (Math.hypot(pick[0] - cx, pick[1] - cy) > reach + tw / 2 + 10) g.line(cx, cy, pick[0], pick[1], { stroke: '#b5b9c2', w: 0.35 });
    boxes.push(b);
    g.rect(b.x, b.y, b.w, b.h, { fill: '#ffffff' });
    g.text(pick[0], pick[1] + fs * 0.35, L.text, { size: fs, color: L.color, anchor: 'middle' });
  }
  g.unclip();
  g.rect(area.x, area.y, area.w, area.h, { stroke: '#d5d8de', w: 0.5 });

  // scale bar
  const sbY = area.y + area.h + 14;
  const meters = denom <= 50 ? 2 : denom <= 100 ? 5 : 10;
  const sx = area.x;
  for (let i = 0; i < meters; i++) {
    g.rect(sx + i * k, sbY - 3, k, 3, { fill: i % 2 ? '#ffffff' : INK, stroke: INK, w: 0.4 });
  }
  for (let i = 0; i <= meters; i += meters <= 5 ? 1 : 2) g.text(sx + i * k, sbY + 7, String(i), { size: 6, color: MUTED, anchor: 'middle' });
  g.text(sx + meters * k + 6, sbY + 1, 'm', { size: 6.5, color: MUTED });
  g.text(area.x + area.w, sbY + 1, 'Höhen: Mitte des Anschlusses über Fertigfußboden; Schalter + Steckdose: Mitte des obersten Schalters.', { size: 6.2, color: MUTED, anchor: 'end' });

  drawLegend(g, { x: W - M - legendW, y: area.y, w: legendW, h: area.h + 16 }, floor, points);
  g.text(M, H - 16, 'Erstellt mit der Hausakte · ersetzt keine Elektroplanung nach DIN 18015 durch einen Fachbetrieb.', { size: 6.5, color: '#9aa0aa' });
}

// does the label box touch the wall piece?
function boxHitsPoly(b, poly) {
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  if (corners.some((c) => pointInPoly(c, poly))) return true;
  if (poly.some((p) => p[0] > b.x && p[0] < b.x + b.w && p[1] > b.y && p[1] < b.y + b.h)) return true;
  for (let i = 0; i < 4; i++) for (let j = 0; j < poly.length; j++) if (segIntersect(corners[i], corners[(i + 1) % 4], poly[j], poly[(j + 1) % poly.length])) return true;
  return false;
}

// Symbols in the style of installation plans (DIN EN 60617): wall point W, n into the room, t along the wall.
// Returns the box the symbol covers.
function drawSymbol(g, q, W, n, t, { col, dash, sym, kd }) {
  const s = sym;
  const at = (base, dn, dt = 0) => [base[0] + n[0] * dn + t[0] * dt, base[1] + n[1] * dn + t[1] * dt];
  const pts = [W];
  const an = Math.atan2(n[1], n[0]);
  const socket = (base, color, lid = true) => {
    const B = at(base, 3.2 * s);
    const C = at(base, 6.6 * s);
    const r = 3.4 * s;
    g.line(...base, ...B, { stroke: color, w: 0.8, dash });
    g.arc(C[0], C[1], r, an + Math.PI / 2, an + (3 * Math.PI) / 2, { stroke: color, w: 0.8, dash });
    if (lid) g.line(...at(C, 0, -r * 1.25), ...at(C, 0, r * 1.25), { stroke: color, w: 0.8, dash });
    pts.push(at(C, 0, -r * 1.3), at(C, 0, r * 1.3), at(C, r));
  };
  const switchSym = (base, color, rockers = 1) => {
    const C = at(base, 5 * s);
    const r = 2.2 * s;
    g.line(...base, ...at(base, 5 * s - r), { stroke: color, w: 0.8, dash });
    g.circle(C[0], C[1], r, { stroke: color, w: 0.8, fill: '#ffffff' });
    // one lever per rocker, slanted into the room, with a short end tick
    for (let i = 0; i < Math.min(2, rockers); i++) {
      const sh = rockers > 1 ? (i ? 1.6 : -1.6) * s : 0;
      const d = norm([n[0] + t[0], n[1] + t[1]]);
      const p0 = [C[0] + d[0] * r + t[0] * sh, C[1] + d[1] * r + t[1] * sh];
      const p1 = [p0[0] + d[0] * 6 * s, p0[1] + d[1] * 6 * s];
      const tick = perp(d);
      g.line(...p0, ...p1, { stroke: color, w: 0.8, dash });
      g.line(...p1, p1[0] + tick[0] * 2.2 * s, p1[1] + tick[1] * 2.2 * s, { stroke: color, w: 0.8, dash });
      pts.push(p1);
    }
    pts.push(at(C, r), at(C, 0, -r), at(C, 0, r));
  };
  const lamp = (C, color) => {
    const r = 4.6 * s;
    g.circle(C[0], C[1], r, { stroke: color, w: 0.9, fill: '#ffffff' });
    const d = r * 0.7;
    g.line(C[0] - d, C[1] - d, C[0] + d, C[1] + d, { stroke: color, w: 0.9 });
    g.line(C[0] - d, C[1] + d, C[0] + d, C[1] - d, { stroke: color, w: 0.9 });
    pts.push([C[0] - r, C[1] - r], [C[0] + r, C[1] + r]);
  };
  const letter = (base, color, ch) => {
    const C = at(base, 6 * s);
    const r = 3.6 * s;
    g.line(...base, ...at(base, 6 * s - r), { stroke: color, w: 0.8, dash });
    g.circle(C[0], C[1], r, { stroke: color, w: 0.8, fill: '#ffffff' });
    g.text(C[0], C[1] + 2 * s, ch, { size: 5.5 * s, bold: true, color, anchor: 'middle' });
    pts.push([C[0] - r, C[1] - r], [C[0] + r, C[1] + r]);
  };
  if (kd.combo) {
    const c = comboParts(q);
    switchSym(at(W, 0, -4.6 * s), col(ELEC.switch), c.switches);
    socket(at(W, 0, 4.6 * s), col(ELEC.socket));
  } else if (q.kind === 'steckdose') socket(W, col(ELEC.socket));
  else if (q.kind === 'schalter') switchSym(W, col(ELEC.switch), q.count || 1);
  else if (q.kind === 'netzwerk') socket(W, col(ELEC.net), false);
  else if (q.kind === 'lampe') {
    if (q.rot == null) lamp(W, col(ELEC.lamp));
    else {
      g.line(...W, ...at(W, 2 * s), { stroke: col(ELEC.lamp), w: 0.8 });
      lamp(at(W, 6.6 * s), col(ELEC.lamp));
    }
  } else if (q.kind === 'wasser') letter(W, col(ELEC.water), 'W');
  else if (q.kind === 'gas') letter(W, col(ELEC.gas), 'G');
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs) - 1, y: Math.min(...ys) - 1, w: Math.max(...xs) - Math.min(...xs) + 2, h: Math.max(...ys) - Math.min(...ys) + 2 };
}

// legend and the number of gangs per room
function drawLegend(g, box, floor, points) {
  let y = box.y + 4;
  const x = box.x;
  g.text(x, y + 8, 'Legende', { size: 10, bold: true, color: INK });
  y += 16;
  const row = (label, draw) => {
    draw([x + 4, y + 9]);
    g.text(x + 34, y + 11, label, { size: 7.4, color: INK });
    y += 17;
  };
  // legend symbols stand on an imaginary wall at the left, facing right
  const n = [1, 0],
    t = [0, 1];
  const drawAt = (q, dx = 0) => (p) => drawSymbol(g, q, [p[0] + dx, p[1]], n, t, { col: (c) => c, dash: null, sym: 0.95, kd: fixtureKind(q.kind) });
  row('Leuchte (Decke/Wand)', drawAt({ kind: 'lampe' }, 8));
  row('Lichtschalter', drawAt({ kind: 'schalter', count: 1, rot: 0 }));
  row('Serienschalter (2 Wippen)', drawAt({ kind: 'schalter', count: 2, rot: 0 }));
  row('Steckdose · Zahl = Mehrfach', drawAt({ kind: 'steckdose', count: 1, rot: 0 }));
  row('Schalter + Steckdose (Kombi)', drawAt({ kind: 'kombi', switches: 1, sockets: 1, rot: 0 }));
  row('Netzwerkdose (LAN)', drawAt({ kind: 'netzwerk', count: 1, rot: 0 }));
  if (points.some((q) => q.kind === 'wasser' || q.kind === 'gas')) {
    row('Wasser- / Gasanschluss', drawAt({ kind: 'wasser', rot: 0 }));
  }
  g.text(x, y + 6, 'Beschriftung: Anzahl · Höhe über Fußboden', { size: 6.6, color: MUTED });
  g.text(x, y + 15, '„1+2“ = 1 Schalter + 2 Steckdosen untereinander', { size: 6.6, color: MUTED });
  g.text(x, y + 24, 'gestrichelt = geplant · grau = stillgelegt', { size: 6.6, color: MUTED });
  y += 36;

  // summary per room
  g.text(x, y + 8, 'Anzahl je Raum', { size: 10, bold: true, color: INK });
  y += 16;
  const cols = [
    { key: 'lamps', label: 'Leucht.', color: ELEC.lamp },
    { key: 'switches', label: 'Schalt.', color: ELEC.switch },
    { key: 'sockets', label: 'Steckd.', color: ELEC.socket },
    { key: 'net', label: 'LAN', color: ELEC.net },
  ];
  const rooms = new Map();
  for (const q of points) {
    const r = roomOfPoint(floor, q);
    const name = r?.name || 'ohne Raum';
    if (!rooms.has(name)) rooms.set(name, {});
    const acc = rooms.get(name);
    for (const [kk, v] of Object.entries(gangs(q))) acc[kk] = (acc[kk] || 0) + v;
  }
  const cw = 31;
  const nameW = box.w - cw * cols.length;
  cols.forEach((c, i) => g.text(x + nameW + cw * (i + 1) - 3, y + 7, c.label, { size: 6.4, bold: true, color: c.color, anchor: 'end' }));
  y += 10;
  g.line(x, y, x + box.w, y, { stroke: '#9aa0aa', w: 0.5 });
  const list = [...rooms.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'));
  for (const [name, acc] of list) {
    if (y > box.y + box.h - 26) {
      g.text(x, y + 9, `… ${list.length} Räume, siehe Anschlussliste`, { size: 6.5, color: MUTED });
      y += 12;
      break;
    }
    let nm = name;
    while (textWidth(nm, 7) > nameW - 4 && nm.length > 3) nm = nm.slice(0, -2) + '…';
    g.text(x, y + 9, nm, { size: 7, color: INK });
    cols.forEach((c, i) => {
      const v = acc[c.key] || 0;
      g.text(x + nameW + cw * (i + 1) - 3, y + 9, v ? String(v) : '–', { size: 7, color: v ? INK : '#b5b9c2', anchor: 'end' });
    });
    y += 12;
    g.line(x, y, x + box.w, y, { stroke: '#e3e5ea', w: 0.4 });
  }
  if (list.length) {
    // totals over all rooms, even when the list had to be cut
    const sum = {};
    for (const [, acc] of list) for (const c of cols) sum[c.key] = (sum[c.key] || 0) + (acc[c.key] || 0);
    g.line(x, y, x + box.w, y, { stroke: '#9aa0aa', w: 0.6 });
    g.text(x, y + 10, 'Summe', { size: 7.4, bold: true, color: INK });
    cols.forEach((c, i) => g.text(x + nameW + cw * (i + 1) - 3, y + 10, String(sum[c.key] || 0), { size: 7.4, bold: true, color: INK, anchor: 'end' }));
  } else g.text(x, y + 10, 'Noch keine Anschlüsse eingezeichnet.', { size: 7, color: MUTED });
}

// ---------- list of all connections ----------
const STATUS_NAMES = { bestand: 'Bestand', geplant: 'geplant', stillgelegt: 'stillgelegt' };
function listRows(floor, opts) {
  const rows = [];
  for (const q of (floor.points || []).filter((p) => statusShown(opts.filter, p.status || 'bestand'))) {
    const k = fixtureKind(q.kind);
    const r = roomOfPoint(floor, q);
    const c = k.combo ? comboParts(q) : null;
    rows.push({
      room: r?.name || 'ohne Raum',
      kind: k.combo ? 'Schalter + Steckdose' : k.name,
      count: c ? `${c.switches} Schalter, ${c.sockets} Steckdose${c.sockets === 1 ? '' : 'n'}` : (q.count || 1) > 1 ? `${q.count}-fach` : '1',
      height: q.kind === 'lampe' && q.rot == null ? 'Decke' : fmtH(q.z),
      label: q.label || '',
      status: STATUS_NAMES[q.status || 'bestand'] || q.status,
      notes: String(q.notes || '').replace(/\s+/g, ' ').trim(),
      order: (r?.name || '~') + ' ' + k.name,
    });
  }
  return rows.sort((a, b) => a.order.localeCompare(b.order, 'de'));
}

function listPages(floor, opts) {
  const rows = listRows(floor, opts);
  if (!rows.length) return [];
  const cols = [
    { key: 'room', label: 'Raum', w: 0.15 },
    { key: 'kind', label: 'Anschluss', w: 0.16 },
    { key: 'count', label: 'Anzahl', w: 0.17 },
    { key: 'height', label: 'Höhe', w: 0.07 },
    { key: 'label', label: 'Bezeichnung', w: 0.17 },
    { key: 'status', label: 'Zustand', w: 0.08 },
    { key: 'notes', label: 'Notiz', w: 0.2 },
  ];
  const M = 26,
    top = M + 39,
    rowH = 15;
  const perPage = Math.max(1, Math.floor((PAPER[opts.paper === 'A3' ? 'A3' : 'A4'][1] - 44 - top) / rowH));
  const chunks = [];
  for (let i = 0; i < rows.length; i += perPage) chunks.push(rows.slice(i, i + perPage));
  return chunks.map((chunk, ci) => (g) => {
    g.text(M, M + 14, `Anschlussliste · ${floor.name || 'Etage'}${floor.short ? ` (${floor.short})` : ''}${chunks.length > 1 ? ` (${ci + 1}/${chunks.length})` : ''}`, { size: 15, bold: true, color: INK });
    g.text(g.W - M, M + 14, `${rows.length} Anschlüsse · ${FILTER_NAMES[opts.filter] || FILTER_NAMES.alle}`, { size: 8.5, color: MUTED, anchor: 'end' });
    const tw = g.W - 2 * M;
    const xs = [];
    cols.reduce((x, c) => (xs.push(x), x + c.w * tw), M);
    let y = M + 34;
    cols.forEach((c, i) => g.text(xs[i] + 3, y, c.label, { size: 7.6, bold: true, color: MUTED }));
    y += 5;
    g.line(M, y, M + tw, y, { stroke: '#7a808c', w: 0.7 });
    const cut = (v, w) => {
      let t = String(v ?? '');
      while (textWidth(t, 7.2) > w - 6 && t.length > 3) t = t.slice(0, -2) + '…';
      return t;
    };
    let lastRoom = null;
    for (const r of chunk) {
      cols.forEach((c, j) => {
        const v = c.key === 'room' && r.room === lastRoom ? '' : r[c.key];
        g.text(xs[j] + 3, y + 11, cut(v, c.w * tw), { size: 7.2, bold: c.key === 'room', color: INK });
      });
      lastRoom = r.room;
      y += rowH;
      g.line(M, y, M + tw, y, { stroke: '#e3e5ea', w: 0.4 });
    }
  });
}

// pdf for the given storeys (ids), or all storeys with connections
export function elecPlanPdf(data, { floorIds, paper = 'A4', furniture = true, lines = false, list = true, filter = 'alle' } = {}) {
  const all = sortFloors(Object.values(data.floors || {}));
  const floors = floorIds ? all.filter((f) => floorIds.includes(f.id)) : all.filter((f) => (f.points || []).length);
  const opts = { paper, furniture, lines, filter };
  const draws = [];
  for (const f of floors) {
    draws.push((g) => drawFloor(g, f, data, opts));
    if (list) draws.push(...listPages(f, opts));
  }
  const name = floors.length === 1 ? floors[0].name : 'Alle Etagen';
  return buildDrawingPdf(draws, { title: `Elektroplan ${name}`, paper, footer: `Elektroplan · ${data.house?.name || 'Hausakte'}` });
}

export function elecSummary(floor, filter = 'alle') {
  const sum = {};
  for (const q of (floor.points || []).filter((p) => statusShown(filter, p.status || 'bestand'))) for (const [kk, v] of Object.entries(gangs(q))) sum[kk] = (sum[kk] || 0) + v;
  return sum;
}
