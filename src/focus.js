// Room focus: what belongs to one room (its walls, furniture, lines, connection points, stairs), so plan
// and 3D model can show that room clearly and everything else only slightly faded.
import { pointInPoly, dist } from './geometry.js';

// walls on the room's outline (either face of the wall may lie on it) and walls standing inside the room
export function roomWallIds(room, walls) {
  const P = room?.poly;
  const out = new Set();
  if (!P || P.length < 3) return out;
  for (const w of walls || []) {
    const L = dist(w.a, w.b);
    if (L < 0.01) continue;
    const u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
    const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    if (pointInPoly(mid, P)) {
      out.add(w.id);
      continue;
    }
    const tol = (w.t || 0.2) / 2 + 0.08;
    for (let i = 0; i < P.length; i++) {
      const p = P[i],
        q = P[(i + 1) % P.length];
      const el = dist(p, q);
      if (el < 0.01) continue;
      const e = [(q[0] - p[0]) / el, (q[1] - p[1]) / el];
      if (Math.abs(u[0] * e[1] - u[1] * e[0]) > 0.05) continue;
      const n = [-e[1], e[0]];
      const off = Math.abs((w.a[0] - p[0]) * n[0] + (w.a[1] - p[1]) * n[1]);
      if (off > tol) continue;
      const s0 = (w.a[0] - p[0]) * e[0] + (w.a[1] - p[1]) * e[1];
      const s1 = (w.b[0] - p[0]) * e[0] + (w.b[1] - p[1]) * e[1];
      if (Math.min(Math.max(s0, s1), el) - Math.max(Math.min(s0, s1), 0) > 0.05) {
        out.add(w.id);
        break;
      }
    }
  }
  return out;
}

export const inRoom = (room, x, y) => !!room?.poly && room.poly.length >= 3 && pointInPoly([x, y], room.poly);

const stairsCenter = (it) => {
  const ew = it.dir === 'e' || it.dir === 'w';
  return [it.x + (ew ? it.l : it.w) / 2, it.y + (ew ? it.w : it.l) / 2];
};

// everything of a floor that belongs to the room
export function roomFocus(room, floor) {
  if (!room?.poly || room.poly.length < 3) return null;
  const walls = roomWallIds(room, floor.walls);
  const furn = new Set((floor.furniture || []).filter((f) => inRoom(room, f.x, f.y)).map((f) => f.id));
  const lines = new Set((floor.lines || []).filter((l) => (l.pts || []).some((q) => inRoom(room, q[0], q[1]))).map((l) => l.id));
  const points = new Set((floor.points || []).filter((q) => inRoom(room, q.x, q.y)).map((q) => q.id));
  const items = new Set((floor.items || []).filter((it) => it.type === 'stairs' && inRoom(room, ...stairsCenter(it))).map((it) => it.id));
  return { room, walls, furn, lines, points, items };
}

// the focused room from the UI selection (a room selected in plan or model)
export function focusedRoom(selection, floors) {
  if (selection?.type !== 'room') return null;
  const f = (Array.isArray(floors) ? floors : Object.values(floors || {})).find((x) => x.id === selection.floorId);
  const room = f?.rooms?.find((r) => r.id === selection.roomId);
  return room?.poly?.length >= 3 ? { floor: f, room } : null;
}
