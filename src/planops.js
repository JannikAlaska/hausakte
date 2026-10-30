// Plan geometry shared by the floor plan editor and the AI assistant: lines, connection points, dimensions, openings per room.
import { dist, distToSeg, same, perp, norm, sub, add, mul, pointInPoly, polyArea, bbox } from './geometry.js';
import { fixtureKind } from './catalog.js';
import { bearing, bearingName } from './roof.js';

export const r3 = (v) => Math.round(v * 1000) / 1000;
const P3 = (p) => [r3(p[0]), r3(p[1])];

export function lineLength(l) {
  let L = 0;
  for (let i = 1; i < (l.pts || []).length; i++) {
    const a = l.pts[i - 1],
      b = l.pts[i];
    L += Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] ?? 0) - (a[2] ?? 0));
  }
  return L;
}
// unique plan positions of a line (vertical pieces collapse to one point)
export function linePlanPts(l) {
  const out = [];
  for (const q of l.pts || []) if (!out.length || !same(out[out.length - 1], q, 0.002)) out.push([q[0], q[1]]);
  return out;
}

// point in the wall axis behind a wall-mounted fixture (lamps: the fixture itself)
export function fixtureAnchor(pt, walls) {
  if (pt.rot == null) return [pt.x, pt.y];
  let best = null;
  for (const w of walls) {
    const r = distToSeg([pt.x, pt.y], w.a, w.b);
    const e = Math.abs(r.d - w.t / 2);
    if (e < 0.03 && (!best || e < best.e)) best = { e, q: r.q };
  }
  return best ? P3(best.q) : [pt.x, pt.y];
}
// nearest point of a line in plan, with its height (risers: clamped to the wanted height)
export function nearestOnLine(p, l, zWant) {
  const pts = l.pts || [];
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    if (same(a, b, 0.002)) continue;
    const r = distToSeg(p, a, b);
    if (!best || r.d < best.d) best = { d: r.d, q: [r.q[0], r.q[1], (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * r.t] };
  }
  if (!best && pts.length) {
    const zs = pts.map((q) => q[2] ?? 0);
    best = { d: dist(p, pts[0]), q: [pts[0][0], pts[0][1], Math.max(Math.min(...zs), Math.min(Math.max(...zs), zWant))] };
  }
  return best;
}
export const dedup3 = (pts) => pts.filter((q, i, a) => i === 0 || Math.abs(q[0] - a[i - 1][0]) + Math.abs(q[1] - a[i - 1][1]) + Math.abs(q[2] - a[i - 1][2]) > 0.004);
// Connects every fixture to a matching line nearby with a short piece: along the wall axis, up or down, out to the wall face.
// These pieces are regenerated on every change; once edited by hand they stay.
export function relink(f) {
  const lines = f.lines || [];
  const keep = lines.filter((l) => !(l.auto && l.stubFor));
  const points = f.points || [];
  const stubs = [];
  for (const pt of points) {
    const kinds = fixtureKind(pt.kind).lines || [];
    const cand = keep.filter((l) => kinds.includes(l.kind) && (l.pts || []).length >= 2);
    if (!cand.length) continue;
    const P = [pt.x, pt.y];
    if (cand.some((l) => l.pts.some((q) => dist(q, P) < 0.03))) continue;
    const A = fixtureAnchor(pt, f.walls || []);
    const zf = pt.z ?? 0.3;
    // a line running right through the fixture only needs a vertical piece (if at all)
    const through = cand.map((l) => ({ l, r: nearestOnLine(P, l, zf) })).filter((x) => x.r && x.r.d < 0.03);
    if (through.length) {
      if (through.some((x) => Math.abs(x.r.q[2] - zf) < 0.01)) continue;
      const t = through[0];
      stubs.push({ id: 'ls-' + pt.id, kind: t.l.kind, status: t.l.status || 'bestand', pts: [[P[0], P[1], r3(t.r.q[2])], [P[0], P[1], r3(zf)]], label: '', notes: '', stubFor: pt.id, auto: true });
      continue;
    }
    let best = null;
    for (const l of cand) {
      const r = nearestOnLine(A, l, zf);
      if (r && (!best || r.d < best.d)) best = { ...r, l };
    }
    if (!best || best.d > (pt.kind === 'lampe' ? 0.8 : 0.4)) continue;
    const zq = best.q[2];
    // wall fixtures: along the wall axis, then up/down; ceiling lamps: up into the ceiling, then across
    const raw = pt.rot == null ? [[best.q[0], best.q[1], zq], [best.q[0], best.q[1], zf], [P[0], P[1], zf]] : [[best.q[0], best.q[1], zq], [A[0], A[1], zq], [A[0], A[1], zf], [P[0], P[1], zf]];
    const pts = dedup3(raw.map((q) => q.map(r3)));
    if (pts.length < 2) continue;
    stubs.push({ id: 'ls-' + pt.id, kind: best.l.kind, status: pt.status === 'geplant' || best.l.status === 'geplant' ? 'geplant' : best.l.status || 'bestand', pts, label: '', notes: '', stubFor: pt.id, auto: true });
  }
  if (!stubs.length && keep.length === lines.length) return f;
  return { ...f, lines: [...keep, ...stubs] };
}
// room a point belongs to (wall points are nudged into the room they face)
export function roomOfPoint(floor, pt) {
  const a = ((pt.rot ?? 0) * Math.PI) / 180;
  const q = pt.rot == null ? [pt.x, pt.y] : [pt.x + Math.cos(a) * 0.08, pt.y + Math.sin(a) * 0.08];
  return (floor.rooms || []).find((r) => r.poly?.length && pointInPoly(q, r.poly)) || null;
}


