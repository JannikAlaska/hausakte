// Three.js house model generated from the plan data.
// World axes: X = plan x (east), Z = plan y (south), Y = height (m). EG finished floor = 0.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { outerOutline, outlineFromWalls, pointInPoly, labelPoint, polyCentroid, polyArea, norm, sub, perp, offsetPolygon, bbox, planarFaces, wallSegs, distToPolyEdges } from './geometry.js';
import { roofModel, sectionClipPlanes, pvPotential, sectionGeometry } from './roof.js';
import { roomType, projectKind, status as statusOf, ROOM_COLORS, lineKind, fixtureKind } from './catalog.js';
import { sortFloors, roomArea, isDone } from './metrics.js';
import { sunPosition, sunVector, yearSteps, poa, houseGeo, shadeColor } from './solar.js';
import { fmtFixed, fmtDayMonth, todayISO, escapeHtml } from './util.js';



const C = (hex) => new THREE.Color(hex);
const WHITE = new THREE.Color('#ffffff');
const cssVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (!m.userData.shared) m.dispose();
    }
    if (o.isCSS2DObject && o.element?.parentNode) o.element.parentNode.removeChild(o.element);
  });
}

// Box between s0..s1 along the wall, y0..y1 high, thickness t; vertex-colored per face.
function wallBox(wall, s0, s1, y0, y1, t, colors) {
  const L = s1 - s0,
    H = y1 - y0;
  if (L < 0.005 || H < 0.005) return null;
  const g = new THREE.BoxGeometry(L, H, t).toNonIndexed();
  const dx = wall.b[0] - wall.a[0],
    dz = wall.b[1] - wall.a[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len,
    uz = dz / len;
  const mid = (s0 + s1) / 2;
  g.rotateY(-Math.atan2(dz, dx));
  g.translate(wall.a[0] + ux * mid, y0 + H / 2, wall.a[1] + uz * mid);
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (6 vertices each after toNonIndexed)
  const W = WHITE;
  const faceCols = [colors.end || W, colors.end || W, colors.top || W, colors.bottom || W, colors.pz || W, colors.nz || W];
  const arr = new Float32Array(36 * 3);
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 6; v++) {
      const c = faceCols[f];
      arr.set([c.r, c.g, c.b], (f * 6 + v) * 3);
    }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

function paintGeometry(g, color) {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

// Box positioned inside a wall opening (glass, frames, door leaves).
function openingBox(wall, sCenter, width, y0, height, depth, offset = 0) {
  const g = new THREE.BoxGeometry(width, height, depth);
  const dx = wall.b[0] - wall.a[0],
    dz = wall.b[1] - wall.a[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len,
    uz = dz / len;
  const nx = -uz,
    nz = ux;
  g.rotateY(-Math.atan2(dz, dx));
  g.translate(wall.a[0] + ux * sCenter + nx * offset, y0 + height / 2, wall.a[1] + uz * sCenter + nz * offset);
  return g;
}

function shapeFromPoly(poly) {
  const s = new THREE.Shape();
  poly.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
  s.closePath();
  return s;
}

function slabGeometry(outline, thickness, holes = []) {
  const shape = shapeFromPoly(outline);
  for (const h of holes) {
    const path = new THREE.Path();
    h.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
    path.closePath();
    shape.holes.push(path);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // plan y -> world z, extrusion downward
  return g;
}

// Ceiling opening above a stair: the top end of the run, long enough for ~2.3 m headroom.
function stairHole(it, height = 2.75) {
  if (it.hole) return [[it.hole.x, it.hole.y], [it.hole.x + it.hole.w, it.hole.y], [it.hole.x + it.hole.w, it.hole.y + it.hole.d], [it.hole.x, it.hole.y + it.hole.d]];
  const lh = Math.min(it.l, (it.l * 2.3) / Math.max(2.3, height));
  const { x, y, w, l, dir } = it;
  let r;
  if (dir === 'w') r = [x, y, lh, w];
  else if (dir === 'e') r = [x + l - lh, y, lh, w];
  else if (dir === 's') r = [x, y + l - lh, w, lh];
  else r = [x, y, w, lh];
  return [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0] + r[2], r[1] + r[3]], [r[0], r[1] + r[3]]];
}

function quadGeometry(a, b, width, y) {
  const d = norm(sub(b, a));
  const n = perp(d);
  const h = width / 2;
  const p = [add2(a, n, h), add2(b, n, h), add2(b, n, -h), add2(a, n, -h)];
  const g = new THREE.BufferGeometry();
  const v = [p[0], p[1], p[2], p[0], p[2], p[3]].flatMap((q) => [q[0], y, q[1]]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
const add2 = (p, n, s) => [p[0] + n[0] * s, p[1] + n[1] * s];

function stairRect(it) {
  const { x, y, w, l, dir } = it;
  const horizontal = dir === 'e' || dir === 'w';
  return horizontal
    ? [[x, y], [x + l, y], [x + l, y + w], [x, y + w]]
    : [[x, y], [x + w, y], [x + w, y + l], [x, y + l]];
}

// Prism from a planar 3D polygon (plan coords [x,y,z]) extruded along dir by thickness.
function prismGeometry(pts3, dir, thickness, uvAxes) {
  let P = pts3.map(([x, y, z]) => new THREE.Vector3(x, z, y));
  const D = new THREE.Vector3(dir[0], dir[2], dir[1]).multiplyScalar(thickness);
  // wind P so that its face normal points away from the extrusion direction
  const nw = new THREE.Vector3();
  for (let i = 0; i < P.length; i++) {
    const a = P[i],
      b = P[(i + 1) % P.length];
    nw.x += (a.y - b.y) * (a.z + b.z);
    nw.y += (a.z - b.z) * (a.x + b.x);
    nw.z += (a.x - b.x) * (a.y + b.y);
  }
  if (nw.dot(D) > 0) P = P.reverse();
  const T = P.map((p) => p.clone().add(D));
  const pos = [],
    uv = [];
  const groups = [];
  const tri = (a, b, c, uva, uvb, uvc) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    uv.push(...(uva || [0, 0]), ...(uvb || [0, 0]), ...(uvc || [0, 0]));
  };
  const uvOf = (p) => {
    if (!uvAxes) return [0, 0];
    const d = p.clone().sub(P[0]);
    return [d.dot(uvAxes.u) / uvAxes.su, d.dot(uvAxes.v) / uvAxes.sv];
  };
  // top (fan)
  let start = 0;
  for (let i = 1; i < T.length - 1; i++) tri(T[0], T[i + 1], T[i], uvOf(P[0]), uvOf(P[i + 1]), uvOf(P[i]));
  groups.push([start, pos.length / 3 - start, 0]);
  start = pos.length / 3;
  for (let i = 1; i < P.length - 1; i++) tri(P[0], P[i], P[i + 1]);
  for (let i = 0; i < P.length; i++) {
    const j = (i + 1) % P.length;
    tri(P[i], T[j], P[j]);
    tri(P[i], T[i], T[j]);
  }
  groups.push([start, pos.length / 3 - start, 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  for (const [s, c, m] of groups) g.addGroup(s, c, m);
  g.computeVertexNormals();
  return g;
}

// Outlet, switch, tap … as a small plate on the wall face (rot = direction the face points to), lamps as a ceiling disc.
function fixtureMesh(q) {
  const k = fixtureKind(q.kind);
  const off = q.status === 'stillgelegt',
    planned = q.status === 'geplant';
  const mat = new THREE.MeshStandardMaterial({
    color: off ? '#9aa0a8' : k.color, emissive: off ? '#000000' : k.color, emissiveIntensity: 0.5, roughness: 0.5,
    transparent: planned || off, opacity: planned ? 0.6 : off ? 0.5 : 1,
  });
  const grp = new THREE.Group();
  if (q.kind === 'lampe') {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.07, 20), mat);
    disc.position.y = -0.04;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#ffd36b', emissiveIntensity: 0.9 }));
    bulb.position.y = -0.1;
    grp.add(disc, bulb);
  } else {
    const n = Math.max(1, Math.min(6, q.count || 1));
    // drawn a bit larger than real (8 cm) so they stay visible in the house view
    const w = 0.12 * n - 0.015 * (n - 1);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.03), mat);
    plate.position.z = 0.015;
    grp.add(plate);
    if (q.kind === 'wasser' || q.kind === 'gas') {
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), mat);
      spout.rotation.x = Math.PI / 2;
      spout.position.z = 0.1;
      grp.add(spout);
    }
    if (q.rot != null) {
      const a = (q.rot * Math.PI) / 180;
      grp.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
    }
  }
  grp.traverse((o) => {
    if (o.isMesh) o.renderOrder = 5;
  });
  return grp;
}

// Round pipe along a polyline of [x, y, z] plan points (y = plan y, z = height above the floor).
const UP = new THREE.Vector3(0, 1, 0);
function lineGeometry(pts, r) {
  const geos = [];
  const V = pts.map((q) => new THREE.Vector3(q[0], q[2] ?? 0, q[1]));
  for (let i = 1; i < V.length; i++) {
    const a = V[i - 1],
      b = V[i];
    const L = a.distanceTo(b);
    if (L < 0.005) continue;
    const g = new THREE.CylinderGeometry(r, r, L, 10, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
    g.applyQuaternion(q);
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    geos.push(g);
  }
  // joints and end caps
  V.forEach((v, i) => {
    if (i > 0 && v.distanceTo(V[i - 1]) < 0.005) return;
    const g = new THREE.SphereGeometry(r * 1.08, 10, 6);
    g.translate(v.x, v.y, v.z);
    geos.push(g);
  });
  if (!geos.length) return null;
  const m = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
  geos.forEach((g) => g.dispose());
  return m;
}

function tileTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = 'rgba(0,0,0,0.16)';
  for (let r = 0; r < 4; r++) x.fillRect(0, r * 32 + 28, 128, 4);
  x.fillStyle = 'rgba(0,0,0,0.07)';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) x.fillRect(c * 32 + (r % 2) * 16, r * 32, 2, 28);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function panelTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 96;
  const x = cv.getContext('2d');
  x.fillStyle = '#1e2c4a';
  x.fillRect(0, 0, 64, 96);
  x.strokeStyle = 'rgba(160,190,240,0.35)';
  x.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    x.beginPath();
    x.moveTo((i * 64) / 6, 0);
    x.lineTo((i * 64) / 6, 96);
    x.stroke();
  }
  for (let j = 1; j < 10; j++) {
    x.beginPath();
    x.moveTo(0, (j * 96) / 10);
    x.lineTo(64, (j * 96) / 10);
    x.stroke();
  }
  x.strokeStyle = '#d9dee8';
  x.lineWidth = 3;
  x.strokeRect(1.5, 1.5, 61, 93);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeLabel(html, cls, onClick) {
  const el = document.createElement('div');
  el.className = 'tag3d ' + (cls || '');
  el.innerHTML = html;
  if (onClick) {
    el.classList.add('clickable');
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
  }
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 1);
  return obj;
}

