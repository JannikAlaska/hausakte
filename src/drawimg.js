// The drawing canvas of pdf.js, painting onto an image instead (JPEG/PNG exports of plans): the same calls
// and coordinates (points from the top left), rendered at `scale` pixels per point (2.5 ≈ 180 dpi).
import { PAPER, textWidth } from './pdf.js';

export function drawToBlob(draw, { paper = 'A4', scale = 2.5, type = 'image/jpeg', quality = 0.92 } = {}) {
  const [W, H] = PAPER[paper] || PAPER.A4;
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * scale);
  cv.height = Math.round(H * scale);
  const c = cv.getContext('2d');
  c.scale(scale, scale);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, W, H);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const paint = (o) => {
    if (o.fill) {
      c.fillStyle = o.fill;
      c.fill();
    }
    if (o.stroke) {
      c.strokeStyle = o.stroke;
      c.lineWidth = o.w ?? 0.6;
      c.setLineDash(o.dash || []);
      c.stroke();
      c.setLineDash([]);
    }
  };
  const g = {
    W,
    H,
    line(x1, y1, x2, y2, o = {}) {
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      paint({ stroke: '#000000', ...o, fill: null });
    },
    path(pts, o = {}) {
      if (!pts || pts.length < 2) return;
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      if (o.close) c.closePath();
      paint(o);
    },
    rect(x, y, w, h, o = {}) {
      c.beginPath();
      c.rect(x, y, w, h);
      paint(o);
    },
    circle(cx, cy, r, o = {}) {
      c.beginPath();
      c.arc(cx, cy, r, 0, 2 * Math.PI);
      paint(o);
    },
    arc(cx, cy, r, a0, a1, o = {}) {
      c.beginPath();
      c.arc(cx, cy, r, a0, a1, a1 < a0);
      paint({ stroke: '#000000', ...o, fill: null });
    },
    text(x, y, s, o = {}) {
      const size = o.size ?? 8;
      c.font = `${o.bold ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`;
      c.fillStyle = o.color || '#1a1a1a';
      c.textAlign = o.anchor === 'middle' ? 'center' : o.anchor === 'end' ? 'right' : 'left';
      c.textBaseline = 'alphabetic';
      c.fillText(String(s), x, y);
      return textWidth(s, size, o.bold);
    },
    clip(x, y, w, h) {
      c.save();
      c.beginPath();
      c.rect(x, y, w, h);
      c.clip();
    },
    unclip() {
      c.restore();
    },
  };
  draw(g);
  return new Promise((res, rej) =>
    cv.toBlob(
      (b) => {
        // give the pixel memory back at once: iPad Safari allows only a few big canvases at a time
        cv.width = cv.height = 0;
        b ? res(b) : rej(new Error('Das Bild konnte nicht erstellt werden.'));
      },
      type,
      quality,
    ),
  );
}