// ---------- line length ----------
// Sets the length of a line by moving its end (or start) along the last piece; shorter lengths drop whole pieces from that end.
export function resizeLine(pts, target, atStart = false) {
  if (!(target > 0.02) || (pts || []).length < 2) return pts;
  const P = (atStart ? [...pts].reverse() : [...pts]).map((q) => [q[0], q[1], q[2] ?? 0]);
  const d3 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  let delta = target - lineLength({ pts: P });
  if (Math.abs(delta) < 0.0005) return pts;
  if (delta < 0) {
    let rem = -delta;
    while (P.length > 2 && d3(P[P.length - 2], P[P.length - 1]) <= rem) {
      rem -= d3(P[P.length - 2], P[P.length - 1]);
      P.pop();
    }
    delta = -rem;
  }
  const a = P[P.length - 2],
    b = P[P.length - 1];
  const L = d3(a, b);
  if (L < 1e-6) return pts;
  const nl = Math.max(0.01, L + delta);
  P[P.length - 1] = [a[0] + ((b[0] - a[0]) / L) * nl, a[1] + ((b[1] - a[1]) / L) * nl, a[2] + ((b[2] - a[2]) / L) * nl].map(r3);
  return atStart ? P.reverse() : P;
}

// ---------- dimensions ----------
export const dimLength = (d) => Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);

function frame(w) {
  const u = norm(sub(w.b, w.a));
  return { L: dist(w.a, w.b), u, n: perp(u) };
}
// side of the wall (+1/-1 along its normal) on which the room lies, 0 if none
function roomSide(w, at, room) {
  const { n } = frame(w);
  for (const s of [1, -1]) if (room?.poly?.length && pointInPoly(add(at, mul(n, s * (w.t / 2 + 0.12))), room.poly)) return s;
  return 0;
}
const OPENING_NAME = { window: 'Fenster', door: 'Tür', opening: 'Durchgang' };

