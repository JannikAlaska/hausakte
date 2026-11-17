// Two residents – a man and a woman – walking through the house in the 3D model. Low-poly figures with a
// walk cycle; paths on a grid per floor (inside rooms, through doors, around furniture, never through
// walls), pauses in the rooms and now and then the stairs to another floor.
import * as THREE from 'three';
import { pointInPoly } from './geometry.js';
import { furnSize, furnType } from './furniture.js';

const CELL = 0.15; // grid size (m)
const CLEAR = 0.17; // distance to walls

// ---------- navigation grid of one floor ----------
class NavGrid {
  constructor(floor, below) {
    this.floor = floor;
    const rooms = (floor.rooms || []).filter((r) => r.poly?.length >= 3);
    this.ok = rooms.length > 0;
    if (!this.ok) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const r of rooms)
      for (const [x, y] of r.poly) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    this.x0 = minX - 0.5;
    this.y0 = minY - 0.5;
    this.nx = Math.ceil((maxX - minX + 1) / CELL);
    this.ny = Math.ceil((maxY - minY + 1) / CELL);
    const n = this.nx * this.ny;
    this.walk = new Uint8Array(n);
    this.room = new Int16Array(n).fill(-1);
    const walls = (floor.walls || []).map((w) => {
      const dx = w.b[0] - w.a[0],
        dy = w.b[1] - w.a[1];
      const L = Math.hypot(dx, dy) || 1e-9;
      return { a: w.a, u: [dx / L, dy / L], L, h: (w.t || 0.2) / 2, gaps: (w.openings || []).filter((o) => o.type === 'door' || o.type === 'opening').map((o) => [o.pos - o.w / 2 + 0.12, o.pos + o.w / 2 - 0.12]) };
    });
    // furniture (not rugs) and stairs block; on the floor above the stairwell is open
    const blocks = (floor.furniture || [])
      .filter((f) => furnType(f.type).kind !== 'rug' && !f.hidden)
      .map((f) => {
        const { w, d } = furnSize(f);
        const r = ((f.rot || 0) * Math.PI) / 180;
        return { c: [f.x, f.y], cos: Math.cos(r), sin: Math.sin(r), hw: w / 2 + 0.12, hd: d / 2 + 0.12 };
      });
    const rects = [...(floor.items || []).filter((it) => it.type === 'stairs').map((it) => stairRect(it, 0.1)), ...(below?.items || []).filter((it) => it.type === 'stairs').map((it) => holeRect(it, below.height, 0.05))];
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const p = [this.x0 + (i + 0.5) * CELL, this.y0 + (j + 0.5) * CELL];
        let ri = -1;
        for (let k = 0; k < rooms.length; k++)
          if (pointInPoly(p, rooms[k].poly)) {
            ri = k;
            break;
          }
        let door = false,
          blocked = false;
        for (const w of walls) {
          const rx = p[0] - w.a[0],
            ry = p[1] - w.a[1];
          const s = rx * w.u[0] + ry * w.u[1];
          if (s < -w.h - CLEAR || s > w.L + w.h + CLEAR) continue;
          const d = Math.abs(rx * w.u[1] - ry * w.u[0]);
          if (d > w.h + CLEAR) continue;
          if (w.gaps.some(([g0, g1]) => s > g0 && s < g1)) door = true;
          else {
            blocked = true;
            break;
          }
        }
        if (!blocked) blocked = blocks.some((b) => {
          const dx = p[0] - b.c[0],
            dy = p[1] - b.c[1];
          return Math.abs(dx * b.cos + dy * b.sin) < b.hw && Math.abs(-dx * b.sin + dy * b.cos) < b.hd;
        });
        if (!blocked) blocked = rects.some((r) => p[0] > r[0] && p[0] < r[2] && p[1] > r[1] && p[1] < r[3]);
        const k = j * this.nx + i;
        if (!blocked && (ri >= 0 || door)) {
          this.walk[k] = 1;
          this.room[k] = ri;
        }
      }
    // connected areas: everything is planned within the largest one (rooms without a door stay out)
    this.comp = new Int32Array(n).fill(-1);
    const sizes = [];
    for (let k0 = 0; k0 < n; k0++) {
      if (!this.walk[k0] || this.comp[k0] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [k0];
      this.comp[k0] = id;
      while (stack.length) {
        const k = stack.pop();
        size++;
        const i = k % this.nx,
          j = (k / this.nx) | 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            if ((!di && !dj) || !this.at(i + di, j + dj)) continue;
            if (di && dj && (!this.at(i + di, j) || !this.at(i, j + dj))) continue;
            const nk = (j + dj) * this.nx + i + di;
            if (this.comp[nk] < 0) {
              this.comp[nk] = id;
              stack.push(nk);
            }
          }
      }
      sizes.push(size);
    }
    this.main = sizes.indexOf(Math.max(...sizes, 0));
    // places to stand: walkable cells with free neighbours in the main area, per room
    this.spots = rooms.map(() => []);
    for (let j = 1; j < this.ny - 1; j++)
      for (let i = 1; i < this.nx - 1; i++) {
        const k = j * this.nx + i;
        if (!this.walk[k] || this.room[k] < 0 || this.comp[k] !== this.main) continue;
        let free = true;
        for (let dj = -2; dj <= 2 && free; dj++)
          for (let di = -2; di <= 2 && free; di++) if (!this.at(i + di, j + dj)) free = false;
        if (free) this.spots[this.room[k]].push(k);
      }
    this.rooms = rooms;
    this.ok = this.spots.some((s) => s.length);
  }
  at(i, j) {
    return i >= 0 && j >= 0 && i < this.nx && j < this.ny && this.walk[j * this.nx + i] === 1;
  }
  cellOf(p) {
    return [Math.floor((p[0] - this.x0) / CELL), Math.floor((p[1] - this.y0) / CELL)];
  }
  center(k) {
    const i = k % this.nx,
      j = (k / this.nx) | 0;
    return [this.x0 + (i + 0.5) * CELL, this.y0 + (j + 0.5) * CELL];
  }
  roomAt(p) {
    const [i, j] = this.cellOf(p);
    return i >= 0 && j >= 0 && i < this.nx && j < this.ny ? this.room[j * this.nx + i] : -1;
  }
  // nearest walkable cell within r metres (main: only in the main area)
  nearest(p, r = 1.5, main = false) {
    const [ci, cj] = this.cellOf(p);
    const R = Math.ceil(r / CELL);
    let best = null,
      bd = Infinity;
    for (let dj = -R; dj <= R; dj++)
      for (let di = -R; di <= R; di++) {
        const i = ci + di,
          j = cj + dj;
        if (!this.at(i, j) || (main && this.comp[j * this.nx + i] !== this.main)) continue;
        const d = di * di + dj * dj;
        if (d < bd) {
          bd = d;
          best = j * this.nx + i;
        }
      }
    return best;
  }
  randomSpot(exceptRoom = -1) {
    const rooms = this.spots.map((s, i) => [s, i]).filter(([s, i]) => s.length && i !== exceptRoom);
    const pool = rooms.length ? rooms : this.spots.map((s, i) => [s, i]).filter(([s]) => s.length);
    if (!pool.length) return null;
    const [s] = pool[Math.floor(Math.random() * pool.length)];
    return s[Math.floor(Math.random() * s.length)];
  }
  line(a, b) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(d / (CELL * 0.5)));
    for (let t = 0; t <= n; t++) {
      const [i, j] = this.cellOf([a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n]);
      if (!this.at(i, j)) return false;
    }
    return true;
  }
  // A* on 8 neighbours (no corner cutting), then shortened to straight stretches
  path(fromP, toK) {
    const s = this.nearest(fromP, 0.4, true) ?? this.nearest(fromP, 1);
    if (s == null || toK == null) return null;
    const N = this.nx * this.ny;
    const g = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    const tx = toK % this.nx,
      ty = (toK / this.nx) | 0;
    const hfun = (k) => {
      const dx = Math.abs((k % this.nx) - tx),
        dy = Math.abs(((k / this.nx) | 0) - ty);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    const heap = [[hfun(s), s]];
    g[s] = 0;
    const push = (f, k) => {
      heap.push([f, k]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1,
            r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    let found = false;
    while (heap.length) {
      const [, k] = pop();
      if (done[k]) continue;
      done[k] = 1;
      if (k === toK) {
        found = true;
        break;
      }
      const i = k % this.nx,
        j = (k / this.nx) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          if (!this.at(i + di, j + dj)) continue;
          if (di && dj && (!this.at(i + di, j) || !this.at(i, j + dj))) continue;
          const nk = (j + dj) * this.nx + i + di;
          const ng = g[k] + (di && dj ? 1.414 : 1);
          if (ng < g[nk]) {
            g[nk] = ng;
            prev[nk] = k;
            push(ng + hfun(nk), nk);
          }
        }
    }
    if (!found) return null;
    const cells = [];
    for (let k = toK; k !== -1; k = prev[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => this.center(k));
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.line(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}

// stairs footprint as [minX, minY, maxX, maxY], bottom and top ends (centre line) and the upward direction
function stairRect(it, pad = 0) {
  const ew = it.dir === 'e' || it.dir === 'w';
  const W = ew ? it.l : it.w,
    D = ew ? it.w : it.l;
  return [it.x - pad, it.y - pad, it.x + W + pad, it.y + D + pad];
}
// opening in the floor above: the upper part of the stairs (as in the 3D model)
function holeRect(it, height = 2.75, pad = 0) {
  if (it.hole) return [it.hole.x - pad, it.hole.y - pad, it.hole.x + it.hole.w + pad, it.hole.y + it.hole.d + pad];
  const lh = Math.min(it.l, (it.l * 2.3) / Math.max(2.3, height));
  const { x, y, w, l, dir } = it;
  const r = dir === 'w' ? [x, y, lh, w] : dir === 'e' ? [x + l - lh, y, lh, w] : dir === 's' ? [x, y + l - lh, w, lh] : [x, y, w, lh];
  return [r[0] - pad, r[1] - pad, r[0] + r[2] + pad, r[1] + r[3] + pad];
}

function stairEnds(it) {
  const cx = it.x + (it.dir === 'e' || it.dir === 'w' ? it.l / 2 : it.w / 2);
  const cy = it.y + (it.dir === 'e' || it.dir === 'w' ? it.w / 2 : it.l / 2);
  if (it.dir === 'n') return { bottom: [cx, it.y + it.l], top: [cx, it.y], up: [0, -1] };
  if (it.dir === 's') return { bottom: [cx, it.y], top: [cx, it.y + it.l], up: [0, 1] };
  if (it.dir === 'e') return { bottom: [it.x, cy], top: [it.x + it.l, cy], up: [1, 0] };
  return { bottom: [it.x + it.l, cy], top: [it.x, cy], up: [-1, 0] };
}

// ---------- figures ----------
function person(kind) {
  const man = kind === 'mann';
  const H = man ? 1.8 : 1.68;
  const M = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, flatShading: true });
  const skin = M(man ? '#dcae86' : '#e9c19f');
  const hairM = M(man ? '#4a3221' : '#8c4a25');
  const topM = M(man ? '#3c6ea6' : '#cf5f5b');
  const legM = M(man ? '#2f3644' : '#34445f');
  const shoeM = M('#26262b');
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const legLen = H * 0.47;
  const thigh = legLen * 0.52,
    shin = legLen * 0.48 - 0.05;
  const torsoLen = H * 0.29;
  const shoulder = man ? 0.2 : 0.17;
  const root = new THREE.Group();
  root.name = kind;
  root.userData.noShade = true; // not an obstacle for the PV shading analysis
  const hips = new THREE.Group();
  hips.position.y = legLen;
  root.add(hips);
  const legs = [-1, 1].map((sd) => {
    const hip = new THREE.Group();
    hip.position.set(sd * (man ? 0.095 : 0.085), 0, 0);
    hips.add(hip);
    add(hip, new THREE.CapsuleGeometry(man ? 0.068 : 0.062, thigh - 0.12, 3, 8), legM, 0, -thigh / 2, 0);
    const knee = new THREE.Group();
    knee.position.y = -thigh;
    hip.add(knee);
    add(knee, new THREE.CapsuleGeometry(man ? 0.055 : 0.05, shin - 0.1, 3, 8), legM, 0, -shin / 2, 0);
    add(knee, new THREE.BoxGeometry(0.1, 0.07, 0.24), shoeM, 0, -shin - 0.015, 0.05);
    return { hip, knee };
  });
  const torso = new THREE.Group();
  hips.add(torso);
  const body = add(torso, new THREE.CapsuleGeometry(man ? 0.15 : 0.13, torsoLen - 0.2, 4, 10), topM, 0, torsoLen / 2 + 0.03, 0);
  body.scale.set(man ? 1.3 : 1.15, 1, 0.75);
  if (!man) {
    // skirt
    add(torso, new THREE.CylinderGeometry(0.15, 0.25, 0.4, 12), topM, 0, -0.12, 0);
  }
  add(torso, new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8), skin, 0, torsoLen + 0.06, 0);
  const headR = H * 0.064;
  const head = new THREE.Group();
  head.position.y = torsoLen + 0.1 + headR;
  torso.add(head);
  add(head, new THREE.SphereGeometry(headR, 14, 10), skin);
  for (const sd of [-1, 1]) add(head, new THREE.SphereGeometry(0.012, 6, 5), M('#2a2420'), sd * 0.038, 0.01, headR * 0.92);
  const cap = add(head, new THREE.SphereGeometry(headR * 1.08, 14, 10, 0, Math.PI * 2, 0, Math.PI * (man ? 0.42 : 0.55)), hairM, 0, 0.012, -0.01);
  cap.rotation.x = -0.25;
  if (!man) {
    // long hair down the back and a ponytail
    add(head, new THREE.BoxGeometry(headR * 1.9, headR * 2.1, 0.06), hairM, 0, -headR * 0.75, -headR * 0.72);
    const tail = add(head, new THREE.CapsuleGeometry(0.035, 0.14, 3, 8), hairM, 0, -headR * 0.35, -headR * 1.18);
    tail.rotation.x = 0.35;
  }
  const arms = [-1, 1].map((sd) => {
    const sh = new THREE.Group();
    sh.position.set(sd * shoulder, torsoLen - 0.02, 0);
    sh.rotation.z = sd * 0.06;
    torso.add(sh);
    const upper = H * 0.17,
      lower = H * 0.15;
    add(sh, new THREE.CapsuleGeometry(man ? 0.05 : 0.042, upper - 0.08, 3, 8), topM, 0, -upper / 2, 0);
    const elbow = new THREE.Group();
    elbow.position.y = -upper;
    sh.add(elbow);
    add(elbow, new THREE.CapsuleGeometry(man ? 0.042 : 0.036, lower - 0.07, 3, 8), skin, 0, -lower / 2, 0);
    add(elbow, new THREE.SphereGeometry(man ? 0.05 : 0.043, 8, 6), skin, 0, -lower - 0.02, 0);
    return { sh, elbow };
  });
  return { root, hips, legs, arms, torso, head, legLen, stride: man ? 1.45 : 1.3, speed: man ? 1.15 : 1.05 };
}

// ---------- one resident ----------
class Walker {
  constructor(kind) {
    this.kind = kind;
    this.fig = person(kind);
    this.floorId = null;
    this.p = [0, 0];
    this.y = 0; // above the floor (stairs)
    this.heading = Math.random() * Math.PI * 2;
    this.phase = Math.random() * 6;
    this.move = 0; // 0 standing … 1 walking
    this.route = []; // [{p, y, floorId, switchTo}]
    this.wait = 1 + Math.random() * 2;
    this.stairsPlan = null;
  }
}

export class People {
  constructor(hs) {
    this.hs = hs;
    this.walkers = [new Walker('mann'), new Walker('frau')];
    this.visible = true;
    this.grids = new Map();
  }

  // after every rebuild of the scene: new floor groups, new grids
  attach() {
    for (const w of this.walkers) w.fig.root.parent?.remove(w.fig.root);
    this.entries = this.hs.floorEntries || [];
    this.grids = new Map();
    if (!this.visible) return;
    this.entries.forEach((e, i) => this.grids.set(e.floor.id, new NavGrid(e.floor, this.entries[i - 1]?.floor)));
    // stairs: from the floor they are drawn on up to the next floor
    this.links = [];
    this.entries.forEach((e, i) => {
      const up = this.entries[i + 1];
      if (!up) return;
      const gl = this.grids.get(e.floor.id),
        gu = this.grids.get(up.floor.id);
      if (!gl?.ok || !gu?.ok) return;
      for (const it of (e.floor.items || []).filter((x) => x.type === 'stairs')) {
        const se = stairEnds(it);
        const foot = gl.nearest([se.bottom[0] - se.up[0] * 0.45, se.bottom[1] - se.up[1] * 0.45], 1.6, true);
        const head = gu.nearest([se.top[0] + se.up[0] * 0.45, se.top[1] + se.up[1] * 0.45], 2, true);
        if (foot == null || head == null) continue;
        this.links.push({ low: e.floor.id, up: up.floor.id, bottom: se.bottom, top: se.top, foot: gl.center(foot), footK: foot, head: gu.center(head), headK: head, rise: up.floor.elevation - e.floor.elevation });
      }
    });
    // start on the ground floor (or the lowest usable one), in different rooms
    const usable = this.entries.filter((e) => this.grids.get(e.floor.id)?.ok);
    const start = usable.find((e) => Math.abs(e.floor.elevation) < 0.5) || usable[0];
    let used = -1;
    for (const w of this.walkers) {
      if (!start) break;
      if (!w.floorId || !this.grids.get(w.floorId)?.ok) {
        const g = this.grids.get(start.floor.id);
        const k = g.randomSpot(used);
        if (k == null) continue;
        w.floorId = start.floor.id;
        w.p = g.center(k);
        used = g.room[k];
        w.y = 0;
        w.route = [];
        w.stairsPlan = null;
      } else {
        // keep the place, but stay on walkable ground after the plan changed
        const g = this.grids.get(w.floorId);
        if (!w.y && g.nearest(w.p, 0.2) == null) {
          const k = g.nearest(w.p, 3) ?? g.randomSpot();
          if (k != null) w.p = g.center(k);
          w.route = [];
        }
      }
      this.place(w);
    }
  }

  place(w) {
    const e = this.entries.find((x) => x.floor.id === w.floorId);
    if (!e) return;
    if (w.fig.root.parent !== e.group) e.group.add(w.fig.root);
    w.fig.root.position.set(w.p[0], e.floor.elevation + w.y, w.p[1]);
    w.fig.root.rotation.y = w.heading;
    w.fig.root.visible = this.visible;
  }

  setVisible(on) {
    on = !!on;
    if (on === this.visible) return;
    this.visible = on;
    if (on) this.attach();
    else for (const w of this.walkers) w.fig.root.parent?.remove(w.fig.root);
  }

  // how inviting a floor is: cellar and attic only now and then
  appeal(floorId) {
    const f = this.entries.find((e) => e.floor.id === floorId)?.floor;
    if (!f) return 0;
    const rooms = f.rooms || [];
    const storage = rooms.length && rooms.every((r) => ['keller', 'dachboden', 'technik', 'abstell'].includes(r.type));
    return f.elevation < -0.5 || storage ? 0.25 : 1;
  }

  // next goal: another room on this floor, sometimes the stairs up or down
  plan(w) {
    const g = this.grids.get(w.floorId);
    if (!g?.ok) return;
    const ups = (this.links || []).filter((l) => l.low === w.floorId);
    const downs = (this.links || []).filter((l) => l.up === w.floorId);
    const other = this.walkers.find((x) => x !== w);
    // go to another floor now and then (living floors more than cellar and attic);
    // the two like to stay close to each other
    const idx = (id) => this.entries.findIndex((e) => e.floor.id === id);
    const here = this.appeal(w.floorId);
    const apart = other && other.floorId !== w.floorId;
    const chance = here < 1 ? 0.55 : apart ? 0.3 : 0.12;
    let link = null,
      dir = 0;
    if (Math.random() < chance && (ups.length || downs.length)) {
      const opts = [...ups.map((l) => [l, 1, l.up]), ...downs.map((l) => [l, -1, l.low])].map(([l, d, to]) => {
        let wgt = this.appeal(to);
        if (apart && Math.sign(idx(other.floorId) - idx(w.floorId)) === d) wgt *= 4;
        return [l, d, wgt];
      });
      let pick = Math.random() * opts.reduce((a, o) => a + o[2], 0);
      for (const o of opts) {
        pick -= o[2];
        if (pick <= 0) {
          [link, dir] = o;
          break;
        }
      }
    }
    if (link) {
      const path = g.path(w.p, dir > 0 ? link.footK : link.headK);
      if (path) {
        const route = path.map((p) => ({ p, y: 0, floorId: w.floorId }));
        if (dir > 0) {
          route.push({ p: link.bottom, y: 0, floorId: link.low });
          route.push({ p: link.top, y: link.rise, floorId: link.low, switchTo: link.up });
          route.push({ p: link.head, y: 0, floorId: link.up });
        } else {
          route.push({ p: link.top, y: 0, floorId: link.up, switchTo: link.low, yAfter: link.rise });
          route.push({ p: link.bottom, y: 0, floorId: link.low });
          route.push({ p: link.foot, y: 0, floorId: link.low });
        }
        w.route = route;
        return;
      }
    }
    // a place in another room (or, if the other one is on this floor, sometimes near them)
    let k = g.randomSpot(g.roomAt(w.p));
    if (other && other.floorId === w.floorId && !other.y && Math.random() < 0.35) {
      const near = g.nearest([other.p[0] + (Math.random() - 0.5) * 1.6, other.p[1] + (Math.random() - 0.5) * 1.6], 1);
      if (near != null) k = near;
    }
    const path = k != null ? g.path(w.p, k) : null;
    if (path) w.route = path.slice(1).map((p) => ({ p, y: 0, floorId: w.floorId }));
    else w.wait = 1;
  }

  update(dt) {
    if (!this.visible || !this.entries?.length) return;
    for (const w of this.walkers) {
      if (!w.floorId) continue;
      const f = w.fig;
      if (w.wait > 0) {
        w.wait -= dt;
        if (w.wait <= 0 && !w.route.length) this.plan(w);
      } else if (!w.route.length) {
        // arrived: stand a while
        w.wait = 2 + Math.random() * 6;
      }
      let moving = false;
      if (w.wait <= 0 && w.route.length) {
        const t = w.route[0];
        const dx = t.p[0] - w.p[0],
          dy = t.p[1] - w.p[1];
        const d = Math.hypot(dx, dy);
        const onStairs = t.y !== w.y || (t.switchTo && t.yAfter != null);
        const v = f.speed * (onStairs ? 0.6 : 1) * dt;
        if (d > 1e-4) {
          // turn towards the goal, slow down for sharp turns
          const want = Math.atan2(dx, dy);
          let da = want - w.heading;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          w.heading += da * Math.min(1, dt * 8);
          const step = Math.min(d, v * (Math.abs(da) > 1.2 ? 0.3 : 1));
          w.p = [w.p[0] + (dx / d) * step, w.p[1] + (dy / d) * step];
          if (t.y !== w.y) {
            const left = d - step;
            const total = left + step;
            w.y += ((t.y - w.y) * step) / Math.max(total, 1e-6);
          }
          w.phase += (step / f.stride) * Math.PI * 2;
          moving = true;
        }
        if (d - Math.min(d, v) < 0.02) {
          w.p = [...t.p];
          w.y = t.y;
          w.route.shift();
          if (t.switchTo) {
            w.floorId = t.switchTo;
            w.y = t.yAfter ?? 0;
          }
          // going down: from the top of the stairs on the lower floor's level
          if (t.switchTo && t.yAfter != null && w.route[0]) w.route[0] = { ...w.route[0], y: 0 };
        }
      }
      w.move += ((moving ? 1 : 0) - w.move) * Math.min(1, dt * 6);
      this.animate(w, dt);
      this.place(w);
    }
  }

  animate(w, dt) {
    const f = w.fig;
    const a = w.move;
    const s = Math.sin(w.phase),
      c = Math.cos(w.phase);
    f.legs[0].hip.rotation.x = -s * 0.5 * a;
    f.legs[1].hip.rotation.x = s * 0.5 * a;
    f.legs[0].knee.rotation.x = (0.05 + Math.max(0, c) * 0.85) * a;
    f.legs[1].knee.rotation.x = (0.05 + Math.max(0, -c) * 0.85) * a;
    f.arms[0].sh.rotation.x = s * 0.4 * a;
    f.arms[1].sh.rotation.x = -s * 0.4 * a;
    f.arms[0].elbow.rotation.x = -0.15 - 0.3 * a * Math.max(0, -s);
    f.arms[1].elbow.rotation.x = -0.15 - 0.3 * a * Math.max(0, s);
    f.hips.position.y = f.legLen - 0.035 * a * Math.abs(s);
    f.torso.rotation.y = s * 0.09 * a;
    // standing: breathe and look around a little
    w.idleT = (w.idleT || 0) + dt;
    f.head.rotation.y = (1 - a) * Math.sin(w.idleT * 0.5) * 0.45;
    f.torso.position.y = (1 - a) * Math.sin(w.idleT * 1.6) * 0.005;
  }
}
