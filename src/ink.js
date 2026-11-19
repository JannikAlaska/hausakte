// Handwriting: strokes on a page 1000 units wide (height grows while writing), pressure-sensitive
// (Apple Pencil, other pens), stored compactly and rendered to an image for the AI and for viewing.
// Stored ink: { v: 1, w: 1000, h, s: [{ k: 'pen'|'marker', c: colour, w: width, d: [x0, y0, p0, dx, dy, dp, …] }] }
// with integer coordinates and pressure 0–100; d is delta-encoded after the first point.

export const PAGE_W = 1000;
export const PAGE_H0 = 1414; // A4 proportions
export const RULE = 48; // line spacing of the ruled paper
export const INK_COLORS = [
  { key: '#1b2032', name: 'Schwarz' },
  { key: '#2457c5', name: 'Blau' },
  { key: '#c62f2f', name: 'Rot' },
  { key: '#16825d', name: 'Grün' },
];
export const MARKER = '#f5c400';
export const WIDTHS = [
  { key: 2.2, name: 'Fein' },
  { key: 3.4, name: 'Mittel' },
  { key: 5.6, name: 'Dick' },
];

// ---------- compact storage ----------
export function encodeStroke(st) {
  const pts = simplify(st.pts, 0.45);
  const d = [];
  let px = 0,
    py = 0,
    pp = 0;
  pts.forEach((q, i) => {
    const x = Math.round(q[0]),
      y = Math.round(q[1]),
      p = Math.round((q[2] ?? 0.5) * 100);
    if (i === 0) d.push(x, y, p);
    else d.push(x - px, y - py, p - pp);
    px = x;
    py = y;
    pp = p;
  });
  return { k: st.k, c: st.c, w: st.w, d };
}

export function decodeStroke(s) {
  const pts = [];
  const d = s.d || [];
  let x = 0,
    y = 0,
    p = 0;
  for (let i = 0; i + 2 < d.length; i += 3) {
    if (i === 0) {
      x = d[0];
      y = d[1];
      p = d[2];
    } else {
      x += d[i];
      y += d[i + 1];
      p += d[i + 2];
    }
    pts.push([x, y, p / 100]);
  }
  return { k: s.k || 'pen', c: s.c || INK_COLORS[0].key, w: s.w || 3.4, pts };
}

export const decodeInk = (ink) => ({ w: ink?.w || PAGE_W, h: ink?.h || PAGE_H0, strokes: (ink?.s || []).map(decodeStroke) });
export const encodeInk = ({ h, strokes }) => ({ v: 1, w: PAGE_W, h: Math.round(h), s: strokes.map(encodeStroke) });

// Ramer–Douglas–Peucker on x/y; the pressure of the kept points stays
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a],
      [bx, by] = pts[b];
    const dx = bx - ax,
      dy = by - ay;
    const L = Math.hypot(dx, dy) || 1e-9;
    let best = -1,
      bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > eps) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---------- drawing ----------
// The Apple Pencil reports normal handwriting as only about 5–25 % of full pressure. The square root lifts light
// strokes to nearly the chosen width (5 % → 83 %, 15 % → 93 %); pressing harder still makes the line up to 30 % bolder.
export const pressFactor = (p) => 0.7 + 0.6 * Math.sqrt(Math.max(0, Math.min(1, p ?? 0.35)));
const widthAt = (st, p) => (st.k === 'marker' ? st.w : st.w * pressFactor(p));

// draws one stroke (or its last segments from index `from`) on a context scaled to page units
export function drawStroke(ctx, st, from = 0) {
  const pts = st.pts;
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = st.c;
  ctx.fillStyle = st.c;
  if (st.k === 'marker') ctx.globalAlpha = 0.38;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], widthAt(st, pts[0][2]) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (st.k === 'marker') {
    // one path, so overlapping parts do not get darker
    ctx.lineWidth = st.w;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.restore();
    return;
  }
  // pen: smoothed segments through the midpoints, width from pressure
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    const p0 = i > 1 ? [(pts[i - 2][0] + a[0]) / 2, (pts[i - 2][1] + a[1]) / 2] : a;
    const p1 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    ctx.lineWidth = widthAt(st, (a[2] + b[2]) / 2);
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.quadraticCurveTo(a[0], a[1], p1[0], p1[1]);
    if (i === pts.length - 1) ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  ctx.restore();
}

// markers first, so the writing stays on top
export function drawAll(ctx, strokes) {
  for (const st of strokes) if (st.k === 'marker') drawStroke(ctx, st);
  for (const st of strokes) if (st.k !== 'marker') drawStroke(ctx, st);
}

export function inkBounds(strokes) {
  let minY = Infinity,
    maxY = -Infinity;
  for (const st of strokes)
    for (const q of st.pts) {
      minY = Math.min(minY, q[1]);
      maxY = Math.max(maxY, q[1]);
    }
  return Number.isFinite(minY) ? { minY, maxY } : null;
}

// strokes erased by a rubber at (x, y) with radius r (page units)
export function hitStrokes(strokes, x, y, r) {
  const out = new Set();
  strokes.forEach((st, i) => {
    const pts = st.pts;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k],
        b = pts[k + 1] || a;
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
      if (Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t) <= r + widthAt(st, a[2]) / 2) {
        out.add(i);
        break;
      }
    }
  });
  return out;
}

// the written part of the page as JPEG (white paper, no ruling) plus a small preview
export async function renderInk(strokes, { width = 1400, thumbWidth = 420 } = {}) {
  const b = inkBounds(strokes);
  if (!b) return null;
  const top = Math.max(0, Math.floor(b.minY - 40));
  const bottom = Math.ceil(b.maxY + 40);
  const h = Math.max(120, bottom - top);
  const make = (w) => {
    const k = w / PAGE_W;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = Math.round(h * k);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(k, 0, 0, k, 0, -top * k);
    drawAll(ctx, strokes);
    return cv;
  };
  const big = make(width);
  const blob = await new Promise((res) => big.toBlob(res, 'image/jpeg', 0.86));
  const thumb = make(thumbWidth).toDataURL('image/jpeg', 0.62);
  return { blob: blob && new File([blob], 'handschrift.jpg', { type: 'image/jpeg' }), thumb, w: width, h: big.height };
}
