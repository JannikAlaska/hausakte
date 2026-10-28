// 2D plan geometry. Plan coordinates are meters: x to the right (east), y downward (south).
// All polygon helpers work on arrays of [x, y].

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, s) => [a[0] * s, a[1] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (v) => Math.hypot(v[0], v[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};
export const perp = (v) => [-v[1], v[0]];
export const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const same = (a, b, eps = 1e-3) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

export function polyArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function polyPerimeter(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += dist(p[i], p[(i + 1) % p.length]);
  return s;
}

export function polyCentroid(p) {
  const A = polyArea(p);
  if (Math.abs(A) < 1e-9) {
    const n = p.length || 1;
    return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n];
  }
  let cx = 0,
    cy = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length];
    const f = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * f;
    cy += (a[1] + b[1]) * f;
  }
  return [cx / (6 * A), cy / (6 * A)];
}

export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0],
      yi = poly[i][1],
      xj = poly[j][0],
      yj = poly[j][1];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(points) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Distance from p to segment ab; t is the clamped parameter, q the closest point.
export function distToSeg(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 ? dot(sub(p, a), ab) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + ab[0] * t, a[1] + ab[1] * t];
  return { d: dist(p, q), t, q };
}

export function distToPolyEdges(p, poly) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSeg(p, poly[i], poly[(i + 1) % poly.length]).d);
  return d;
}

// A point well inside the polygon for placing labels.
export function labelPoint(poly) {
  if (!poly || poly.length < 3) return [0, 0];
  const c = polyCentroid(poly);
  if (pointInPoly(c, poly) && distToPolyEdges(c, poly) > 0.45) return c;
  const bb = bbox(poly);
  let best = c,
    bestD = -1;
  const N = 16;
  for (let i = 1; i < N; i++)
    for (let j = 1; j < N; j++) {
      const q = [bb.minX + (bb.w * i) / N, bb.minY + (bb.h * j) / N];
      if (!pointInPoly(q, poly)) continue;
      const d = distToPolyEdges(q, poly);
      if (d > bestD) {
        bestD = d;
        best = q;
      }
    }
  return best;
}

// Intersection of infinite lines p1 + s*d1 and p2 + t*d2.
export function lineIntersect(p1, d1, p2, d2) {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const s = cross(sub(p2, p1), d2) / den;
  return [p1[0] + d1[0] * s, p1[1] + d1[1] * s];
}

// Segment intersection: returns {t, u, p} with t on ab and u on cd, or null.
export function segIntersect(a, b, c, d) {
  const r = sub(b, a),
    s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { t, u, p: [a[0] + r[0] * t, a[1] + r[1] * t] };
}

// Removes duplicate and collinear vertices.
export function simplifyPoly(poly, eps = 1e-4) {
  let pts = poly.filter((p, i) => !same(p, poly[(i + 1) % poly.length], eps));
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length],
        b = pts[i],
        c = pts[(i + 1) % pts.length];
      if (Math.abs(cross(sub(b, a), sub(c, b))) < eps * Math.max(1, dist(a, c))) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

// Moves every edge i (poly[i] -> poly[i+1]) toward the interior by dists[i] (negative = outward).
export function insetPolygon(poly, dists) {
  const n = poly.length;
  if (n < 3) return poly.slice();
  const s = Math.sign(polyArea(poly)) || 1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i],
      b = poly[(i + 1) % n];
    const dir = norm(sub(b, a));
    const nrm = mul(perp(dir), s);
    const d = typeof dists === 'number' ? dists : dists[i] || 0;
    lines.push({ p: add(a, mul(nrm, d)), dir });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const L0 = lines[(i - 1 + n) % n],
      L1 = lines[i];
    const x = lineIntersect(L0.p, L0.dir, L1.p, L1.dir);
    out.push(x || L1.p);
  }
  return out;
}

export const offsetPolygon = (poly, d) => insetPolygon(poly, -d);

// ---------- planar graph faces from wall center lines ----------