export class HouseScene {
  constructor(container, opts = {}) {
    this.el = container;
    this.opts = opts;
    this.view = { mode: 'all', floorId: null, showRoof: true, showLabels: true, showLines: false };
    this.selection = null;
    this.highlight = null;
    this.insets = { left: 0, right: 0, top: 0, bottom: 0 };
    this.floorEntries = [];
    this.labels = [];
    this.shared = {};
    this.clock = new THREE.Clock();

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.localClippingEnabled = true;
    container.appendChild(r.domElement);
    r.domElement.className = 'scene-canvas';

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'scene-labels';
    container.appendChild(this.labelRenderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.5, 900);
    this.camera.position.set(34, 30, 42);

    const ctl = (this.controls = new OrbitControls(this.camera, r.domElement));
    ctl.enableDamping = true;
    ctl.dampingFactor = 0.085;
    ctl.maxPolarAngle = 1.42;
    ctl.minDistance = 6;
    ctl.maxDistance = 220;
    ctl.screenSpacePanning = true;
    ctl.zoomSpeed = 0.9;
    ctl.addEventListener('start', () => (this.camAnim = null));

    this.hemi = new THREE.HemisphereLight(0xf4f2ff, 0xd8d2c4, 1.55);
    this.scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff6ea, 2.1));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);

    this.envGroup = new THREE.Group();
    this.houseGroup = new THREE.Group();
    this.scene.add(this.envGroup, this.houseGroup);

    this.tileTex = tileTexture();
    this.panelTex = panelTexture();
    this.makeSharedMaterials();
    this.setTheme();

    this.raycaster = new THREE.Raycaster();
    this.bindPointer();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    r.setAnimationLoop(() => this.tick());
  }

  makeSharedMaterials() {
    const sh = (m) => {
      m.userData.shared = true;
      return m;
    };
    this.mats = {
      glass: sh(new THREE.MeshStandardMaterial({ color: '#2f4f86', roughness: 0.18, metalness: 0.25, emissive: '#000000' })),
      frame: sh(new THREE.MeshStandardMaterial({ color: '#f6f6f4', roughness: 0.6 })),
      door: sh(new THREE.MeshStandardMaterial({ color: '#5d6574', roughness: 0.55 })),
      slabCap: sh(new THREE.MeshStandardMaterial({ color: '#ecebe6', roughness: 0.95 })),
      slabSide: sh(new THREE.MeshStandardMaterial({ color: '#dcdad4', roughness: 0.95 })),
      stairs: sh(new THREE.MeshStandardMaterial({ color: '#c9b293', roughness: 0.8 })),
      roofSide: sh(new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 0.9 })),
      scaffoldPole: sh(new THREE.MeshStandardMaterial({ color: '#c7cbd6', roughness: 0.6, metalness: 0.3 })),
      scaffoldDeck: sh(new THREE.MeshStandardMaterial({ color: '#f0a43a', roughness: 0.7 })),
      net: sh(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })),
      pvSolid: sh(new THREE.MeshStandardMaterial({ map: this.panelTex, roughness: 0.3, metalness: 0.35 })),
      pvGhost: sh(new THREE.MeshStandardMaterial({ map: this.panelTex, roughness: 0.4, transparent: true, opacity: 0.55, depthWrite: false, emissive: '#3a7bd5', emissiveIntensity: 0.25 })),
      trunk: sh(new THREE.MeshStandardMaterial({ color: '#b39a80', roughness: 0.9 })),
      canopy: sh(new THREE.MeshStandardMaterial({ color: '#9fd29a', roughness: 0.85, flatShading: true })),
      canopy2: sh(new THREE.MeshStandardMaterial({ color: '#86c68a', roughness: 0.85, flatShading: true })),
      fence: sh(new THREE.MeshStandardMaterial({ color: '#d7d9e2', roughness: 0.8 })),
      hedge: sh(new THREE.MeshStandardMaterial({ color: '#a9d6a0', roughness: 0.9, flatShading: true })),
      paving: sh(new THREE.MeshStandardMaterial({ color: '#e7e5ee', roughness: 0.95 })),
      terrace: sh(new THREE.MeshStandardMaterial({ color: '#e2d6c4', roughness: 0.9 })),
    };
  }

  // ---------- theme ----------
  setTheme() {
    const bg = cssVar('--scene-bg', '#eceef7');
    this.scene.background = C(bg);
    this.scene.fog = new THREE.Fog(bg, 90, 260);
    this.groundColor = cssVar('--scene-ground', '#e4e6f1');
    this.plotColor = cssVar('--scene-plot', '#e3eedc');
    this.roadColor = cssVar('--scene-road', '#cfd3ea');
    this.accent = cssVar('--accent', '#17936a');
    const dark = cssVar('--scene-dark', '0') === '1';
    this.hemiBase = dark ? 1.0 : 1.55;
    this.sunBase = dark ? 1.5 : 2.1;
    this.applySun();
    if (this.data) this.buildEnvironment();
  }

  // ---------- data ----------
  setData(data) {
    this.data = data;
    this.rebuild();
  }

  rebuild() {
    const data = this.data;
    if (!data) return;
    for (const c of [...this.houseGroup.children]) {
      this.houseGroup.remove(c);
      disposeTree(c);
    }
    this.floorEntries = [];
    this.labels = [];
    this.roomMeshes = new Map();
    this.pickables = [];
    const floors = sortFloors(data.floors || []);
    this.floors = floors;
    if (!floors.length) {
      this.buildEnvironment();
      return;
    }
    const roofs = roofModel(data.house, floors);
    this.roofs = roofs;
    const facade = C(data.house?.model?.facadeColor || '#f1efe9');
    const interior = C('#fbfbf9');
    const top = C('#cfd0d6');
    const reveal = C('#e9e8e4');

    floors.forEach((f, i) => {
      const entry = this.buildStorey(f, { below: floors[i - 1], index: i, roofs, facade, interior, top, reveal });
      this.houseGroup.add(entry.group);
      this.floorEntries.push(entry);
    });

    this.buildRoof(floors, roofs, facade);
    this.buildScaffold(floors, roofs);
    this.buildProjectLabels(floors, roofs);
    this.computeBounds();
    this.buildEnvironment();
    this.applyView(true);
    this.applySelection();
    if (!this.framed) {
      this.framed = true;
      this.resetView(true);
      if (this.view.mode !== 'all') this.frameView();
    }
  }

  // One storey (or an outbuilding drawn with walls): slab, walls with openings, rooms, stairs, lines and connection points.
  buildStorey(f, { below = null, index = 0, roofs = [], facade, interior, top, reveal, ctx = false }) {
    const group = new THREE.Group();
    group.userData.floorId = f.id;
    const pick = (m) => !ctx && this.pickables.push(m);
    const entry = { floor: f, group, offset: 0, target: 0, visible: true, wantVisible: true, wallMats: [], labelObjs: [], roomLabels: [], index };
    const outline = outlineFromWalls(f.walls || []);
    const outer = outerOutline(f.walls || []);
    const wallTop = f.height - (f.slab ?? 0.2);
    const ridgeTop = roofs.length ? Math.max(...roofs.map((r) => r.geo.ridgeZ)) - f.elevation : wallTop;

    // slab under this floor (with stair openings from the floor below)
    if (outer) {
      const holes = (below?.items || []).filter((it) => it.type === 'stairs').map((it) => stairHole(it, below.height));
      const slab = new THREE.Mesh(slabGeometry(outer, f.slab ?? 0.2, holes), [this.mats.slabCap, this.mats.slabSide]);
      slab.position.y = f.elevation;
      slab.castShadow = slab.receiveShadow = true;
      slab.userData.pick = { type: 'floor', floorId: f.id };
      group.add(slab);
      pick(slab);
    }

    // extra slabs (balconies, porches) with their top at floor level
    for (const it of f.items || []) {
      if (it.type !== 'slab' || !it.poly || it.poly.length < 3) continue;
      const sl = new THREE.Mesh(slabGeometry(it.poly, it.t ?? 0.2), [this.mats.slabCap, this.mats.slabSide]);
      sl.position.y = f.elevation;
      sl.castShadow = sl.receiveShadow = true;
      group.add(sl);
    }

    const extWalls = (f.walls || []).filter((w) => w.ext);
    const extFaces = extWalls.length ? planarFaces(wallSegs(extWalls)) : [];
    const insideExt = (q) => (extFaces.length ? extFaces.some((fc) => pointInPoly(q, fc.poly)) : outline && pointInPoly(q, outline));

    // walls, grouped by the roof section that clips them
    const clip = !!f.underRoof && roofs.length > 0;
    const buckets = new Map();
    const frames = [],
      glass = [],
      doors = [];
    for (const w of f.walls || []) {
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      if (L < 0.01) continue;
      const ext = !!w.ext;
      const e = ext ? w.t / 2 : 0;
      let H = w.h ?? wallTop;
      if (clip) H = ext ? Math.max(H, ridgeTop) : Math.max(H, Math.min(ridgeTop, w.h ?? wallTop));
      let pz = interior,
        nz = interior;
      if (ext && (outline || extFaces.length)) {
        const dir = norm(sub(w.b, w.a));
        const nrm = perp(dir);
        const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
        const test = [mid[0] + nrm[0] * (w.t / 2 + 0.05), mid[1] + nrm[1] * (w.t / 2 + 0.05)];
        const plusInside = insideExt(test);
        const outside = w.color ? C(w.color) : facade;
        pz = plusInside ? interior : outside;
        nz = plusInside ? outside : interior;
      } else if (w.color) {
        pz = nz = C(w.color);
      }
      const cols = { top, bottom: top, end: reveal, pz, nz };
      let sec = 0;
      if (clip && roofs.length > 1) {
        const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
        const k = roofs.findIndex((r) => mid[0] >= r.sec.x - 0.5 && mid[0] <= r.sec.x + r.sec.w + 0.5 && mid[1] >= r.sec.y - 0.5 && mid[1] <= r.sec.y + r.sec.d + 0.5);
        sec = k < 0 ? 0 : k;
      }
      if (!buckets.has(sec)) buckets.set(sec, []);
      const geos = buckets.get(sec);
      const ops = [...(w.openings || [])].sort((a, b) => a.pos - b.pos);
      let cur = -e;
      for (const o of ops) {
        const o0 = Math.max(0, o.pos - o.w / 2),
          o1 = Math.min(L, o.pos + o.w / 2);
        if (o1 <= o0) continue;
        if (o0 > cur) geos.push(wallBox(w, cur, o0, 0, H, w.t, cols));
        const sill = o.type === 'window' ? o.sill ?? 0.9 : 0;
        const oh = Math.min(o.h ?? 2.0, H - sill);
        if (sill > 0) geos.push(wallBox(w, o0, o1, 0, sill, w.t, cols));
        if (sill + oh < H) geos.push(wallBox(w, o0, o1, sill + oh, H, w.t, cols));
        const sc = (o0 + o1) / 2,
          ow = o1 - o0;
        if (o.type === 'window') {
          glass.push(openingBox(w, sc, ow - 0.1, sill + 0.05, oh - 0.1, 0.04));
          frames.push(openingBox(w, sc, ow, sill, 0.06, Math.min(w.t, 0.12)));
          frames.push(openingBox(w, sc, ow, sill + oh - 0.06, 0.06, Math.min(w.t, 0.12)));
          frames.push(openingBox(w, o0 + 0.03, 0.06, sill, oh, Math.min(w.t, 0.12)));
          frames.push(openingBox(w, o1 - 0.03, 0.06, sill, oh, Math.min(w.t, 0.12)));
          if (ow > 1.3) frames.push(openingBox(w, sc, 0.06, sill, oh, Math.min(w.t, 0.1)));
        } else if (o.type === 'door' && ext) {
          doors.push(openingBox(w, sc, ow - 0.08, 0, oh - 0.04, 0.06));
        }
        cur = o1;
      }
      if (L + e > cur) geos.push(wallBox(w, cur, L + e, 0, H, w.t, cols));
    }
    for (const [secIdx, geos] of buckets) {
      const list = geos.filter(Boolean);
      if (!list.length) continue;
      const merged = mergeGeometries(list);
      list.forEach((g) => g.dispose());
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, emissive: '#000000' });
      if (clip) {
        const planes = sectionClipPlanes(roofs[secIdx].geo).map((p) => ({ base: p, plane: new THREE.Plane() }));
        mat.clippingPlanes = planes.map((p) => p.plane);
        mat.clipShadows = true;
        entry.clipPlanes = (entry.clipPlanes || []).concat(planes);
      }
      const mesh = new THREE.Mesh(merged, mat);
      mesh.position.y = f.elevation;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.pick = { type: 'floor', floorId: f.id };
      group.add(mesh);
      entry.wallMats.push(mat);
      pick(mesh);
    }
    const addMerged = (geos, mat) => {
      if (!geos.length) return;
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      geos.forEach((g) => g.dispose());
      m.position.y = f.elevation;
      m.castShadow = true;
      group.add(m);
    };
    addMerged(glass, this.mats.glass);
    addMerged(frames, this.mats.frame);
    addMerged(doors, this.mats.door);

    // rooms
    for (const room of f.rooms || []) {
      if (!room.poly || room.poly.length < 3) continue;
      const g = new THREE.ShapeGeometry(shapeFromPoly(room.poly));
      g.rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: ROOM_COLORS[room.type] || ROOM_COLORS.sonstiges, roughness: 1, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, emissive: '#000000',
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.y = f.elevation + 0.012;
      mesh.receiveShadow = true;
      mesh.userData.pick = { type: 'room', floorId: f.id, roomId: room.id };
      group.add(mesh);
      pick(mesh);
      if (ctx) {
        entry.wallMats.push(mat);
        continue;
      }
      this.roomMeshes.set(room.id, { mesh, mat, base: mat.color.clone(), floorId: f.id });
      const lp = labelPoint(room.poly);
      const lbl = makeLabel(
        `<b>${escapeHtml(room.name || roomType(room.type).name)}</b><span>${fmtFixed(roomArea(room), 1)} m²</span>`,
        'room',
        () => this.opts.onPick?.({ type: 'room', floorId: f.id, roomId: room.id }),
      );
      lbl.position.set(lp[0], f.elevation + 0.3, lp[1]);
      group.add(lbl);
      entry.roomLabels.push(lbl);
    }

    // stairs
    for (const it of f.items || []) {
      if (it.type !== 'stairs') continue;
      const steps = Math.max(3, Math.round(f.height / 0.18));
      const rise = f.height / steps;
      const run = it.l / steps;
      const geos = [];
      for (let k = 0; k < steps; k++) {
        const h = rise * (k + 1);
        let gx, gz, sx, sz;
        if (it.dir === 'n') [gx, gz, sx, sz] = [it.x + it.w / 2, it.y + it.l - run * (k + 0.5), it.w, run];
        else if (it.dir === 's') [gx, gz, sx, sz] = [it.x + it.w / 2, it.y + run * (k + 0.5), it.w, run];
        else if (it.dir === 'e') [gx, gz, sx, sz] = [it.x + run * (k + 0.5), it.y + it.w / 2, run, it.w];
        else [gx, gz, sx, sz] = [it.x + it.l - run * (k + 0.5), it.y + it.w / 2, run, it.w];
        const tread = new THREE.BoxGeometry(sx, 0.05, sz);
        tread.translate(gx, h - 0.025, gz);
        const riser = new THREE.BoxGeometry(sx * 0.96, rise, sz);
        riser.translate(gx, h - rise / 2 - 0.05, gz);
        geos.push(tread, riser);
      }
      const m = new THREE.Mesh(mergeGeometries(geos), this.mats.stairs);
      geos.forEach((g) => g.dispose());
      m.position.y = f.elevation;
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }

    // installation lines and connection points (only shown in the x-ray view)
    const lines = (f.lines || []).filter((l) => (l.pts || []).length >= 2);
    const points = f.points || [];
    if (lines.length || points.length) {
      const lg = new THREE.Group();
      for (const l of lines) {
        const k = lineKind(l.kind);
        const g = lineGeometry(l.pts, k.r * 1.6);
        if (!g) continue;
        const planned = l.status === 'geplant',
          off = l.status === 'stillgelegt';
        const mat = new THREE.MeshStandardMaterial({
          color: off ? '#9aa0a8' : k.color, emissive: off ? '#000000' : k.color, emissiveIntensity: 0.55, roughness: 0.45, metalness: 0.1,
          transparent: planned || off, opacity: planned ? 0.6 : off ? 0.5 : 1,
        });
        const m = new THREE.Mesh(g, mat);
        m.position.y = f.elevation;
        m.renderOrder = 4;
        lg.add(m);
      }
      for (const q of points) {
        const m = fixtureMesh(q);
        m.position.set(q.x, f.elevation + (q.z ?? 0.3), q.y);
        lg.add(m);
      }
      lg.visible = !!this.view.showLines;
      lg.userData.noShade = true;
      lg.userData.noXray = true;
      group.add(lg);
      entry.lineGroup = lg;
    }

    // floor label (explode view)
    const ol = outer || outline;
    if (ol && !ctx) {
      const bb = bbox(ol);
      const lbl = makeLabel(
        `<i>${escapeHtml(f.short || '')}</i><b>${escapeHtml(f.name || '')}</b><span>${(f.rooms || []).length} Räume</span>`,
        'floor',
        () => this.opts.onPick?.({ type: 'floor', floorId: f.id }),
      );
      lbl.position.set(bb.minX - 0.4, f.elevation + 0.2, bb.maxY + 0.4);
      group.add(lbl);
      entry.floorLabel = lbl;
    }

    return entry;
  }

  buildRoof(floors, roofs, facade) {
    const group = new THREE.Group();
    const entry = { group, offset: 0, target: 0, visible: true, wantVisible: true };
    const topFloor = floors[floors.length - 1];
    const roofCol = C(this.data.house?.model?.roofColor || '#6b5f5a');
    this.roofTopMat = new THREE.MeshStandardMaterial({ color: roofCol, map: this.tileTex, roughness: 0.85, emissive: '#000000' });
    const gableMat = new THREE.MeshStandardMaterial({ color: facade, roughness: 0.92, emissive: '#000000' });
    entry.gableMat = gableMat;

    // ceiling slab over the top floor
    const outer = outerOutline(topFloor.walls || []);
    if (outer) {
      const slabT = topFloor.slab ?? 0.2;
      const slab = new THREE.Mesh(slabGeometry(outer, slabT), [this.mats.slabCap, this.mats.slabSide]);
      slab.position.y = topFloor.elevation + topFloor.height;
      slab.castShadow = slab.receiveShadow = true;
      if (topFloor.underRoof && roofs.length) {
        const planes = roofs.flatMap((r) => sectionClipPlanes(r.geo)).map((p) => ({ base: p, plane: new THREE.Plane() }));
        const mats = [this.mats.slabCap.clone(), this.mats.slabSide.clone()];
        mats.forEach((m) => {
          m.userData.shared = false;
          m.clippingPlanes = planes.map((p) => p.plane);
          // without this the uncut slab casts a large shadow onto the roof
          m.clipShadows = true;
        });
        slab.material = mats;
        entry.clipPlanes = planes;
      }
      group.add(slab);
    }

    for (const { sec, geo } of roofs) {
      for (const s of geo.slopes) {
        const n = s.normal;
        const nW = new THREE.Vector3(n[0], n[2], n[1]);
        let u = Math.hypot(n[0], n[1]) < 1e-6 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-n[1], 0, n[0]).normalize();
        const v = new THREE.Vector3().crossVectors(nW, u).normalize();
        const g = prismGeometry(s.pts, s.normal, geo.type === 'flat' ? 0.3 : 0.26, { u, v, su: 1.3, sv: 1.3 });
        const mesh = new THREE.Mesh(g, [this.roofTopMat, this.mats.roofSide]);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.pick = { type: 'roof', sectionId: sec.id };
        group.add(mesh);
        this.pickables.push(mesh);
      }
      const cx = sec.x + sec.w / 2,
        cy = sec.y + sec.d / 2;
      geo.gables.forEach((gpts, gi) => {
        const c = gpts.reduce((a, p) => [a[0] + p[0] / gpts.length, a[1] + p[1] / gpts.length], [0, 0]);
        const inward = norm([cx - c[0], cy - c[1]]);
        const g = prismGeometry(gpts, [inward[0], inward[1], 0], 0.3);
        const gc = (sec.gableColors || [])[gi];
        const gm = gc ? new THREE.MeshStandardMaterial({ color: gc, roughness: 0.92 }) : gableMat;
        const mesh = new THREE.Mesh(g, [gm, gm]);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
      });
      if (geo.type === 'flat') {
        const o = sec.overhang ?? 0.1;
        const ring = [
          [sec.x - o, sec.y - o],
          [sec.x + sec.w + o, sec.y - o],
          [sec.x + sec.w + o, sec.y + sec.d + o],
          [sec.x - o, sec.y + sec.d + o],
        ];
        for (let i = 0; i < 4; i++) {
          const a = ring[i],
            b = ring[(i + 1) % 4];
          const wall = { a, b };
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const gb = paintGeometry(wallBox(wall, 0, L, 0, 0.35, 0.2, { top: facade, bottom: facade, end: facade, pz: facade, nz: facade }), facade);
          const m = new THREE.Mesh(gb, gableMat);
          m.position.y = geo.base + 0.4;
          m.castShadow = true;
          group.add(m);
        }
      }
    }

    // chimneys from the top floor up through the roof
    for (const ch of this.data.house?.model?.chimneys || []) {
      const z0 = ch.base ?? topFloor.elevation;
      const hgt = (ch.top ?? z0 + 4) - z0;
      if (hgt <= 0) continue;
      const g = new THREE.BoxGeometry(ch.w ?? 0.5, hgt, ch.d ?? 0.5);
      g.translate(ch.x + (ch.w ?? 0.5) / 2, z0 + hgt / 2, ch.y + (ch.d ?? 0.5) / 2);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: ch.color || '#9a5b48', roughness: 0.9 }));
      m.castShadow = true;
      group.add(m);
      const cap = new THREE.BoxGeometry((ch.w ?? 0.5) + 0.12, 0.08, (ch.d ?? 0.5) + 0.12);
      cap.translate(ch.x + (ch.w ?? 0.5) / 2, z0 + hgt + 0.04, ch.y + (ch.d ?? 0.5) / 2);
      group.add(new THREE.Mesh(cap, this.mats.scaffoldPole));
    }

    // PV modules for PV projects
    const pvProjects = (this.data.projects || []).filter((p) => p.kind === 'pv' && p.status !== 'pausiert');
    if (pvProjects.length) {
      const done = pvProjects.some(isDone);
      const pot = pvPotential(this.data.house, floors).filter((p) => p.factor >= 0.8 && p.modules > 0);
      const pos = [],
        uv = [];
      for (const p of pot)
        for (const q of p.layout.panels) {
          const V = q.map(([x, y, z]) => [x, z + 0.01, y]);
          pos.push(...V[0], ...V[1], ...V[2], ...V[0], ...V[2], ...V[3]);
          uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
        }
      if (pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.computeVertexNormals();
        const mat = done ? this.mats.pvSolid : this.mats.pvGhost;
        const m = new THREE.Mesh(g, mat);
        m.material.side = THREE.DoubleSide;
        m.castShadow = done;
        m.userData.pick = { type: 'project', projectId: pvProjects[0].id };
        m.userData.noShade = true;
        group.add(m);
        this.pickables.push(m);
      }
    }

    this.houseGroup.add(group);
    this.roofEntry = entry;
    if (this.pvHeatResult) {
      this.pvHeatMesh = null;
      this.setPvHeat(this.pvHeatResult);
    }
  }

  buildScaffold(floors, roofs) {
    const target = (this.data.projects || []).filter((p) => p.status === 'umsetzung' && ['roof', 'facade'].includes(projectKind(p.kind).target));
    if (!target.length || !floors.length) return;
    const base = floors.find((f) => f.elevation >= -0.01) || floors[0];
    const outer = outerOutline(base.walls || []);
    if (!outer) return;
    const ground = this.data.house?.model?.groundLevel ?? 0;
    const topZ = roofs.length ? Math.min(...roofs.map((r) => r.base)) + 0.9 : floors[floors.length - 1].elevation + floors[floors.length - 1].height;
    const inner = offsetPolygon(outer, 0.35);
    const outerL = offsetPolygon(outer, 1.05);
    const poles = [],
      decks = [],
      nets = [];
    const levels = [];
    for (let z = ground + 2; z <= topZ + 0.01; z += 2) levels.push(z);
    if (!levels.length || levels[levels.length - 1] < topZ - 0.6) levels.push(topZ);
    const height = topZ + 1 - ground;
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length;
      for (const line of [inner, outerL]) {
        const a = line[i],
          b = line[j];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.round(L / 2.5));
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const g = new THREE.CylinderGeometry(0.03, 0.03, height, 6);
          g.translate(a[0] + (b[0] - a[0]) * t, ground + height / 2, a[1] + (b[1] - a[1]) * t);
          poles.push(g);
        }
      }
      const a = [(inner[i][0] + outerL[i][0]) / 2, (inner[i][1] + outerL[i][1]) / 2];
      const b = [(inner[j][0] + outerL[j][0]) / 2, (inner[j][1] + outerL[j][1]) / 2];
      const wall = { a, b };
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (const z of levels) {
        decks.push(wallBox(wall, -0.35, L + 0.35, z - 0.04, z, 0.5, { top: C('#f0a43a'), bottom: C('#c9852a'), end: C('#e09432'), pz: C('#e09432'), nz: C('#e09432') }));
        const ra = outerL[i],
          rb = outerL[j];
        const rw = { a: ra, b: rb };
        const RL = Math.hypot(rb[0] - ra[0], rb[1] - ra[1]);
        decks.push(wallBox(rw, 0, RL, z + 0.95, z + 1.0, 0.05, { top: C('#f0a43a'), bottom: C('#f0a43a'), end: C('#f0a43a'), pz: C('#f0a43a'), nz: C('#f0a43a') }));
      }
      const nw = { a: outerL[i], b: outerL[j] };
      const NL = Math.hypot(outerL[j][0] - outerL[i][0], outerL[j][1] - outerL[i][1]);
      nets.push(paintGeometry(wallBox(nw, 0, NL, ground + 0.2, topZ + 1, 0.01, { top: C('#fff'), bottom: C('#fff'), end: C('#fff'), pz: C('#fff'), nz: C('#fff') }), C('#ffffff')));
    }
    const group = new THREE.Group();
    const pm = new THREE.Mesh(mergeGeometries(poles), this.mats.scaffoldPole);
    pm.castShadow = true;
    const deckMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    const dm = new THREE.Mesh(mergeGeometries(decks.filter(Boolean)), deckMat);
    dm.castShadow = true;
    const nm = new THREE.Mesh(mergeGeometries(nets.filter(Boolean)), this.mats.net);
    group.add(pm, dm, nm);
    poles.forEach((g) => g.dispose());
    decks.forEach((g) => g && g.dispose());
    group.userData.pick = { type: 'project', projectId: target[0].id };
    group.userData.noShade = true;
    this.houseGroup.add(group);
    this.scaffold = group;
  }

  buildProjectLabels(floors, roofs) {
    this.projectLabels = [];
    const today = todayISO();
    const projects = (this.data.projects || []).filter((p) => !isDone(p) && p.status !== 'idee');
    const used = new Map();
    for (const p of projects) {
      const pos = this.targetPoint(p, floors, roofs);
      if (!pos) continue;
      const key = pos.slice(0, 3).map((v) => v.toFixed(1)).join(',');
      const n = used.get(key) || 0;
      used.set(key, n + 1);
      const late = p.end && p.end < today;
      const st = statusOf(p.status);
      const tone = late ? 'late' : p.status === 'umsetzung' ? 'active' : p.status === 'beauftragt' ? 'booked' : 'plan';
      const when = p.status === 'umsetzung' ? (p.end ? `bis ${fmtDayMonth(p.end)}` : 'läuft') : p.start ? `ab ${fmtDayMonth(p.start)}` : st.name;
      const lbl = makeLabel(
        `<b>${escapeHtml(p.title)}</b><span>${late ? 'Im Verzug · ' : ''}${escapeHtml(st.name)} · ${when}</span>`,
        'project ' + tone,
        () => this.opts.onPick?.({ type: 'project', projectId: p.id }),
      );
      lbl.position.set(pos[0], pos[1] + n * 1.5, pos[2]);
      lbl.userData.projectId = p.id;
      lbl.userData.urgent = tone === 'active' || tone === 'late';
      lbl.userData.anchor = pos[3];
      this.houseGroup.add(lbl);
      this.projectLabels.push(lbl);
    }
  }

  // World position [x, y, z, anchorType] where a project shows its label.
  targetPoint(p, floors, roofs) {
    const target = projectKind(p.kind).target;
    const firstRoomOfType = (type) => {
      for (const f of floors) for (const r of f.rooms || []) if (r.type === type) return { f, r };
      return null;
    };
    const roomPos = (f, r) => {
      const lp = labelPoint(r.poly);
      return [lp[0], f.elevation + 1.2, lp[1], 'floor:' + f.id];
    };
    const comp = (p.components || []).map((cid) => this.data.components?.[cid]).find((c) => c?.roomId);
    if (comp && target !== 'roof') {
      for (const f of floors) {
        const r = (f.rooms || []).find((x) => x.id === comp.roomId);
        if (r) return roomPos(f, r);
      }
    }
    if (p.kind === 'pv' && roofs.length) {
      const best = pvPotential(this.data.house, floors).sort((a, b) => b.kwhYear - a.kwhYear)[0];
      if (best) {
        const pts = best.slope.pts;
        const c = pts.reduce((a, q) => [a[0] + q[0] / pts.length, a[1] + q[1] / pts.length, a[2] + q[2] / pts.length], [0, 0, 0]);
        return [c[0], c[2] + 0.6, c[1], 'roof'];
      }
    }
    if (target === 'roof' && roofs.length) {
      const { sec, geo } = roofs[0];
      return [sec.x + sec.w / 2, geo.ridgeZ + 0.6, sec.y + sec.d / 2, 'roof'];
    }
    if (target.startsWith('room:')) {
      const hit = firstRoomOfType(target.slice(5));
      if (hit) return roomPos(hit.f, hit.r);
    }
    const f0 = target === 'floor:lowest' ? floors[0] : floors.find((f) => f.elevation >= -0.01) || floors[0];
    const ol = outerOutline(f0.walls || []);
    if (!ol) return null;
    const bb = bbox(ol);
    if (target === 'windows' || target === 'facade') return [bb.minX + bb.w * 0.5, f0.elevation + f0.height * 0.8, bb.maxY + 0.2, 'facade'];
    if (target === 'plot') return [bb.maxX + 3, (this.data.house?.model?.groundLevel ?? 0) + 0.5, bb.maxY + 3, 'plot'];
    const c = polyCentroid(ol);
    return [c[0], f0.elevation + 1.2, c[1], 'floor:' + f0.id];
  }

  computeBounds() {
    const box = new THREE.Box3();
    for (const e of this.floorEntries) box.expandByObject(e.group);
    if (this.roofEntry) box.expandByObject(this.roofEntry.group);
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 5, 5));
    this.bounds = box;
    const c = box.getCenter(new THREE.Vector3());
    this.center = c;
    const size = box.getSize(new THREE.Vector3());
    this.radius = Math.max(6, size.length() / 2);
    this.applySun();
  }

  // ---------- sun ----------
  // state: null for a pleasant fixed light, or { date } (UTC) for the real sun at the house location
  setSun(state) {
    this.sunState = state;
    this.applySun();
  }

  applySun() {
    if (!this.sun) return;
    const c = this.center || new THREE.Vector3();
    const north = this.data?.house?.northAngle || 0;
    const geo = houseGeo(this.data?.house);
    const pos = this.sunState ? sunPosition(this.sunState.date, geo.lat, geo.lon) : { azimuth: 205, altitude: 42 };
    this.sunPos = pos;
    const v = sunVector(pos, north);
    const dir = new THREE.Vector3(v[0], Math.max(v[1], 0.02), v[2]).normalize();
    const day = pos.altitude > 0;
    const k = day ? Math.min(1, 0.25 + Math.sin((pos.altitude * Math.PI) / 180) * 1.2) : 0;
    this.sun.intensity = (this.sunBase ?? 2.1) * k;
    this.hemi.intensity = (this.hemiBase ?? 1.55) * (day ? 1 : 0.55);
    this.sun.position.copy(c).addScaledVector(dir, 80);
    this.sun.target.position.copy(c);
    const sc = this.sun.shadow.camera;
    const R = (this.radius || 10) + 14 + (pos.altitude < 25 ? 18 : 0);
    sc.left = -R;
    sc.right = R;
    sc.top = R;
    sc.bottom = -R;
    sc.near = 1;
    sc.far = 200;
    sc.updateProjectionMatrix();
  }

  // ---------- PV shading analysis ----------
  pvPanels() {
    const pot = pvPotential(this.data?.house, this.floors || []).filter((p) => p.factor >= 0.8 && p.modules > 0);
    const out = [];
    for (const p of pot)
      for (const q of p.layout.panels) {
        const c = q.reduce((a, v) => [a[0] + v[0] / q.length, a[1] + v[1] / q.length, a[2] + v[2] / q.length], [0, 0, 0]);
        const n = p.slope.normal;
        out.push({ slopeKey: p.key, slope: p, corners: q, center: new THREE.Vector3(c[0], c[2], c[1]), normal: [n[0], n[2], n[1]] });
      }
    return out;
  }

  // runs fn with every floor and the roof at rest position (explode/floor views move them)
  atRest(fn) {
    const groups = [...this.floorEntries.map((e) => e.group), this.roofEntry?.group].filter(Boolean);
    const saved = groups.map((g) => g.position.y);
    groups.forEach((g) => (g.position.y = 0));
    this.scene.updateMatrixWorld(true);
    try {
      return fn();
    } finally {
      groups.forEach((g, i) => (g.position.y = saved[i]));
      this.scene.updateMatrixWorld(true);
    }
  }

  async analyzePv({ onProgress, signal } = {}) {
    const house = this.data?.house;
    const panels = this.pvPanels();
    if (!panels.length) return null;
    const months = yearSteps(houseGeo(house), house?.northAngle || 0);
    const rc = new THREE.Raycaster();
    rc.far = 250;
    const targets = [this.houseGroup, this.envGroup];
    // walls of attic floors are taller than drawn and only cut by the roof through clipping planes,
    // which raycasting ignores - they are under the roof anyway
    const noShade = (o) => {
      if ([].concat(o.material || []).some((m) => m?.clippingPlanes?.length)) return true;
      for (let x = o; x; x = x.parent) if (x.userData?.noShade) return true;
      return false;
    };
    const KWP = 0.43,
      PR = 0.86;
    const hourly = months.map(() => new Array(24).fill(0));
    const monthly = new Array(12).fill(0);
    const mods = panels.map((p) => ({ slopeKey: p.slopeKey, free: 0, real: 0 }));
    const org = new THREE.Vector3(),
      dir = new THREE.Vector3();
    for (let i = 0; i < panels.length; i++) {
      if (signal?.aborted) throw { code: 'cancelled' };
      const pn = panels[i];
      this.atRest(() => {
        org.copy(pn.center).add(new THREE.Vector3(...pn.normal).multiplyScalar(0.08));
        for (const m of months)
          for (const st of m.steps) {
            const cosI = pn.normal[0] * st.vec[0] + pn.normal[1] * st.vec[1] + pn.normal[2] * st.vec[2];
            let shaded = false;
            if (cosI > 0) {
              dir.set(st.vec[0], st.vec[1], st.vec[2]);
              rc.set(org, dir);
              shaded = rc.intersectObjects(targets, true).some((h) => !noShade(h.object));
            }
            const free = poa(st, pn.normal, false);
            const real = shaded ? poa(st, pn.normal, true) : free;
            mods[i].free += (free * m.hours * m.days) / 1000;
            mods[i].real += (real * m.hours * m.days) / 1000;
            const kwhDay = (real * m.hours * KWP * PR) / 1000;
            hourly[m.month][Math.floor(st.min / 60)] += kwhDay;
            monthly[m.month] += kwhDay * m.days;
          }
      });
      onProgress?.((i + 1) / panels.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    for (const m of mods) {
      m.loss = m.free ? 1 - m.real / m.free : 0;
      m.kwh = m.real * KWP * PR;
    }
    const slopes = [];
    for (const p of panels) if (!slopes.some((x) => x.key === p.slopeKey)) slopes.push({ key: p.slopeKey, label: p.slope.label, azimuth: p.slope.azimuth, tilt: p.slope.tilt });
    for (const sl of slopes) {
      const ms = mods.filter((m) => m.slopeKey === sl.key);
      sl.modules = ms.length;
      sl.kwp = ms.length * KWP;
      sl.kwh = ms.reduce((a, m) => a + m.kwh, 0);
      sl.loss = 1 - ms.reduce((a, m) => a + m.real, 0) / Math.max(1e-6, ms.reduce((a, m) => a + m.free, 0));
    }
    const free = mods.reduce((a, m) => a + m.free * KWP * PR, 0);
    const total = mods.reduce((a, m) => a + m.kwh, 0);
    return { at: Date.now(), modules: mods.map((m) => ({ s: m.slopeKey, loss: Math.round(m.loss * 1000) / 1000, kwh: Math.round(m.kwh) })), slopes, kwp: panels.length * KWP, total, free, loss: free ? 1 - total / free : 0, monthly, hourly };
  }

  // colours every module by its shading loss (sequential ramp); null hides it
  setPvHeat(result) {
    this.pvHeatResult = result;
    if (this.pvHeatMesh) {
      this.pvHeatMesh.parent?.remove(this.pvHeatMesh);
      this.pvHeatMesh.geometry.dispose();
      this.pvHeatMesh.material.dispose();
      this.pvHeatMesh = null;
    }
    if (!result || !this.roofEntry) return;
    const panels = this.pvPanels();
    if (panels.length !== result.modules.length) return;
    const pos = [],
      col = [];
    const c = new THREE.Color();
    panels.forEach((p, i) => {
      c.set(shadeColor(result.modules[i].loss));
      const n = p.normal;
      const V = p.corners.map(([x, y, z]) => [x + n[0] * 0.03, z + n[1] * 0.03, y + n[2] * 0.03]);
      for (const k of [0, 1, 2, 0, 2, 3]) {
        pos.push(...V[k]);
        col.push(c.r, c.g, c.b);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    m.userData.noShade = true;
    m.renderOrder = 3;
    this.roofEntry.group.add(m);
    this.pvHeatMesh = m;
  }

  buildEnvironment() {
    for (const c of [...this.envGroup.children]) {
      this.envGroup.remove(c);
      disposeTree(c);
    }
    this.contextLabels = [];
    const h = this.data?.house;
    const gl = h?.model?.groundLevel ?? 0;
    const c = this.center || new THREE.Vector3();
    this.groundMat = new THREE.MeshStandardMaterial({ color: this.groundColor, roughness: 1, transparent: true, opacity: 1 });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(260, 64), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(c.x, gl - 0.02, c.z);
    ground.receiveShadow = true;
    this.envGroup.add(ground);

    const plot = h?.model?.plot;
    if (!plot) return;
    this.buildContext(gl);
    if (plot.poly && plot.poly.length >= 3) return this.buildSite(gl);
    this.plotMat = new THREE.MeshStandardMaterial({ color: this.plotColor, roughness: 1, transparent: true, opacity: 1 });
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(plot.w, plot.d), this.plotMat);
    pm.rotation.x = -Math.PI / 2;
    pm.position.set(plot.x + plot.w / 2, gl, plot.y + plot.d / 2);
    pm.receiveShadow = true;
    this.envGroup.add(pm);

    // road along the north edge
    const roadMat = new THREE.MeshStandardMaterial({ color: this.roadColor, roughness: 1 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(plot.w + 160, 7), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(plot.x + plot.w / 2, gl - 0.005, plot.y - 5.5);
    road.receiveShadow = true;
    this.envGroup.add(road);
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(plot.w + 160, 1.8), this.mats.paving);
    walk.rotation.x = -Math.PI / 2;
    walk.position.set(plot.x + plot.w / 2, gl + 0.003, plot.y - 1.1);
    walk.receiveShadow = true;
    this.envGroup.add(walk);
    const dashes = [];
    for (let x = plot.x - 80; x < plot.x + plot.w + 80; x += 4) {
      const g = new THREE.PlaneGeometry(2, 0.14);
      g.rotateX(-Math.PI / 2);
      g.translate(x, gl + 0.004, plot.y - 5.5);
      dashes.push(g);
    }
    const dm = new THREE.Mesh(mergeGeometries(dashes), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 }));
    dashes.forEach((g) => g.dispose());
    this.envGroup.add(dm);

    // fence with a gate gap on the street side
    const eg = this.floors?.find((f) => f.elevation >= -0.01) || this.floors?.[0];
    const outer = eg ? outerOutline(eg.walls || []) : null;
    const bb = outer ? bbox(outer) : { minX: 0, maxX: 10, minY: 0, maxY: 8, w: 10, h: 8 };
    const door = eg?.walls?.flatMap((w) => (w.openings || []).filter((o) => o.type === 'door' && w.ext).map((o) => ({ w, o }))).find(({ w }) => Math.min(w.a[1], w.b[1]) <= bb.minY + 0.5);
    let gateX = bb.minX + bb.w / 2;
    if (door) {
      const { w, o } = door;
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      gateX = w.a[0] + ((w.b[0] - w.a[0]) * o.pos) / L;
    }
    const fenceParts = [];
    const ring = [[plot.x, plot.y], [plot.x + plot.w, plot.y], [plot.x + plot.w, plot.y + plot.d], [plot.x, plot.y + plot.d]];
    for (let i = 0; i < 4; i++) {
      const a = ring[i],
        b = ring[(i + 1) % 4];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const segs = i === 0 ? [[0, gateX - plot.x - 2.2], [gateX - plot.x + 3.6, L]] : [[0, L]];
      for (const [s0, s1] of segs) {
        if (s1 - s0 < 0.2) continue;
        const wall = { a, b };
        fenceParts.push(paintGeometry(wallBox(wall, s0, s1, gl + 0.85, gl + 0.95, 0.05, {}), C('#ffffff')));
        fenceParts.push(paintGeometry(wallBox(wall, s0, s1, gl + 0.35, gl + 0.42, 0.05, {}), C('#ffffff')));
        for (let s = s0; s <= s1 + 0.001; s += 2) fenceParts.push(paintGeometry(wallBox(wall, s - 0.04, s + 0.04, gl, gl + 1.05, 0.08, {}), C('#ffffff')));
      }
    }
    const fm = new THREE.Mesh(mergeGeometries(fenceParts), this.mats.fence);
    fenceParts.forEach((g) => g.dispose());
    fm.castShadow = true;
    this.envGroup.add(fm);

    // driveway / path and terrace
    const path = new THREE.Mesh(new THREE.PlaneGeometry(3.6, Math.max(0.5, bb.minY - plot.y)), this.mats.paving);
    path.rotation.x = -Math.PI / 2;
    path.position.set(gateX + 0.6, gl + 0.006, plot.y + (bb.minY - plot.y) / 2);
    path.receiveShadow = true;
    this.envGroup.add(path);
    const terr = new THREE.Mesh(new THREE.BoxGeometry(Math.min(bb.w, 7), 0.12, 3.2), this.mats.terrace);
    terr.position.set(bb.minX + bb.w / 2, gl + 0.06, bb.maxY + 1.6);
    terr.receiveShadow = true;
    this.envGroup.add(terr);

    // trees and hedges (deterministic)
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const spots = [
      [plot.x + 2.2, plot.y + plot.d - 2.5], [plot.x + plot.w - 2.5, plot.y + plot.d - 3.2], [plot.x + plot.w - 2, plot.y + 3],
      [plot.x + 2.5, plot.y + 4], [plot.x + plot.w * 0.55, plot.y + plot.d - 1.8], [plot.x + 1.6, plot.y + plot.d * 0.55],
      [plot.x - 6, plot.y - 10], [plot.x + plot.w + 6, plot.y - 11], [plot.x + plot.w + 5, plot.y + plot.d * 0.6], [plot.x - 5, plot.y + plot.d * 0.4],
    ];
    const trunks = [],
      crowns = [],
      crowns2 = [];
    for (const [x, z] of spots) {
      if (x > bb.minX - 2 && x < bb.maxX + 2 && z > bb.minY - 2 && z < bb.maxY + 4) continue;
      const s = 0.8 + rnd() * 0.6;
      const t = new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 1.6 * s, 6);
      t.translate(x, gl + 0.8 * s, z);
      trunks.push(t);
      const cr = new THREE.IcosahedronGeometry(1.35 * s, 0);
      cr.translate(x, gl + 2.4 * s, z);
      (rnd() > 0.5 ? crowns : crowns2).push(cr);
      if (rnd() > 0.4) {
        const c2 = new THREE.IcosahedronGeometry(0.9 * s, 0);
        c2.translate(x + 0.5 * s, gl + 3.2 * s, z - 0.3 * s);
        crowns.push(c2);
      }
    }
    const add = (geos, mat) => {
      if (!geos.length) return;
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      geos.forEach((g) => g.dispose());
      m.castShadow = true;
      m.receiveShadow = true;
      this.envGroup.add(m);
    };
    add(trunks, this.mats.trunk);
    add(crowns, this.mats.canopy);
    add(crowns2, this.mats.canopy2);
    const hedges = [];
    for (let z = plot.y + plot.d * 0.35; z < plot.y + plot.d - 1; z += 1.1) {
      const g = new THREE.BoxGeometry(0.8, 0.9 + ((z * 7) % 3) * 0.08, 1.05);
      g.translate(plot.x + plot.w - 0.6, gl + 0.45, z);
      hedges.push(g);
    }
    add(hedges, this.mats.hedge);

    // north arrow
    const north = ((h?.northAngle || 0) * Math.PI) / 180;
    const arrow = new THREE.Shape();
    arrow.moveTo(0, -1.1);
    arrow.lineTo(0.45, 0.6);
    arrow.lineTo(0, 0.25);
    arrow.lineTo(-0.45, 0.6);
    arrow.closePath();
    const ag = new THREE.ShapeGeometry(arrow);
    ag.rotateX(Math.PI / 2);
    const am = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: this.accent, side: THREE.DoubleSide }));
    am.rotation.y = -north;
    am.position.set(plot.x + plot.w - 2.2, gl + 0.03, plot.y + 2.2);
    this.envGroup.add(am);
    const nl = makeLabel('<b>N</b>', 'compass');
    nl.position.set(plot.x + plot.w - 2.2 + Math.sin(north) * 1.6, gl + 0.1, plot.y + 2.2 - Math.cos(north) * 1.6);
    this.envGroup.add(nl);
  }

  // Plot as a polygon with its real neighbours: street, fence with gaps, paving, water, trees.
  buildSite(gl) {
    const m = this.data.house.model;
    const poly = m.plot.poly;
    const north = ((this.data.house?.northAngle || 0) * Math.PI) / 180;
    const flat = (pts, y, mat, ro = true) => {
      const g = new THREE.ShapeGeometry(shapeFromPoly(pts));
      g.rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.y = y;
      mesh.receiveShadow = ro;
      this.envGroup.add(mesh);
      return mesh;
    };
    this.plotMat = new THREE.MeshStandardMaterial({ color: this.plotColor, roughness: 1, transparent: true, opacity: 1, side: THREE.DoubleSide });
    flat(poly, gl, this.plotMat);

    for (const wpoly of m.water || []) {
      flat(wpoly, gl - 0.05, new THREE.MeshStandardMaterial({ color: cssVar('--scene-water', '#a9d3ec'), roughness: 0.25, metalness: 0.05, side: THREE.DoubleSide }), false);
    }
    for (const pv of m.paving || []) {
      const mat = pv.kind === 'terrasse' ? this.mats.terrace : this.mats.paving;
      mat.side = THREE.DoubleSide;
      flat(pv.poly, gl + 0.006, mat);
    }
    if (m.road) {
      const r = m.road;
      const roadMat = new THREE.MeshStandardMaterial({ color: r.color || this.roadColor, roughness: 1, side: THREE.DoubleSide });
      const road = new THREE.Mesh(quadGeometry(r.a, r.b, r.width ?? 5, gl - 0.004), roadMat);
      road.receiveShadow = true;
      this.envGroup.add(road);
      if (r.sidewalk) {
        const sw = new THREE.Mesh(quadGeometry(r.sidewalk.a, r.sidewalk.b, r.sidewalk.width ?? 1.5, gl + 0.003), this.mats.paving);
        sw.receiveShadow = true;
        this.envGroup.add(sw);
      }
      if (r.name) {
        const mid = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2];
        const at = r.labelAt || mid;
        const lbl = makeLabel(`<b>${escapeHtml(r.name)}</b>`, 'street');
        lbl.position.set(at[0], gl + 0.2, at[1]);
        this.envGroup.add(lbl);
        this.contextLabels.push(lbl);
      }
    }

    // fence along the plot edges, leaving gates open
    const fence = [];
    const gaps = m.plot.gaps || [];
    const skip = new Set(m.plot.noFence || []);
    for (let i = 0; i < poly.length; i++) {
      if (skip.has(i)) continue;
      const a = poly[i],
        b = poly[(i + 1) % poly.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let segs = [[0, L]];
      for (const gp of gaps.filter((g) => g.edge === i)) {
        segs = segs.flatMap(([s0, s1]) => {
          const out = [];
          if (gp.from > s0) out.push([s0, Math.min(s1, gp.from)]);
          if (gp.to < s1) out.push([Math.max(s0, gp.to), s1]);
          return out;
        });
      }
      const wall = { a, b };
      const style = m.plot.fenceStyle || 'picket';
      for (const [s0, s1] of segs) {
        if (s1 - s0 < 0.2) continue;
        if (style === 'picket' && i === (m.plot.streetEdge ?? -1)) {
          fence.push(paintGeometry(wallBox(wall, s0, s1, gl + 0.75, gl + 0.82, 0.04, {}), WHITE));
          fence.push(paintGeometry(wallBox(wall, s0, s1, gl + 0.3, gl + 0.36, 0.04, {}), WHITE));
          for (let x = s0 + 0.06; x <= s1; x += 0.14) fence.push(paintGeometry(wallBox(wall, x - 0.025, x + 0.025, gl, gl + 0.95, 0.03, {}), WHITE));
        } else {
          fence.push(paintGeometry(wallBox(wall, s0, s1, gl + 0.85, gl + 0.92, 0.04, {}), WHITE));
          for (let x = s0; x <= s1 + 0.001; x += 2.5) fence.push(paintGeometry(wallBox(wall, x - 0.04, x + 0.04, gl, gl + 1.0, 0.08, {}), WHITE));
        }
      }
    }
    if (fence.length) {
      const fm = new THREE.Mesh(mergeGeometries(fence), this.mats.fence);
      fence.forEach((g) => g.dispose());
      fm.castShadow = true;
      this.envGroup.add(fm);
    }

    // trees: explicit list, otherwise spread over the back of the garden
    const blocked = [];
    const eg = this.floors?.find((f) => f.elevation >= -0.01) || this.floors?.[0];
    const ol = eg ? outerOutline(eg.walls || []) : null;
    if (ol) blocked.push(bbox(ol));
    for (const b of m.context || []) blocked.push({ minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.d });
    for (const pv of m.paving || []) blocked.push(bbox(pv.poly));
    const free = (q, r) => blocked.every((bb) => q[0] < bb.minX - r || q[0] > bb.maxX + r || q[1] < bb.minY - r || q[1] > bb.maxY + r);
    let spots = m.trees;
    if (!spots) {
      spots = [];
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const bb = bbox(poly);
      for (let k = 0; k < 400 && spots.length < 9; k++) {
        const q = [bb.minX + rnd() * bb.w, bb.minY + rnd() * bb.h];
        if (!pointInPoly(q, poly) || distToPolyEdges(q, poly) < 1.2 || !free(q, 2.2)) continue;
        if (spots.some((t) => Math.hypot(t[0] - q[0], t[1] - q[1]) < 5)) continue;
        spots.push([q[0], q[1], 0.7 + rnd() * 0.6]);
      }
    }
    this.addTrees(spots, gl);

    // north arrow
    const at = m.compass || [bbox(poly).maxX + 1.5, bbox(poly).minY + 1.5];
    this.addCompass(at, gl, north);
  }

  addTrees(spots, gl) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const trunks = [],
      crowns = [],
      crowns2 = [];
    for (const [x, z, sc] of spots) {
      const s = sc ?? 1;
      const t = new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 1.6 * s, 6);
      t.translate(x, gl + 0.8 * s, z);
      trunks.push(t);
      const cr = new THREE.IcosahedronGeometry(1.35 * s, 0);
      cr.translate(x, gl + 2.4 * s, z);
      (rnd() > 0.5 ? crowns : crowns2).push(cr);
      if (rnd() > 0.4) {
        const c2 = new THREE.IcosahedronGeometry(0.9 * s, 0);
        c2.translate(x + 0.5 * s, gl + 3.2 * s, z - 0.3 * s);
        crowns.push(c2);
      }
    }
    const add = (geos, mat) => {
      if (!geos.length) return;
      const mm = new THREE.Mesh(mergeGeometries(geos), mat);
      geos.forEach((g) => g.dispose());
      mm.castShadow = true;
      mm.receiveShadow = true;
      this.envGroup.add(mm);
    };
    add(trunks, this.mats.trunk);
    add(crowns, this.mats.canopy);
    add(crowns2, this.mats.canopy2);
  }

  addCompass(at, gl, north) {
    const arrow = new THREE.Shape();
    arrow.moveTo(0, -1.1);
    arrow.lineTo(0.45, 0.6);
    arrow.lineTo(0, 0.25);
    arrow.lineTo(-0.45, 0.6);
    arrow.closePath();
    const ag = new THREE.ShapeGeometry(arrow);
    ag.rotateX(Math.PI / 2);
    const am = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: this.accent, side: THREE.DoubleSide }));
    // north in plan coordinates is (-sin N, -cos N), matching bearing() in roof.js
    am.rotation.y = north;
    am.position.set(at[0], gl + 0.03, at[1]);
    this.envGroup.add(am);
    const nl = makeLabel('<b>N</b>', 'compass');
    nl.position.set(at[0] - Math.sin(north) * 1.6, gl + 0.1, at[1] - Math.cos(north) * 1.6);
    this.envGroup.add(nl);
  }

  // Neighbouring houses and outbuildings as simple massing.
  buildContext(gl) {
    this.contextLabels = [];
    this.ctxEntries = [];
    const list = this.data.house?.model?.context || [];
    const north = this.data.house?.northAngle || 0;
    for (const b of list) {
      const neighbor = b.kind === 'neighbor';
      const wallMat = new THREE.MeshStandardMaterial({ color: b.color || (neighbor ? '#e2dfda' : '#c9b79e'), roughness: 0.95 });
      const roofMat = new THREE.MeshStandardMaterial({ color: b.roofColor || (neighbor ? '#cbb8b0' : '#8f8b86'), roughness: 0.9 });
      const base = gl + (b.z ?? 0);
      const hgt = b.h ?? 2.6;
      const grp = new THREE.Group();
      const drawn = !neighbor && (b.walls || []).length > 0;
      if (drawn) {
        // outbuilding with its own floor plan: walls, rooms, lines like a storey
        const pseudo = { id: b.id, name: b.name, elevation: base, height: hgt + 0.1, slab: 0.1, walls: b.walls, rooms: b.rooms || [], items: b.items || [], lines: b.lines || [], points: b.points || [] };
        const shade = C(b.color || '#d8cbb6');
        const entry = this.buildStorey(pseudo, { facade: shade, interior: C('#f3f1ec'), top: C('#cfd0d6'), reveal: C('#e9e8e4'), ctx: true });
        entry.group.position.y = 0;
        grp.add(entry.group);
        this.ctxEntries.push(entry);
      } else if (b.open) {
        for (const [px, py] of [[b.x + 0.1, b.y + 0.1], [b.x + b.w - 0.1, b.y + 0.1], [b.x + b.w - 0.1, b.y + b.d - 0.1], [b.x + 0.1, b.y + b.d - 0.1]]) {
          const g = new THREE.BoxGeometry(0.12, hgt, 0.12);
          g.translate(px, base + hgt / 2, py);
          grp.add(new THREE.Mesh(g, wallMat));
        }
      } else {
        const g = new THREE.BoxGeometry(b.w, hgt, b.d);
        g.translate(b.x + b.w / 2, base + hgt / 2, b.y + b.d / 2);
        grp.add(new THREE.Mesh(g, wallMat));
      }
      if (b.roof && b.roof !== 'flat') {
        const geo = sectionGeometry({ x: b.x, y: b.y, w: b.w, d: b.d, type: b.roof, pitch: b.pitch ?? 35, ridge: b.ridge, overhang: b.overhang ?? 0.3, oStart: b.oStart, oEnd: b.oEnd, flip: b.flip }, base + hgt, north);
        for (const sl of geo.slopes) grp.add(new THREE.Mesh(prismGeometry(sl.pts, sl.normal, 0.18), [roofMat, roofMat]));
        const cx = b.x + b.w / 2,
          cy = b.y + b.d / 2;
        for (const gpts of geo.gables) {
          const c = gpts.reduce((a, p) => [a[0] + p[0] / gpts.length, a[1] + p[1] / gpts.length], [0, 0]);
          const inward = norm([cx - c[0], cy - c[1]]);
          grp.add(new THREE.Mesh(prismGeometry(gpts, [inward[0], inward[1], 0], Math.min(b.w, b.d) / 2), [wallMat, wallMat]));
        }
      } else {
        const g = new THREE.BoxGeometry(b.w + 0.3, 0.16, b.d + 0.3);
        g.translate(b.x + b.w / 2, base + hgt + 0.08, b.y + b.d / 2);
        grp.add(new THREE.Mesh(g, roofMat));
      }
      grp.traverse((o) => {
        if (o.isMesh && !o.parent?.userData.noShade) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      grp.userData.ctx = true;
      this.envGroup.add(grp);
      if (b.name && b.label !== false) {
        const lbl = makeLabel(`<b>${escapeHtml(b.name)}</b>`, neighbor ? 'ctx neighbor' : 'ctx');
        lbl.position.set(b.x + b.w / 2, base + hgt + (b.roof && b.roof !== 'flat' ? 2.2 : 0.6), b.y + b.d / 2);
        this.envGroup.add(lbl);
        this.contextLabels.push(lbl);
      }
    }
  }

  // ---------- view state ----------
  setView(v) {
    const prev = this.view;
    this.view = { ...this.view, ...v };
    this.applyView(false);
    if (prev.mode !== this.view.mode || prev.floorId !== this.view.floorId) this.frameView();
  }

  applyView(instant) {
    const { mode, floorId, showRoof } = this.view;
    const entries = this.floorEntries;
    if (!entries.length) return;
    const gap = 3.4;
    const ground = this.data?.house?.model?.groundLevel ?? 0;
    const lowest = entries[0].floor.elevation;
    const lift = mode === 'explode' ? Math.max(0, ground - lowest + 0.4) : 0;
    const activeIdx = entries.findIndex((e) => e.floor.id === floorId);
    entries.forEach((e, i) => {
      if (mode === 'explode') {
        e.target = lift + i * gap;
        e.wantVisible = true;
      } else if (mode === 'floor' && activeIdx >= 0) {
        e.wantVisible = i <= activeIdx;
        e.target = i <= activeIdx ? 0 : 6 + (i - activeIdx) * 2;
      } else {
        e.target = 0;
        e.wantVisible = true;
      }
      if (instant) e.offset = e.target;
    });
    if (this.roofEntry) {
      const r = this.roofEntry;
      r.wantVisible = mode === 'explode' ? showRoof : mode === 'all' && showRoof;
      r.target = mode === 'explode' ? lift + entries.length * gap - 1.2 : r.wantVisible ? 0 : 8;
      if (instant) r.offset = r.target;
    }
    const below = mode === 'floor' && activeIdx >= 0 && entries[activeIdx].floor.elevation < ground - 0.5;
    if (this.groundMat) {
      this.groundMat.opacity = below ? 0.25 : 1;
      this.groundMat.depthWrite = !below;
    }
    if (this.plotMat) {
      this.plotMat.opacity = below ? 0.25 : 1;
      this.plotMat.depthWrite = !below;
    }
    if (this.scaffold) this.scaffold.visible = mode === 'all' && !this.view.showLines;
    this.applyXray();
  }

  // x-ray: walls, slabs and roof turn see-through so the installation lines inside are visible
  applyXray() {
    const on = !!this.view.showLines;
    for (const e of [...this.floorEntries, ...(this.ctxEntries || [])]) if (e.lineGroup) e.lineGroup.visible = on;
    const mats = [...this.floorEntries.flatMap((e) => e.wallMats), this.mats.slabCap, this.mats.slabSide, this.mats.glass, this.mats.frame, this.mats.door, this.mats.stairs];
    if (this.roofTopMat) mats.push(this.roofTopMat, this.mats.roofSide);
    if (this.roofEntry?.gableMat) mats.push(this.roofEntry.gableMat);
    if (this.roofEntry?.group) this.roofEntry.group.traverse((o) => o.isMesh && [].concat(o.material).forEach((m) => !mats.includes(m) && mats.push(m)));
    const collect = (o) => {
      if (o.userData.noXray) return;
      if (o.isMesh) [].concat(o.material).forEach((m) => !mats.includes(m) && mats.push(m));
      o.children.forEach(collect);
    };
    for (const g of this.envGroup.children) if (g.userData.ctx) collect(g);
    const roomMats = [...(this.roomMeshes?.values() || [])].map((r) => r.mat);
    for (const m of [...mats, ...roomMats]) {
      if (!m) continue;
      if (m.userData.xray === on) continue;
      if (on) {
        m.userData.pre = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite };
        m.transparent = true;
        m.opacity = Math.min(m.opacity, roomMats.includes(m) ? 0.35 : 0.09);
        m.depthWrite = false;
      } else if (m.userData.pre) {
        Object.assign(m, m.userData.pre);
      }
      m.userData.xray = on;
      m.needsUpdate = true;
    }
    if (this.groundMat && on) {
      this.groundMat.opacity = 0.35;
      this.groundMat.depthWrite = false;
    }
    this.sun.castShadow = !on;
  }

  // >1 when sheets or drawers cover part of the canvas, so the model still fits the free area
  fitFactor() {
    const w = this.el.clientWidth || 1,
      h = this.el.clientHeight || 1;
    const { left, right, top, bottom } = this.insets;
    const fw = w / Math.max(200, w - left - right),
      fh = h / Math.max(200, h - top - bottom);
    let f = Math.max(1, Math.max(fw * 0.8, fh * 0.9));
    const asp = w / h;
    if (asp < 1) f *= Math.min(2.2, 0.8 / asp);
    return Math.min(4, f);
  }

  frameView() {
    const { mode, floorId } = this.view;
    if (!this.center) return;
    const ff = this.fitFactor();
    const e = this.floorEntries.find((x) => x.floor.id === floorId);
    if (mode === 'floor' && e) {
      const ol = outerOutline(e.floor.walls || []) || [[0, 0], [10, 0], [10, 8], [0, 8]];
      const bb = bbox(ol);
      const tgt = new THREE.Vector3(bb.minX + bb.w / 2, e.floor.elevation + 0.8, bb.minY + bb.h / 2);
      const r = Math.hypot(bb.w, bb.h) / 2 + 1.5;
      this.animateCamera(tgt, r * 4.6 * ff, 0.92);
    } else if (mode === 'explode') {
      const n = this.floorEntries.length;
      const tgt = this.center.clone();
      tgt.y = this.center.y + (n * 3.4) / 2;
      this.animateCamera(tgt, (this.radius * 5.6 + n * 3) * ff, 1.12);
    } else {
      this.animateCamera(this.center.clone(), this.radius * 5.4 * ff, 1.02);
    }
  }

  animateCamera(target, distance, polar) {
    const cur = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(cur);
    if (polar != null) sph.phi = polar;
    sph.radius = distance;
    const pos = new THREE.Vector3().setFromSpherical(sph).add(target);
    this.camAnim = { target, pos };
  }

  resetView(instant) {
    if (!this.center) return;
    const tgt = this.center.clone();
    const cd = this.data?.house?.model?.cameraDir;
    const dir = (cd ? new THREE.Vector3(cd[0], cd[1], cd[2]) : new THREE.Vector3(0.62, 0.62, 0.95)).normalize();
    const pos = tgt.clone().addScaledVector(dir, this.radius * 5.4 * this.fitFactor());
    if (instant) {
      this.controls.target.copy(tgt);
      this.camera.position.copy(pos);
      this.controls.update();
    } else this.camAnim = { target: tgt, pos };
  }

  rotate(deg) {
    const off = this.camera.position.clone().sub(this.controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), (deg * Math.PI) / 180);
    this.camAnim = { target: this.controls.target.clone(), pos: this.controls.target.clone().add(off) };
  }

  zoom(f) {
    const off = this.camera.position.clone().sub(this.controls.target).multiplyScalar(f);
    const d = off.length();
    if (d < this.controls.minDistance || d > this.controls.maxDistance) return;
    this.camAnim = { target: this.controls.target.clone(), pos: this.controls.target.clone().add(off) };
  }

  setSelection(sel) {
    this.selection = sel;
    this.applySelection();
  }

  applySelection() {
    if (!this.roomMeshes) return;
    for (const [id, r] of this.roomMeshes) {
      const on = this.selection?.type === 'room' && this.selection.roomId === id;
      r.mat.color.copy(on ? C(this.accent).lerp(C('#ffffff'), 0.55) : r.base);
    }
  }

  setHighlight(h) {
    this.highlight = h;
  }

  setCompact(on) {
    this.compact = !!on;
  }

  setInsets(ins) {
    const prev = JSON.stringify(this.insets);
    this.insets = { ...this.insets, ...ins };
    this.resize();
    if (prev !== JSON.stringify(this.insets) && this.framed) this.frameView();
  }

  // ---------- picking ----------
  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 600;
      down = null;
      if (moved > 6 || !quick) return;
      const hit = this.pick(e.clientX, e.clientY);
      this.opts.onPick?.(hit);
    });
  }

  pick(cx, cy) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const visible = (o) => {
      for (let p = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    };
    const hits = this.raycaster.intersectObjects((this.pickables || []).filter(visible), false);
    for (const h of hits) {
      const pk = h.object.userData.pick;
      if (pk) return pk;
    }
    return null;
  }

  // ---------- loop ----------
  resize() {
    const w = this.el.clientWidth || 1,
      h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    const { left, right, top, bottom } = this.insets;
    const cx = (left + (w - right)) / 2,
      cy = (top + (h - bottom)) / 2;
    if (left || right || top || bottom) this.camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const k = 1 - Math.exp(-dt * 7);
    if (this.camAnim) {
      this.controls.target.lerp(this.camAnim.target, k);
      this.camera.position.lerp(this.camAnim.pos, k);
      if (this.camera.position.distanceTo(this.camAnim.pos) < 0.02) this.camAnim = null;
    }
    this.controls.update();
    const step = (e) => {
      e.offset += (e.target - e.offset) * k;
      if (Math.abs(e.target - e.offset) < 0.001) e.offset = e.target;
      e.group.position.y = e.offset;
      if (e.wantVisible) e.group.visible = true;
      else if (Math.abs(e.target - e.offset) < 1.2) e.group.visible = false;
      if (e.clipPlanes)
        for (const { base, plane } of e.clipPlanes) {
          const n = base.n;
          plane.normal.set(-n[0], -n[2], -n[1]);
          plane.constant = base.c + n[2] * e.offset + 0.02;
        }
    };
    this.floorEntries.forEach(step);
    if (this.roofEntry) {
      // the attic ceiling clips with the roof; keep it aligned with the roof group
      step(this.roofEntry);
    }
    this.updateLabels();
    this.updateHighlight(t);
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  updateLabels() {
    const { mode, floorId, showLabels, showRoof } = this.view;
    const topIdx = this.floorEntries.length - 1;
    this.floorEntries.forEach((e, i) => {
      const roomsOn =
        showLabels && e.group.visible && ((mode === 'floor' && e.floor.id === floorId) || (mode === 'all' && !showRoof && i === topIdx));
      for (const l of e.roomLabels) l.visible = roomsOn;
      if (e.floorLabel) e.floorLabel.visible = showLabels && mode === 'explode';
    });
    const xr = !!this.view.showLines;
    for (const l of this.contextLabels || []) l.visible = showLabels && mode === 'all' && !this.compact && !xr;
    for (const l of this.projectLabels || []) {
      const a = l.userData.anchor || '';
      let on = showLabels && mode === 'all' && (!this.compact || l.userData.urgent);
      if (a === 'roof' && !showRoof) on = false;
      if (a.startsWith('floor:') && showRoof) on = showLabels && mode === 'all';
      if (mode === 'floor' && a === 'floor:' + floorId) on = showLabels;
      l.visible = on && !xr;
    }
  }

  updateHighlight(t) {
    const h = this.highlight;
    const pulse = 0.22 + 0.14 * Math.sin(t * 3.2);
    const acc = C(this.accent);
    const set = (m, on) => {
      if (!m || !m.emissive) return;
      if (on) {
        m.emissive.copy(acc);
        m.emissiveIntensity = pulse;
      } else m.emissive.setRGB(0, 0, 0);
    };
    const tgt = h?.target || '';
    set(this.roofTopMat, tgt === 'roof');
    set(this.mats.glass, tgt === 'windows');
    for (const e of this.floorEntries) {
      const on = tgt === 'facade' || (tgt === 'floor' && h.floorId === e.floor.id);
      for (const m of e.wallMats) set(m, on);
    }
    if (this.roofEntry?.gableMat) set(this.roofEntry.gableMat, tgt === 'facade');
    if (this.roomMeshes)
      for (const [id, r] of this.roomMeshes) set(r.mat, tgt === 'room' && h.roomId === id);
  }

  // Resolve a project/component target into a highlight descriptor.
  highlightFor(targetKey, ctx = {}) {
    const floors = this.floors || [];
    if (!targetKey) return null;
    if (targetKey === 'roof' || targetKey === 'facade' || targetKey === 'windows') return { target: targetKey };
    if (targetKey === 'floor:lowest' && floors[0]) return { target: 'floor', floorId: floors[0].id };
    if (targetKey.startsWith('room:')) {
      const type = targetKey.slice(5);
      if (ctx.roomId) return { target: 'room', roomId: ctx.roomId };
      for (const f of floors) for (const r of f.rooms || []) if (r.type === type) return { target: 'room', roomId: r.id, floorId: f.id };
    }
    if (ctx.roomId) return { target: 'room', roomId: ctx.roomId };
    if (ctx.floorId) return { target: 'floor', floorId: ctx.floorId };
    return null;
  }

  snapshot(width = 640) {
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const cv = document.createElement('canvas');
    const ratio = src.height / src.width;
    cv.width = width;
    cv.height = Math.round(width * ratio);
    cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    return cv;
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    disposeTree(this.houseGroup);
    disposeTree(this.envGroup);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}