// Rooms with the walls and openings around them, described for the AI (side = where the wall lies as seen from the room).
export function floorPlanInfo(floor, north = 0) {
  const rooms = (floor.rooms || []).filter((r) => r.poly?.length >= 3);
  const info = rooms.map((r) => {
    const bb = bbox(r.poly);
    return { id: r.id, name: r.name, area: r3(Math.abs(polyArea(r.poly))), size: `${r3(bb.w)} × ${r3(bb.h)} m`, walls: [], openings: [] };
  });
  const sideName = (w, s) => {
    const { n } = frame(w);
    return bearingName(bearing(-n[0] * s, -n[1] * s, north));
  };
  for (const w of floor.walls || []) {
    const { u, L } = frame(w);
    const mid = add(w.a, mul(u, L / 2));
    rooms.forEach((r, i) => {
      const s = roomSide(w, mid, r);
      if (s) info[i].walls.push({ id: w.id, side: sideName(w, s), length: r3(L), exterior: !!w.ext });
      for (const o of w.openings || []) {
        const so = roomSide(w, add(w.a, mul(u, o.pos)), r);
        if (so) info[i].openings.push({ id: o.id, type: OPENING_NAME[o.type] || o.type, width: r3(o.w), height: r3(o.h), wallId: w.id, side: sideName(w, so), exterior: !!w.ext, posOnWall: r3(o.pos) });
      }
    });
  }
  return info;
}

// Start and end of a dimension line for a description like "width of opening X" or "between openings X and Y".
export function measurePoints(floor, spec) {
  const walls = floor.walls || [];
  const rooms = floor.rooms || [];
  const room = spec.roomId ? rooms.find((r) => r.id === spec.roomId) : null;
  if (spec.roomId && !room) throw new Error('Unbekannte roomId');
  const findOp = (id) => {
    for (const w of walls) {
      const o = (w.openings || []).find((x) => x.id === id);
      if (o) return { w, o };
    }
    throw new Error(`Unbekannte openingId ${id}`);
  };
  // dimension lines sit 25 cm in front of the wall on the side of the room
  const sideFor = (w, at) => (room ? roomSide(w, at, room) : 0) || rooms.map((r) => roomSide(w, at, r)).find(Boolean) || 1;
  const off = (w, s) => mul(frame(w).n, s * (w.t / 2 + 0.25));
  if (spec.type === 'opening') {
    const { w, o } = findOp(spec.openingId);
    const { u } = frame(w);
    const c = add(w.a, mul(u, o.pos));
    const d = off(w, sideFor(w, c));
    return [P3(add(add(c, mul(u, -o.w / 2)), d)), P3(add(add(c, mul(u, o.w / 2)), d))];
  }
  if (spec.type === 'between_openings') {
    const f1 = findOp(spec.openingId),
      f2 = findOp(spec.openingId2);
    if (f1.w.id === f2.w.id) {
      const w = f1.w;
      const { u } = frame(w);
      const [o1, o2] = [f1.o, f2.o].sort((a, b) => a.pos - b.pos);
      const e1 = o1.pos + o1.w / 2,
        e2 = o2.pos - o2.w / 2;
      if (e2 - e1 < 0.01) throw new Error('Die Öffnungen überlappen sich');
      const d = off(w, sideFor(w, add(w.a, mul(u, (e1 + e2) / 2))));
      return [P3(add(add(w.a, mul(u, e1)), d)), P3(add(add(w.a, mul(u, e2)), d))];
    }
    const pt = ({ w, o }) => {
      const c = add(w.a, mul(frame(w).u, o.pos));
      return P3(add(c, off(w, sideFor(w, c))));
    };
    return [pt(f1), pt(f2)];
  }
  if (spec.type === 'wall') {
    const w = walls.find((x) => x.id === spec.wallId);
    if (!w) throw new Error('Unbekannte wallId');
    const { u, L } = frame(w);
    const d = off(w, sideFor(w, add(w.a, mul(u, L / 2))));
    return [P3(add(w.a, d)), P3(add(w.b, d))];
  }
  if (spec.type === 'room') {
    if (!room) throw new Error('Für type "room" wird roomId gebraucht');
    const bb = bbox(room.poly);
    const long = bb.w >= bb.h;
    const alongX = spec.direction === 'kurz' ? !long : long;
    return alongX ? [P3([bb.minX, bb.minY + bb.h / 2]), P3([bb.minX + bb.w, bb.minY + bb.h / 2])] : [P3([bb.minX + bb.w / 2, bb.minY]), P3([bb.minX + bb.w / 2, bb.minY + bb.h])];
  }
  if (spec.type === 'points' && Array.isArray(spec.a) && Array.isArray(spec.b)) return [P3(spec.a.map(Number)), P3(spec.b.map(Number))];
  throw new Error('Unbekannter type');
}
