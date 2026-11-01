// Plan geometry shared by the floor plan editor and the AI assistant: lines, connection points, dimensions, openings per room.
import { dist, distToSeg, same, perp, norm, sub, add, mul, pointInPoly, polyArea, bbox } from './geometry.js';
import { fixtureKind } from './catalog.js';
import { bearing, bearingName } from './roof.js';
import { uid } from './util.js';

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
// part of a wall that borders a room (long outer walls run along several rooms): side and range along the wall
function wallSpan(w, room) {
  const { u, L } = frame(w);
  const n = Math.max(4, Math.ceil(L / 0.25));
  let side = 0,
    from = null,
    to = null;
  for (let i = 0; i <= n; i++) {
    const t = 0.03 * L + (0.94 * L * i) / n;
    const sd = roomSide(w, add(w.a, mul(u, t)), room);
    if (!sd) continue;
    side = side || sd;
    if (from == null) from = t;
    to = t;
  }
  return side ? { side, from, to } : null;
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
    rooms.forEach((r, i) => {
      const sp = wallSpan(w, r);
      if (sp) info[i].walls.push({ id: w.id, side: sideName(w, sp.side), length: r3(L), ...(sp.to - sp.from < L * 0.8 ? { lengthInRoom: r3(sp.to - sp.from + 0.06 * L) } : {}), exterior: !!w.ext });
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

// Point in front of a wall on the side of a room (for placing furniture by voice): middle of the wall,
// shifted by `along` metres (positive = towards the wall end b), `inset` metres away from the wall face.
export function wallFrontPoint(floor, wallId, roomId, along = 0, inset = 0.3) {
  const w = (floor.walls || []).find((x) => x.id === wallId);
  if (!w) throw new Error('Unbekannte wallId');
  const room = (floor.rooms || []).find((r) => r.id === roomId) || null;
  const { u, n, L } = frame(w);
  const sp = room ? wallSpan(w, room) : { side: 1, from: 0, to: L };
  if (!sp) throw new Error('Die Wand grenzt nicht an diesen Raum');
  const at = add(w.a, mul(u, Math.max(sp.from, Math.min(sp.to, (sp.from + sp.to) / 2 + (Number(along) || 0)))));
  return add(at, mul(n, sp.side * (w.t / 2 + inset)));
}


// ---------- room side lengths ----------
// A room side is changed by moving the wall at one of its ends (the side perpendicular to it). Only the
// part of that wall which borders the room moves: a wall running past several rooms is split at the room
// corners first, so the neighbouring rooms keep their walls. Walls ending on the moved piece follow it,
// connection points and furniture standing at the moved piece move with it.
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
const wdir = (w) => norm(sub(w.b, w.a));
const at = (P, i) => P[((i % P.length) + P.length) % P.length];

// point slightly inside the room next to the edge p→q
function insideNear(P, p, q) {
  const e = norm(sub(q, p));
  const mid = mul(add(p, q), 0.5);
  const n = [-e[1], e[0]];
  const a = add(mid, mul(n, 0.05));
  return pointInPoly(a, P) ? a : add(mid, mul(n, -0.05));
}

// walls whose face lies along the room edge p→q, on the outside of the room
export function wallsOnEdge(walls, P, p, q) {
  const e = norm(sub(q, p));
  const L = dist(p, q);
  const n = [-e[1], e[0]];
  const inSide = dot2(sub(insideNear(P, p, q), p), n);
  return (walls || []).filter((w) => {
    if (dist(w.a, w.b) < 0.01 || Math.abs(cross2(wdir(w), e)) > 0.02) return false;
    const off = dot2(sub(w.a, p), n);
    if (Math.abs(Math.abs(off) - w.t / 2) > 0.025 || Math.sign(off) === Math.sign(inSide)) return false;
    const s0 = dot2(sub(w.a, p), e),
      s1 = dot2(sub(w.b, p), e);
    return Math.min(Math.max(s0, s1), L) - Math.max(Math.min(s0, s1), 0) > 0.05;
  });
}

// splits a wall at the given points (openings go to the piece they sit in)
export function splitWallAt(walls, id, pts) {
  const w = walls.find((x) => x.id === id);
  if (!w) return walls;
  const L = dist(w.a, w.b);
  const u = wdir(w);
  const ts = pts
    .filter((p) => distToSeg(p, w.a, w.b).d < 0.03)
    .map((p) => dot2(sub(p, w.a), u))
    .filter((t) => t > 0.02 && t < L - 0.02)
    .sort((a, b) => a - b)
    .filter((t, i, arr) => i === 0 || t - arr[i - 1] > 0.02);
  if (!ts.length) return walls;
  const cuts = [0, ...ts, L];
  const pieces = cuts.slice(0, -1).map((t0, k) => {
    const t1 = cuts[k + 1];
    const openings = (w.openings || []).filter((o) => o.pos >= t0 && (o.pos < t1 || k === cuts.length - 2)).map((o) => ({ ...o, pos: r3(o.pos - t0) }));
    return { ...w, id: k === 0 ? w.id : uid('w'), a: P3(add(w.a, mul(u, t0))), b: P3(add(w.a, mul(u, t1))), openings };
  });
  return walls.flatMap((x) => (x.id === id ? pieces : [x]));
}

// splits a wall wherever another wall ends on it or crosses it
export function splitAtJunctions(walls, id) {
  const w = walls.find((x) => x.id === id);
  if (!w) return walls;
  const pts = [];
  for (const o of walls) {
    if (o.id === id) continue;
    for (const p of [o.a, o.b]) if (distToSeg(p, w.a, w.b).d < 0.005) pts.push(p);
    const d1 = sub(w.b, w.a),
      d2 = sub(o.b, o.a);
    const den = cross2(d1, d2);
    if (Math.abs(den) > 1e-9) {
      const t = cross2(sub(o.a, w.a), d2) / den,
        v = cross2(sub(o.a, w.a), d1) / den;
      if (t > 0 && t < 1 && v > 0.001 && v < 0.999) pts.push(add(w.a, mul(d1, t)));
    }
  }
  return splitWallAt(walls, id, pts);
}

// what happens at one end of a room side: the wall there and what lies behind it
function sideEnd(floor, room, i, end) {
  const P = room.poly;
  const p = at(P, i),
    q = at(P, i + 1);
  const e = norm(sub(q, p));
  const [c1, c2, beyond] = end === 'end' ? [q, at(P, i + 2), [at(P, i + 2), at(P, i + 3)]] : [p, at(P, i - 1), [at(P, i - 2), at(P, i - 1)]];
  if (Math.abs(dot2(norm(sub(c2, c1)), e)) > 0.06) return { end, ok: false, reason: 'Die angrenzende Seite ist nicht rechtwinklig.' };
  const walls = floor.walls || [];
  const K = wallsOnEdge(walls, P, c1, c2);
  if (!K.length) return { end, ok: false, reason: 'An dieser Seite steht keine Wand.', manual: !!room.manual, c1, c2 };
  const eE = norm(sub(c2, c1));
  let out = [-eE[1], eE[0]];
  if (pointInPoly(add(mul(add(c1, c2), 0.5), mul(out, 0.05)), P)) out = mul(out, -1);
  // rooms behind that wall along this side (they change too)
  const names = [];
  const L = dist(c1, c2);
  for (let s = 0.15; s < L; s += 0.3) {
    const pt = add(add(c1, mul(eE, s)), mul(out, K[0].t + 0.2));
    const other = (floor.rooms || []).find((r) => r.id !== room.id && r.poly?.length && pointInPoly(pt, r.poly));
    if (other && !names.includes(other.name)) names.push(other.name);
  }
  const ext = K.some((w) => w.ext);
  return { end, ok: true, K, c1, c2, eE, beyond, ext, label: names.length ? `Wand zu ${names.join(', ')}` : ext ? 'Außenwand' : 'Wand dahinter' };
}

// sides of a room with length, compass direction and the walls that can move to change it
export function roomSides(floor, room, north = 0) {
  const P = room.poly || [];
  return P.map((p, i) => {
    const q = at(P, i + 1);
    const e = norm(sub(q, p));
    let n = [-e[1], e[0]];
    if (pointInPoly(add(mul(add(p, q), 0.5), mul(n, 0.05)), P)) n = mul(n, -1);
    const ends = ['end', 'start'].map((end) => {
      const x = sideEnd(floor, room, i, end);
      return { end, ok: x.ok, label: x.label, ext: x.ext, reason: x.reason, wallIds: x.K ? x.K.map((w) => w.id) : [] };
    });
    return { i, a: p, b: q, length: dist(p, q), dir: bearingName(bearing(n[0], n[1], north)), ends };
  });
}

export function setRoomSide(floor, roomId, i, newLength, end) {
  const room = (floor.rooms || []).find((r) => r.id === roomId);
  if (!room?.poly?.length) throw new Error('Raum nicht gefunden');
  const P = room.poly;
  const p = at(P, i),
    q = at(P, i + 1);
  const e = norm(sub(q, p));
  const d = newLength - dist(p, q);
  if (Math.abs(d) < 0.002) return floor;
  const delta = mul(e, end === 'end' ? d : -d);
  const x = sideEnd(floor, room, i, end);
  if (!x.ok) {
    // a room drawn as polygon without walls: move its two corners
    if (x.manual) {
      const moved = P.map((v) => (same(v, x.c1, 0.002) || same(v, x.c2, 0.002) ? P3(add(v, delta)) : v));
      return { ...floor, rooms: floor.rooms.map((r) => (r.id === roomId ? { ...r, poly: moved } : r)) };
    }
    throw new Error(x.reason);
  }
  const { K, c1, c2, eE, beyond } = x;
  const walls0 = floor.walls || [];
  const k0 = K[0];
  const ke = wdir(k0);
  const kn = [-ke[1], ke[0]];
  const onK = (w) => dist(w.a, w.b) > 0.005 && Math.abs(cross2(wdir(w), ke)) < 0.02 && Math.abs(dot2(sub(w.a, k0.a), kn)) < 0.006;
  const project = (pt) => add(k0.a, mul(ke, dot2(sub(pt, k0.a), ke)));
  // junctions on the wall's centre line: room corners pushed out by half the thickness of the walls along the room
  const sideWall = wallsOnEdge(walls0, P, p, q)[0] || null;
  const beyondWall = wallsOnEdge(walls0, P, beyond[0], beyond[1])[0] || null;
  const J1 = add(project(c1), mul(eE, -(sideWall?.t || 0) / 2));
  const J2 = add(project(c2), mul(eE, (beyondWall?.t || 0) / 2));
  let ws = walls0.map((w) => ({ ...w, openings: (w.openings || []).map((o) => ({ ...o })) }));
  for (const k of K) ws = splitWallAt(ws, k.id, [J1, J2]);
  const span = dist(J1, J2);
  const M = ws.filter((w) => {
    if (!onK(w)) return false;
    const s = dot2(sub(mul(add(w.a, w.b), 0.5), J1), eE);
    return s > 0.005 && s < span - 0.005;
  });
  if (!M.length) throw new Error('Die Wand an dieser Seite wurde nicht gefunden.');
  const Mids = new Set(M.map((w) => w.id));
  const oldM = M.map((w) => ({ a: w.a, b: w.b, t: w.t }));
  const onMoved = (pt) => oldM.some((m) => distToSeg(pt, m.a, m.b).d < 0.006);
  const kept = [];
  ws = ws.map((w) => {
    if (Mids.has(w.id)) return { ...w, a: P3(add(w.a, delta)), b: P3(add(w.b, delta)) };
    const collinear = onK(w);
    let a = w.a,
      b = w.b,
      shiftA = 0,
      changed = false;
    for (const key of ['a', 'b']) {
      if (!onMoved(w[key])) continue;
      // the rest of the same wall line stays where it is (it now ends at a step)
      if (collinear) {
        kept.push({ pt: w[key] });
        continue;
      }
      const np = P3(add(w[key], delta));
      if (key === 'a') {
        shiftA = dot2(sub(np, w.a), wdir(w));
        a = np;
      } else b = np;
      changed = true;
    }
    if (!changed) return w;
    const Lw = dist(a, b);
    return { ...w, a, b, openings: (w.openings || []).map((o) => ({ ...o, pos: r3(Math.max(o.w / 2, Math.min(Lw - o.w / 2, o.pos - shiftA))) })) };
  });
  // close a step that is not covered by another wall
  for (const { pt } of kept) {
    if (ws.some((w) => !onK(w) && distToSeg(pt, w.a, w.b).d < 0.006)) continue;
    const near = dist(pt, J1) < dist(pt, J2) ? sideWall : beyondWall;
    ws.push({ id: uid('w'), a: P3(pt), b: P3(add(pt, delta)), t: near?.t || k0.t, ext: !!near?.ext, ...(near?.color ? { color: near.color } : {}), openings: [] });
  }
  // connection points and furniture at the moved piece move with it
  const nearM = (pt, extra) => oldM.some((m) => {
    const r = distToSeg(pt, m.a, m.b);
    return r.t > -0.001 && r.t < 1.001 && r.d < m.t / 2 + extra;
  });
  const points = (floor.points || []).map((pt) => (pt.rot != null && nearM([pt.x, pt.y], 0.03) ? { ...pt, x: r3(pt.x + delta[0]), y: r3(pt.y + delta[1]) } : pt));
  const furniture = (floor.furniture || []).map((f) => {
    const t = furnBack(f);
    return t && nearM(t, 0.05) ? { ...f, x: r3(f.x + delta[0]), y: r3(f.y + delta[1]) } : f;
  });
  return { ...floor, walls: ws, points, furniture };
}

// middle of the back edge of a piece of furniture (plan rotation clockwise, back at -d/2)
function furnBack(f) {
  if (!Number.isFinite(f.x) || !Number.isFinite(f.d)) return null;
  const r = ((f.rot || 0) * Math.PI) / 180;
  return [f.x + (Math.sin(r) * f.d) / 2, f.y - (Math.cos(r) * f.d) / 2];
}