// segments: [{a:[x,y], b:[x,y]}]. Returns bounded faces [{poly, area}] (area > 0).
export function planarFaces(segments, eps = 0.003, minArea = 0.08) {
  const segs = segments.filter((s) => dist(s.a, s.b) > eps);
  const pieces = [];
  for (let i = 0; i < segs.length; i++) {
    const { a, b } = segs[i];
    const ts = [0, 1];
    for (let j = 0; j < segs.length; j++) {
      if (i === j) continue;
      const o = segs[j];
      for (const e of [o.a, o.b]) {
        const r = distToSeg(e, a, b);
        if (r.d < eps && r.t > 1e-6 && r.t < 1 - 1e-6) ts.push(r.t);
      }
      const x = segIntersect(a, b, o.a, o.b);
      if (x && x.t > 1e-6 && x.t < 1 - 1e-6) ts.push(x.t);
    }
    ts.sort((p, q) => p - q);
    for (let k = 0; k < ts.length - 1; k++) {
      if (ts[k + 1] - ts[k] < 1e-6) continue;
      pieces.push([lerp2(a, b, ts[k]), lerp2(a, b, ts[k + 1])]);
    }
  }
  // nodes
  const nodes = [];
  const nodeId = (p) => {
    for (let i = 0; i < nodes.length; i++) if (dist(nodes[i], p) < eps) return i;
    nodes.push(p);
    return nodes.length - 1;
  };
  const edgeSet = new Set();
  const adj = new Map();
  const link = (u, v) => {
    if (!adj.has(u)) adj.set(u, new Set());
    adj.get(u).add(v);
  };
  for (const [p, q] of pieces) {
    const u = nodeId(p),
      v = nodeId(q);
    if (u === v) continue;
    const k = u < v ? u + '_' + v : v + '_' + u;
    if (edgeSet.has(k)) continue;
    edgeSet.add(k);
    link(u, v);
    link(v, u);
  }
  // prune dead ends
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const [u, set] of adj) {
      if (set.size <= 1) {
        for (const v of set) adj.get(v)?.delete(u);
        adj.delete(u);
        pruned = true;
      }
    }
  }
  const sorted = new Map();
  for (const [u, set] of adj) {
    const arr = [...set];
    arr.sort((p, q) => {
      const ap = Math.atan2(nodes[p][1] - nodes[u][1], nodes[p][0] - nodes[u][0]);
      const aq = Math.atan2(nodes[q][1] - nodes[u][1], nodes[q][0] - nodes[u][0]);
      return ap - aq;
    });
    sorted.set(u, arr);
  }
  const visited = new Set();
  const faces = [];
  for (const [u0, list] of sorted) {
    for (const v0 of list) {
      if (visited.has(u0 + '>' + v0)) continue;
      const poly = [];
      let u = u0,
        v = v0,
        guard = 0;
      while (guard++ < 10000) {
        visited.add(u + '>' + v);
        poly.push(nodes[u]);
        const nb = sorted.get(v);
        const idx = nb.indexOf(u);
        const w = nb[(idx - 1 + nb.length) % nb.length];
        u = v;
        v = w;
        if (u === u0 && v === v0) break;
      }
      const area = polyArea(poly);
      if (area > minArea) faces.push({ poly: simplifyPoly(poly), area });
    }
  }
  return faces;
}

export const wallSegs = (walls) => walls.map((w) => ({ a: w.a, b: w.b }));

// Building outline (wall center line) from exterior walls; falls back to the bounding box.
export function outlineFromWalls(walls) {
  if (!walls || !walls.length) return null;
  const ext = walls.filter((w) => w.ext);
  const faces = planarFaces(wallSegs(ext.length ? ext : walls));
  if (faces.length) {
    faces.sort((a, b) => b.area - a.area);
    return faces[0].poly;
  }
  const bb = bbox(walls.flatMap((w) => [w.a, w.b]));
  if (bb.w < 0.1 || bb.h < 0.1) return null;
  return [
    [bb.minX, bb.minY],
    [bb.maxX, bb.minY],
    [bb.maxX, bb.maxY],
    [bb.minX, bb.maxY],
  ];
}

// Outer face of the building: center line outline pushed out by half the exterior wall thickness.
export function outerOutline(walls) {
  const ol = outlineFromWalls(walls);
  if (!ol) return null;
  const dists = ol.map((p, i) => {
    const q = ol[(i + 1) % ol.length];
    const w = findWallOnEdge(walls, p, q);
    return -((w ? w.t : 0.3) / 2);
  });
  return insetPolygon(ol, dists);
}

// Wall whose center line covers edge pq.
export function findWallOnEdge(walls, p, q, eps = 0.01) {
  for (const w of walls) {
    if (distToSeg(p, w.a, w.b).d < eps && distToSeg(q, w.a, w.b).d < eps) return w;
  }
  return null;
}

// Finished-floor polygon of a room: face polygon inset by half of each bounding wall.
export function roomInnerPolygon(facePoly, walls) {
  const dists = facePoly.map((p, i) => {
    const q = facePoly[(i + 1) % facePoly.length];
    const w = findWallOnEdge(walls, p, q);
    return w ? w.t / 2 : 0;
  });
  return simplifyPoly(insetPolygon(facePoly, dists));
}

// Smallest face containing point p.
export function faceAt(p, walls) {
  const faces = planarFaces(wallSegs(walls)).filter((f) => pointInPoly(p, f.poly));
  if (!faces.length) return null;
  faces.sort((a, b) => a.area - b.area);
  return faces[0];
}

export function wallLength(w) {
  return dist(w.a, w.b);
}

// Area of window/door openings in a wall (m²).
export function openingArea(w, type) {
  return (w.openings || []).filter((o) => !type || o.type === type).reduce((s, o) => s + o.w * o.h, 0);
}

// Snaps an angle-constrained point: keeps p on 0/45/90° rays from a when close.
export function orthoSnap(a, p, tolDeg = 6) {
  const v = sub(p, a);
  const L = len(v);
  if (L < 1e-6) return p;
  const ang = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  for (const target of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
    if (Math.abs(ang - target) < tolDeg) {
      const r = (target * Math.PI) / 180;
      return [a[0] + Math.cos(r) * L, a[1] + Math.sin(r) * L];
    }
  }
  return p;
}
