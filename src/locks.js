// Rooms marked as measured ("gemessen") keep their dimensions. Every write of a floor is checked here: a change
// that would move, thicken or remove the walls around such a room, redraw its outline, or change its area or
// height is refused. Names, equipment, furniture, openings and installations stay editable.
import { planarFaces, wallSegs, labelPoint, pointInPoly, roomInnerPolygon } from './geometry.js';

const TOL = 0.0015; // 1.5 mm

function samePoly(A, B) {
  if (!Array.isArray(A) || !Array.isArray(B)) return !A === !B;
  if (A.length !== B.length) return false;
  const near = (p, q) => Math.abs(p[0] - q[0]) < TOL && Math.abs(p[1] - q[1]) < TOL;
  return A.every((p) => B.some((q) => near(p, q))) && B.every((q) => A.some((p) => near(p, q)));
}

// the room's inner outline as the walls around it give it (null for rooms drawn as a free polygon)
function derived(walls, faces, seed) {
  const face = faces.filter((f) => pointInPoly(seed, f.poly)).sort((a, b) => a.area - b.area)[0];
  return face ? roomInnerPolygon(face.poly, walls) : null;
}

const same = (a, b) => (a ?? null) === (b ?? null);
const msg = (r, what) => `Der Raum „${r.name || 'ohne Namen'}“ ist als gemessen gesperrt – ${what}. Entsperren kannst du ihn in den Raumdetails.`;

export function lockViolation(prev, next) {
  if (!prev || !next) return null;
  const locked = (prev.rooms || []).filter((r) => r.locked);
  if (!locked.length) return null;
  const wallsSame = JSON.stringify(prev.walls || []) === JSON.stringify(next.walls || []);
  let facesPrev = null,
    facesNext = null;
  for (const r of locked) {
    const nr = (next.rooms || []).find((x) => x.id === r.id);
    if (!nr) return msg(r, 'er lässt sich nicht löschen');
    if (!nr.locked) continue; // unlocked in this change
    if (!same(r.area, nr.area)) return msg(r, 'seine Fläche bleibt, wie sie ist');
    if (!same(r.height, nr.height)) return msg(r, 'seine Raumhöhe bleibt, wie sie ist');
    if (r.height == null && (!same(prev.height, next.height) || !same(prev.slab, next.slab))) return msg(r, 'die Geschosshöhe bestimmt seine Raumhöhe');
    const polyChanged = !samePoly(r.poly, nr.poly);
    if (r.manual) {
      if (polyChanged) return msg(r, 'sein Umriss bleibt, wie er ist');
      continue;
    }
    if (!r.poly?.length || (wallsSame && !polyChanged)) continue;
    facesPrev ||= planarFaces(wallSegs(prev.walls || []));
    facesNext ||= planarFaces(wallSegs(next.walls || []));
    const seed = labelPoint(r.poly);
    const before = derived(prev.walls || [], facesPrev, seed);
    const after = derived(next.walls || [], facesNext, seed);
    if (before && (!after || !samePoly(before, after))) return msg(r, 'die Wände um ihn bleiben, wo sie sind');
    // the stored outline may only be refreshed to what the (unchanged) walls give
    if (polyChanged && !(after && samePoly(nr.poly, after))) return msg(r, 'sein Umriss bleibt, wie er ist');
  }
  return null;
}

// outbuildings keep their plan inside the site entry of the house document
export function houseLockViolation(prev, next) {
  const before = prev?.model?.context || [];
  if (!before.some((b) => (b.rooms || []).some((r) => r.locked))) return null;
  const after = next?.model?.context || [];
  const asFloor = (b) => ({ walls: b.walls || [], rooms: b.rooms || [], height: b.h ?? null, slab: null });
  for (const b of before) {
    if (!(b.rooms || []).some((r) => r.locked)) continue;
    const nb = after.find((x) => x.id === b.id);
    if (!nb) continue; // the whole building was removed on purpose
    const m = lockViolation(asFloor(b), asFloor(nb));
    if (m) return m;
  }
  return null;
}

export const lockedRooms = (floor) => (floor?.rooms || []).filter((r) => r.locked);
