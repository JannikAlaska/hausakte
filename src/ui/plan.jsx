// Floor plan editor: walls, openings, rooms, stairs, roof sections and a traceable underlay image.
import { Icon, ICON_PATHS } from './icons.jsx';
import { Btn, IconBtn, Field, TextInput, NumInput, Select, Toggle, Pill, Sheet, Seg, ConfirmBtn, Empty } from './common.jsx';
import { useUI, setUI, openDrawer, toast, go } from './state.js';
import { downscaleImage } from './documents.jsx';
import { ROOM_TYPES, roomType, ROOM_COLORS, LINE_KINDS, LINE_ZONES, lineKind, FIXTURE_KINDS, fixtureKind, fixtureZ } from '../catalog.js';
import { DocList, UploadButton } from './documents.jsx';
import { ADJ } from '../heat.js';
import { ROOF_TYPES, autoRoofBase, sectionGeometry } from '../roof.js';
import { sortFloors, roomArea } from '../metrics.js';
import {
  dist, sub, add, mul, norm, perp, len, distToSeg, lineIntersect, orthoSnap, polyArea, labelPoint, pointInPoly, bbox,
  planarFaces, wallSegs, roomInnerPolygon, outerOutline, same, faceAt,
} from '../geometry.js';
import { putDoc, deleteDoc, updateHouse, getAssets, blobUrl, getState } from '../store.js';
import { lineLength, linePlanPts, fixtureAnchor, dedup3, relink, roomOfPoint, resizeLine, dimLength } from '../planops.js';
import { uid, deepClone, fmtFixed, fmtNum, parseNum } from '../util.js';
import { furnType, furnSize, furnToPlan, hitFurniture, placeFurniture, snapToWalls, furnName } from '../furniture.js';
import { PlanFurniture, FurnitureSymbol, FurnitureHandles, furnHandles, FurnitureToolProps, FurnitureProps, FurnitureSummary, normRot } from './furniture.jsx';

const { useState, useRef, useEffect, useMemo, useCallback } = React;

const THICKNESS = [
  { value: 0.1, label: '10 cm (Trockenbau)' },
  { value: 0.115, label: '11,5 cm' },
  { value: 0.175, label: '17,5 cm' },
  { value: 0.24, label: '24 cm' },
  { value: 0.3, label: '30 cm' },
  { value: 0.365, label: '36,5 cm' },
  { value: 0.425, label: '42,5 cm' },
];
const OPENING_DEFAULTS = {
  window: { w: 1.26, h: 1.385, sill: 0.8 },
  door: { w: 0.885, h: 2.01, sill: 0 },
  opening: { w: 1.0, h: 2.1, sill: 0 },
};
const OPENING_NAMES = { window: 'Fenster', door: 'Tür', opening: 'Durchgang' };
const r3 = (v) => Math.round(v * 1000) / 1000;
const P3 = (p) => [r3(p[0]), r3(p[1])];
const LINE_STATUS = [
  { value: 'bestand', label: 'Bestand' },
  { value: 'geplant', label: 'Geplant' },
  { value: 'stillgelegt', label: 'Stillgelegt' },
];

// ---------- installation lines (points are [x, y, z] with z = height above the floor) ----------
const zoneZ = (opts, floor) => (opts.zone === 'custom' ? opts.z ?? 0.3 : LINE_ZONES.find((z) => z.key === opts.zone)?.z(floor) ?? 0.3);
const defaultZone = (kind) => (kind === 'lueftung' ? 'oben' : kind === 'abwasser' || kind === 'heizung' ? 'boden' : 'unten');
function hitLine(p, lines, tol) {
  let best = null;
  for (const l of lines) {
    const pts = l.pts || [];
    if (l.riser && pts.length && dist(p, pts[0]) < tol * 1.4) return { line: l, d: 0 };
    for (let i = 1; i < pts.length; i++) {
      if (same(pts[i - 1], pts[i], 0.002)) continue;
      const d = distToSeg(p, pts[i - 1], pts[i]).d;
      if (d < tol && (!best || d < best.d)) best = { line: l, d };
    }
  }
  return best;
}
// ---------- connection points (outlets, switches, lamps, taps) ----------
// Wall-mounted kinds sit on the wall face nearest to the click; rot is the direction (degrees) the face points to.
function snapFixture(p, kind, walls, grid) {
  if (fixtureKind(kind).wall) {
    let best = null;
    for (const w of walls) {
      const r = distToSeg(p, w.a, w.b);
      if (r.d < w.t / 2 + 0.6 && (!best || r.d - w.t / 2 < best.d)) best = { w, r, d: r.d - w.t / 2 };
    }
    if (best) {
      const { w, r } = best;
      const n = perp(norm(sub(w.b, w.a)));
      const side = (p[0] - r.q[0]) * n[0] + (p[1] - r.q[1]) * n[1] < 0 ? -1 : 1;
      const q = add(r.q, mul(n, side * (w.t / 2)));
      return { p: P3(q), rot: Math.round((Math.atan2(n[1] * side, n[0] * side) * 180) / Math.PI) };
    }
  }
  return { p: [r3(Math.round(p[0] / grid) * grid), r3(Math.round(p[1] / grid) * grid)], rot: null };
}
function hitPoint(p, points, tol) {
  let best = null;
  for (const q of points) {
    const d = dist(p, [q.x, q.y]);
    if (d < tol && (!best || d < best.d)) best = { pt: q, d };
  }
  return best?.pt || null;
}
// a drawn line that ends on a fixture goes into the wall axis, to the fixture height and out to the face
function wireEnds(pts, points, walls) {
  let out = pts.map((q) => [...q]);
  const fix = (q) => points.find((x) => dist([x.x, x.y], q) < 0.02);
  const seq = (q) => {
    const pt = fix(q);
    if (!pt) return null;
    const A = fixtureAnchor(pt, walls);
    const zl = q[2] ?? 0,
      zf = pt.z ?? 0.3;
    return [[A[0], A[1], zl], [A[0], A[1], zf], [pt.x, pt.y, zf]].map((v) => v.map(r3));
  };
  const e = seq(out[out.length - 1]);
  if (e) out = [...out.slice(0, -1), ...e];
  const b = seq(out[0]);
  if (b) out = [...b.reverse(), ...out.slice(1)];
  return dedup3(out.map((q) => [q[0], q[1], q[2] ?? 0]));
}

// ---------- geometry helpers ----------
function wallFrame(w) {
  const L = dist(w.a, w.b);
  const u = norm(sub(w.b, w.a));
  const n = perp(u);
  return { L, u, n };
}

function wallSolidPolys(w) {
  const { L, u, n } = wallFrame(w);
  const e = w.ext ? w.t / 2 : 0;
  const h = w.t / 2;
  const segs = [];
  let cur = -e;
  for (const o of [...(w.openings || [])].sort((a, b) => a.pos - b.pos)) {
    const o0 = Math.max(0, o.pos - o.w / 2),
      o1 = Math.min(L, o.pos + o.w / 2);
    if (o0 > cur) segs.push([cur, o0]);
    cur = Math.max(cur, o1);
  }
  if (L + e > cur) segs.push([cur, L + e]);
  return segs.map(([s0, s1]) => {
    const p0 = add(w.a, mul(u, s0)),
      p1 = add(w.a, mul(u, s1));
    return [add(p0, mul(n, h)), add(p1, mul(n, h)), add(p1, mul(n, -h)), add(p0, mul(n, -h))];
  });
}

function refreshRooms(floor) {
  const walls = floor.walls || [];
  const faces = planarFaces(wallSegs(walls));
  const rooms = (floor.rooms || []).map((r) => {
    if (r.manual || !r.poly?.length) return r;
    const seed = labelPoint(r.poly);
    const c = faces.filter((f) => pointInPoly(seed, f.poly)).sort((a, b) => a.area - b.area)[0];
    if (!c) return r;
    return { ...r, poly: roomInnerPolygon(c.poly, walls).map(P3) };
  });
  return { ...floor, rooms };
}

function snapPoint(raw, { from, walls, s, grid, ortho, extra = [] }) {
  const tolE = 11 / s;
  let best = null,
    bd = tolE;
  for (const w of walls)
    for (const q of [w.a, w.b]) {
      const d = dist(raw, q);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
  for (const q of extra) {
    const d = dist(raw, q);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  if (best) return { p: [...best], kind: 'end' };
  let p = raw,
    kind = 'grid';
  if (from && ortho) {
    const o = orthoSnap(from, raw, 7);
    if (o !== raw) {
      p = o;
      kind = 'ortho';
    }
  }
  const tolW = 9 / s;
  let bw = null,
    bwd = tolW;
  for (const w of walls) {
    const r = distToSeg(p, w.a, w.b);
    if (r.d < bwd) {
      bwd = r.d;
      bw = { w, r };
    }
  }
  if (bw) {
    if (from && kind === 'ortho') {
      const x = lineIntersect(from, sub(p, from), bw.w.a, sub(bw.w.b, bw.w.a));
      if (x && distToSeg(x, bw.w.a, bw.w.b).d < 0.002) return { p: P3(x), kind: 'on' };
    }
    return { p: P3(bw.r.q), kind: 'on' };
  }
  if (from && kind === 'ortho') {
    const v = sub(p, from);
    const Lr = Math.round(len(v) / grid) * grid;
    return { p: P3(add(from, mul(norm(v), Lr))), kind };
  }
  return { p: [r3(Math.round(p[0] / grid) * grid), r3(Math.round(p[1] / grid) * grid)], kind };
}

// door and window edges (wall axis and both faces) as snap points for dimensions
function jambPoints(walls) {
  const out = [];
  for (const w of walls) {
    const { u, n } = wallFrame(w);
    for (const o of w.openings || [])
      for (const e of [o.pos - o.w / 2, o.pos + o.w / 2]) {
        const c = add(w.a, mul(u, e));
        out.push(P3(c), P3(add(c, mul(n, w.t / 2))), P3(add(c, mul(n, -w.t / 2))));
      }
  }
  return out;
}
function hitDim(p, dims, tol) {
  let best = null;
  for (const d of dims) {
    const r = distToSeg(p, d.a, d.b).d;
    if (r < tol && (!best || r < best.r)) best = { d, r };
  }
  return best?.d || null;
}

function hitOpening(p, walls, tol) {
  for (const w of walls) {
    const { L } = wallFrame(w);
    const r = distToSeg(p, w.a, w.b);
    if (r.d > w.t / 2 + tol) continue;
    const s = r.t * L;
    for (const o of w.openings || []) if (Math.abs(s - o.pos) <= o.w / 2) return { wall: w, opening: o };
  }
  return null;
}
function hitWall(p, walls, tol) {
  let best = null,
    bd = Infinity;
  for (const w of walls) {
    const r = distToSeg(p, w.a, w.b);
    if (r.d < w.t / 2 + tol && r.d < bd) {
      bd = r.d;
      best = w;
    }
  }
  return best;
}
function stairPoly(it) {
  const horiz = it.dir === 'e' || it.dir === 'w';
  return horiz
    ? [[it.x, it.y], [it.x + it.l, it.y], [it.x + it.l, it.y + it.w], [it.x, it.y + it.w]]
    : [[it.x, it.y], [it.x + it.w, it.y], [it.x + it.w, it.y + it.l], [it.x, it.y + it.l]];
}
const ptsAttr = (poly) => poly.map((p) => p.join(',')).join(' ');

// next floor names when stacking
function nextFloorName(floors, above) {
  const shorts = floors.map((f) => f.short);
  if (above) {
    const top = floors[floors.length - 1];
    if (!top) return { name: 'Erdgeschoss', short: 'EG' };
    if (top.short === 'KG') return { name: 'Erdgeschoss', short: 'EG' };
    if (top.short === 'EG') return { name: 'Obergeschoss', short: shorts.includes('OG') ? 'OG2' : 'OG' };
    if (/^OG/.test(top.short)) return { name: 'Dachgeschoss', short: 'DG' };
    return { name: 'Spitzboden', short: 'SB' };
  }
  return { name: 'Kellergeschoss', short: shorts.includes('KG') ? 'UG' : 'KG' };
}

// =====================================================================
export function PlanEditor({ data }) {
  const ui = useUI();
  const floors = sortFloors(Object.values(data.floors));
  const isRoof = ui.floorId === 'roof';
  const isSite = ui.floorId === 'site';
  const ctxId = String(ui.floorId || '').startsWith('ctx:') ? ui.floorId.slice(4) : null;
  const ctxB = ctxId ? (data.house?.model?.context || []).find((b) => b.id === ctxId) : null;
  const floor = isRoof || isSite || ctxId ? null : data.floors[ui.floorId] || floors.find((f) => f.short === 'EG') || floors[0];
  useEffect(() => {
    if (!isRoof && floor && ui.floorId !== floor.id) setUI({ floorId: floor.id });
    if (ctxId && !ctxB) setUI({ floorId: 'site' });
  }, [floor?.id, isRoof, ctxId, !!ctxB]);

  const addFloor = (above) => {
    const ref = above ? floors[floors.length - 1] : floors[0];
    const nm = nextFloorName(floors, above);
    const id = uid('f-');
    const h = ref?.height ?? 2.75;
    const elevation = ref ? (above ? ref.elevation + ref.height : ref.elevation - 2.45) : 0;
    const walls = (ref?.walls || []).filter((w) => w.ext).map((w) => ({ ...w, id: uid('w'), openings: [] }));
    putDoc('floors', id, { id, name: nm.name, short: nm.short, level: (ref?.level ?? 0) + (above ? 1 : -1), elevation: r3(elevation), height: above ? h : 2.45, slab: 0.2, walls, rooms: [], items: [] }, 50);
    setUI({ floorId: id });
    toast(`${nm.name} angelegt – Außenwände übernommen`);
  };

  return (
    <Sheet
      className={`plan-sheet ${ui.planFull ? 'is-full' : ''}`}
      title="Grundriss"
      icon="plan"
      eyebrow={isRoof ? 'Dach' : isSite ? 'Grundstück' : ctxB ? `Nebengebäude · ${ctxB.name || ''}` : floor ? `${floor.short} · ${floor.name}` : 'Etagen'}
      onClose={() => go('modell')}
      actions={
        <Btn small kind="ghost" icon="cube" onClick={() => { setUI({ mode: isRoof || isSite || ctxId ? 'all' : 'floor', floorId: isRoof || isSite || ctxId ? null : floor?.id }); go('modell'); }}>
          Im 3D-Modell
        </Btn>
      }
    >
      <div className="plan-layout" style={{ margin: '-16px -18px -24px', height: 'calc(100% + 40px)' }}>
        <div className="plan-floors">
          <button className={`fp-row ${isSite ? 'is-on' : ''}`} onClick={() => setUI({ floorId: 'site' })}>
            <span className="fp-short">
              <Icon name="tree" size={15} />
            </span>
            <span className="fp-name">
              <b>Grundstück</b>
              <span>{(data.house?.model?.context || []).filter((b) => b.kind !== 'neighbor').length} Nebengebäude</span>
            </span>
          </button>
          {(data.house?.model?.context || [])
            .filter((b) => b.kind !== 'neighbor' && ((b.walls || []).length || b.id === ctxId))
            .map((b) => (
              <button key={b.id} className={`fp-row fp-sub ${ctxId === b.id ? 'is-on' : ''}`} onClick={() => setUI({ floorId: 'ctx:' + b.id })}>
                <span className="fp-short">
                  <Icon name="home" size={13} />
                </span>
                <span className="fp-name">
                  <b>{b.name || 'Nebengebäude'}</b>
                  <span>{(b.rooms || []).length} Räume</span>
                </span>
              </button>
            ))}
          <button className={`fp-row ${isRoof ? 'is-on' : ''}`} onClick={() => setUI({ floorId: 'roof' })}>
            <span className="fp-short">
              <Icon name="roof" size={15} />
            </span>
            <span className="fp-name">
              <b>Dach</b>
              <span>{(data.house?.model?.roofSections || []).length} Flächen</span>
            </span>
          </button>
          {[...floors].reverse().map((f) => (
            <button key={f.id} className={`fp-row ${floor?.id === f.id ? 'is-on' : ''}`} onClick={() => setUI({ floorId: f.id })}>
              <span className="fp-short">{f.short}</span>
              <span className="fp-name">
                <b>{f.name}</b>
                <span>{(f.rooms || []).length} Räume</span>
              </span>
            </button>
          ))}
          <Btn small kind="ghost" icon="plus" onClick={() => addFloor(true)}>
            Etage oben
          </Btn>
          <Btn small kind="ghost" icon="plus" onClick={() => addFloor(false)}>
            Etage unten
          </Btn>
        </div>
        {ctxB ? <CtxFloorEditor key={ctxB.id} data={data} b={ctxB} /> : isSite ? <SiteEditor data={data} floors={floors} /> : isRoof ? <RoofEditor data={data} floors={floors} /> : floor ? <FloorEditor key={floor.id} data={data} floor={floor} floors={floors} /> : <Empty title="Keine Etage" />}
      </div>
    </Sheet>
  );
}

// Properties column; on phones a bottom panel over the plan that opens when something is selected.
function PropsPanel({ title, openKey, children }) {
  const [open, setOpen] = useState(!!openKey);
  useEffect(() => setOpen(!!openKey), [openKey]);
  return (
    <div className={`plan-props ${open ? 'is-open' : ''}`}>
      <button type="button" className="props-handle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <Icon name={open ? 'chevD' : 'chevU'} size={16} />
      </button>
      <div className="props-body">{children}</div>
    </div>
  );
}
function FullBtn() {
  const ui = useUI();
  return <IconBtn icon={ui.planFull ? 'collapse' : 'expand'} label={ui.planFull ? 'Vollbild beenden' : 'Vollbild'} size={16} onClick={() => setUI({ planFull: !ui.planFull })} />;
}

// =====================================================================
function useViewport(boxRef, fitPoints, key) {
  const [size, setSize] = useState({ w: 600, h: 500 });
  const [view, setView] = useState(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 600, h: el.clientHeight || 500 }));
    ro.observe(el);
    setSize({ w: el.clientWidth || 600, h: el.clientHeight || 500 });
    return () => ro.disconnect();
  }, []);
  const fit = useCallback(() => {
    const pts = fitPoints();
    const bb = pts.length ? bbox(pts) : { minX: 0, minY: 0, w: 10, h: 8 };
    const pad = 46;
    const s = Math.max(8, Math.min(220, Math.min((size.w - 2 * pad) / Math.max(bb.w, 2), (size.h - 2 * pad) / Math.max(bb.h, 2))));
    setView({ s, tx: (size.w - bb.w * s) / 2 - bb.minX * s, ty: (size.h - bb.h * s) / 2 - bb.minY * s });
  }, [size.w, size.h, fitPoints]);
  useEffect(() => {
    if (size.w > 50) fit();
  }, [key, size.w > 50 ? Math.round(size.w / 80) : 0, size.h > 50 ? Math.round(size.h / 80) : 0]);
  return { size, view: view || { s: 40, tx: 40, ty: 40 }, setView, fit };
}

function Grid({ view, size }) {
  const { s, tx, ty } = view;
  const x0 = -tx / s,
    y0 = -ty / s,
    x1 = (size.w - tx) / s,
    y1 = (size.h - ty) / s;
  const step = s > 90 ? 0.1 : s > 30 ? 0.5 : 1;
  const lines = [];
  const startX = Math.floor(x0 / step) * step,
    startY = Math.floor(y0 / step) * step;
  let guard = 0;
  for (let x = startX; x <= x1 && guard < 600; x += step, guard++) {
    const major = Math.abs(x - Math.round(x)) < 1e-6;
    lines.push(<line key={'x' + guard} x1={x} x2={x} y1={y0} y2={y1} className={major ? 'svg-grid-major' : 'svg-grid-minor'} vectorEffect="non-scaling-stroke" />);
  }
  for (let y = startY; y <= y1 && guard < 1200; y += step, guard++) {
    const major = Math.abs(y - Math.round(y)) < 1e-6;
    lines.push(<line key={'y' + guard} y1={y} y2={y} x1={x0} x2={x1} className={major ? 'svg-grid-major' : 'svg-grid-minor'} vectorEffect="non-scaling-stroke" />);
  }
  return <g strokeWidth="1">{lines}</g>;
}

function usePanZoom(svgRef, view, setView) {
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const onWheel = useCallback(
    (e) => {
      e.preventDefault();
      const rect = svgRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left,
        my = e.clientY - rect.top;
      const f = Math.exp(-e.deltaY * 0.0015);
      setView((v) => {
        const s = Math.max(6, Math.min(400, v.s * f));
        const k = s / v.s;
        return { s, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
      });
    },
    [setView],
  );
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);
  return { pointers, pinch };
}

// =====================================================================
function FloorEditor({ data, floor, floors, persist, guide, ctx }) {
  const boxRef = useRef(null);
  const svgRef = useRef(null);
  const [tool, setTool] = useState('select');
  const [sel, setSel] = useState(null);
  const [chain, setChain] = useState(null); // {pts:[...]} walls or room polygon
  const [cursor, setCursor] = useState(null); // {p, kind}
  const [drag, setDrag] = useState(null);
  const [measure, setMeasure] = useState(null);
  const [typed, setTyped] = useState('');
  const [defaults, setDefaults] = useState({ t: 0.115, ext: false });
  const [grid, setGrid] = useState(0.05);
  const [ortho, setOrtho] = useState(true);
  const [calib, setCalib] = useState(null); // {pts:[]}
  const [lineOpts, setLineOpts] = useState({ kind: 'strom', zone: 'unten', z: 0.3, status: 'bestand', rFrom: 0, rTo: null });
  const [fixOpts, setFixOpts] = useState({ kind: 'steckdose', z: null, status: 'bestand', count: 1 });
  const [furnKey, setFurnKey] = useState('sofa3');
  const ui = useUI();
  const showLines = ui.planLines !== false || tool === 'line' || tool === 'riser' || tool === 'fixture';
  const showFurn = ui.planFurniture !== false || tool === 'furniture';
  const hist = useRef({ undo: [], redo: [] });
  const floorRef = useRef(floor);
  floorRef.current = floor;
  const walls = floor.walls || [];
  const lines = floor.lines || [];
  const points = floor.points || [];
  const dims = floor.dims || [];
  const furniture = floor.furniture || [];
  const fitPts = useCallback(() => walls.flatMap((w) => [w.a, w.b]).concat(guide ? [[guide.x - 1, guide.y - 1], [guide.x + guide.w + 1, guide.y + guide.d + 1]] : []).concat(floor.underlay ? [[floor.underlay.x, floor.underlay.y], [floor.underlay.x + floor.underlay.w, floor.underlay.y + floor.underlay.w * (floor.underlay.aspect || 0.7)]] : []), [floor.id]);
  const { size, view, setView, fit } = useViewport(boxRef, fitPts, floor.id);
  const { pointers, pinch } = usePanZoom(svgRef, view, setView);
  const below = floors[floors.findIndex((f) => f.id === floor.id) - 1];

  // floors are documents; an outbuilding plan is stored inside its site entry
  const write = (n, delay) => (persist ? persist(n, delay) : putDoc('floors', n.id, n, delay));
  const save = (next, { undo = true, refresh = true, from } = {}) => {
    const cur = floorRef.current;
    const n = relink(refresh ? refreshRooms(next) : next);
    if (undo) {
      hist.current.undo.push(JSON.stringify(from || cur));
      if (hist.current.undo.length > 60) hist.current.undo.shift();
      hist.current.redo = [];
    }
    write({ ...n, example: false }, 350);
  };
  const mutate = (fn, opts) => save(fn(deepClone(floorRef.current)), opts);
  const undo = () => {
    const h = hist.current;
    if (!h.undo.length) return;
    h.redo.push(JSON.stringify(floorRef.current));
    write(JSON.parse(h.undo.pop()), 200);
    setSel(null);
  };
  const redo = () => {
    const h = hist.current;
    if (!h.redo.length) return;
    h.undo.push(JSON.stringify(floorRef.current));
    write(JSON.parse(h.redo.pop()), 200);
    setSel(null);
  };

  // connect fixtures drawn before the automatic connection pieces existed
  useEffect(() => {
    const n = relink(floor);
    if (JSON.stringify(n.lines || []) !== JSON.stringify(floor.lines || [])) write(n, 600);
  }, [floor.id]);

  const toWorld = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return [(e.clientX - r.left - view.tx) / view.s, (e.clientY - r.top - view.ty) / view.s];
  };
  const wiring = tool === 'line' || tool === 'riser' || tool === 'select' || tool === 'measure';
  const measuring = tool === 'measure' || (tool === 'select' && sel?.kind === 'dim');
  const snapOpts = (from) => ({
    from, walls, s: view.s, grid, ortho,
    extra: [...(chain?.pts || []), ...(wiring ? [...points.map((q) => [q.x, q.y]), ...lines.filter((l) => !l.auto).flatMap((l) => linePlanPts(l))] : []), ...(measuring ? jambPoints(walls) : [])],
  });

  const deleteSelection = () => {
    if (!sel) return;
    if (sel.kind === 'wall') mutate((f) => ({ ...f, walls: f.walls.filter((w) => w.id !== sel.id) }));
    if (sel.kind === 'opening') mutate((f) => ({ ...f, walls: f.walls.map((w) => (w.id === sel.wallId ? { ...w, openings: w.openings.filter((o) => o.id !== sel.id) } : w)) }), { refresh: false });
    if (sel.kind === 'room') mutate((f) => ({ ...f, rooms: f.rooms.filter((r) => r.id !== sel.id) }), { refresh: false });
    if (sel.kind === 'item') mutate((f) => ({ ...f, items: f.items.filter((r) => r.id !== sel.id) }), { refresh: false });
    if (sel.kind === 'line') mutate((f) => ({ ...f, lines: (f.lines || []).filter((l) => l.id !== sel.id) }), { refresh: false });
    if (sel.kind === 'dim') mutate((f) => ({ ...f, dims: (f.dims || []).filter((d) => d.id !== sel.id) }), { refresh: false });
    if (sel.kind === 'point') mutate((f) => ({ ...f, points: (f.points || []).filter((q) => q.id !== sel.id), lines: (f.lines || []).filter((l) => l.stubFor !== sel.id) }), { refresh: false });
    if (sel.kind === 'furn') mutate((f) => ({ ...f, furniture: (f.furniture || []).filter((x) => x.id !== sel.id) }), { refresh: false });
    setSel(null);
  };

  const setFurn = (id, patch) => mutate((f) => ({ ...f, furniture: (f.furniture || []).map((x) => (x.id === id ? { ...x, ...patch } : x)) }), { refresh: false });

  // adds a point to the line being drawn; a changed height first adds a vertical piece
  const lineStep = (pts, sp, z) => {
    const last = pts[pts.length - 1];
    const next = [...pts];
    if (last && Math.abs((last[2] ?? 0) - z) > 0.005) next.push([last[0], last[1], r3(z)]);
    next.push([r3(sp[0]), r3(sp[1]), r3(z)]);
    return next;
  };
  const changeLineOpts = (next) => {
    setLineOpts(next);
    if (tool === 'line' && chain?.pts.length) {
      const z = zoneZ(next, floor);
      const last = chain.pts[chain.pts.length - 1];
      if (Math.abs((last[2] ?? 0) - z) > 0.005) setChain({ ...chain, pts: [...chain.pts, [last[0], last[1], r3(z)]] });
    }
  };

  const finishChain = () => {
    if (tool === 'line' && chain && linePlanPts({ pts: chain.pts }).length >= 2) {
      const id = uid('l');
      const pts = wireEnds(chain.pts, points, walls);
      mutate((f) => ({ ...f, lines: [...(f.lines || []), { id, kind: lineOpts.kind, status: lineOpts.status, pts, label: '', notes: '' }] }), { refresh: false });
      toast(`${lineKind(lineOpts.kind).name}: ${fmtFixed(lineLength({ pts }), 2)} m eingezeichnet`);
    }
    if (tool === 'roomPoly' && chain?.pts.length >= 3) {
      const poly = chain.pts.map(P3);
      const id = uid('r');
      mutate((f) => ({ ...f, rooms: [...(f.rooms || []), { id, name: `Raum ${(f.rooms || []).length + 1}`, type: 'sonstiges', poly, manual: true, area: null, notes: '' }] }), { refresh: false });
      setSel({ kind: 'room', id });
      setTool('select');
    }
    setChain(null);
    setTyped('');
  };

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && document.activeElement?.id !== 'plan-typed';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (typing) return;
        e.preventDefault();
        redo();
        return;
      }
      if (typing) return;
      if (e.key === 'Escape') {
        if (chain) finishChain();
        else if (measure) setMeasure(null);
        else if (calib) setCalib(null);
        else setSel(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && document.activeElement?.id !== 'plan-typed') {
        e.preventDefault();
        deleteSelection();
      }
      if (e.key === 'Enter' && chain) finishChain();
      if (sel?.kind === 'furn' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const fi = furniture.find((x) => x.id === sel.id);
        if (!fi) return;
        const step = e.shiftKey ? 0.1 : 0.01;
        const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (e.key.toLowerCase() === 'r') {
          e.preventDefault();
          setFurn(fi.id, { rot: normRot((fi.rot || 0) + (e.shiftKey ? -90 : 90)) });
        } else if (mv) {
          e.preventDefault();
          setFurn(fi.id, { x: r3(fi.x + mv[0]), y: r3(fi.y + mv[1]) });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- pointer handling ----------
  const onDown = (e) => {
    svgRef.current.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: { ...view } };
      setDrag(null);
      return;
    }
    const p = toWorld(e);
    const tolM = 8 / view.s;
    if (e.button === 1 || e.button === 2 || tool === 'hand') {
      if (e.button === 2 && chain) return finishChain();
      setDrag({ kind: 'pan', x0: e.clientX, y0: e.clientY, view: { ...view } });
      return;
    }
    const selF = sel?.kind === 'furn' && showFurn && (tool === 'select' || tool === 'furniture') ? furniture.find((x) => x.id === sel.id) : null;
    if (selF) {
      const hh = furnHandles(selF, view.s);
      if (dist(p, hh.rot) < 12 / view.s) return setDrag({ kind: 'furnRot', id: selF.id, from: deepClone(floor) });
      if (dist(p, hh.size) < 10 / view.s) {
        const { w, d } = furnSize(selF);
        return setDrag({ kind: 'furnSize', id: selF.id, anchor: furnToPlan(selF, -w / 2, -d / 2), from: deepClone(floor) });
      }
    }
    if (tool === 'furniture') {
      const hf = hitFurniture(p, furniture, 6 / view.s);
      if (hf) {
        setSel({ kind: 'furn', id: hf.id });
        setDrag({ kind: 'furnMove', id: hf.id, p0: p, x0: hf.x, y0: hf.y, from: deepClone(floor) });
        return;
      }
      const nf = { id: uid('fu'), ...placeFurniture(furnKey, p, walls, grid) };
      mutate((f) => ({ ...f, furniture: [...(f.furniture || []), nf] }), { refresh: false });
      setSel({ kind: 'furn', id: nf.id });
      setCursor(null);
      return;
    }
    if (tool === 'line') {
      const sp = snapPoint(p, snapOpts(chain?.pts[chain.pts.length - 1])).p;
      const z = zoneZ(lineOpts, floor);
      if (!chain) return setChain({ pts: [[r3(sp[0]), r3(sp[1]), r3(z)]] });
      const last = chain.pts[chain.pts.length - 1];
      if (dist(last, sp) < 0.05) return finishChain();
      setChain({ pts: lineStep(chain.pts, sp, z) });
      return;
    }
    if (tool === 'fixture') {
      const hp = hitPoint(p, points, 9 / view.s);
      if (hp) {
        setSel({ kind: 'point', id: hp.id });
        setDrag({ kind: 'ptMove', id: hp.id, from: deepClone(floor) });
        return;
      }
      const sf = snapFixture(p, fixOpts.kind, walls, grid);
      const id = uid('pt');
      const k = fixtureKind(fixOpts.kind);
      mutate((f) => ({ ...f, points: [...(f.points || []), { id, kind: fixOpts.kind, x: sf.p[0], y: sf.p[1], z: r3(fixOpts.z ?? fixtureZ(fixOpts.kind, floor)), rot: sf.rot, status: fixOpts.status, count: k.multi ? fixOpts.count || 1 : 1, label: '', notes: '' }] }), { refresh: false });
      setSel({ kind: 'point', id });
      return;
    }
    if (tool === 'riser') {
      const sp = snapPoint(p, snapOpts()).p;
      const id = uid('l');
      const z0 = lineOpts.rFrom ?? 0,
        z1 = lineOpts.rTo ?? floor.height;
      mutate((f) => ({ ...f, lines: [...(f.lines || []), { id, kind: lineOpts.kind, status: lineOpts.status, riser: true, pts: [[r3(sp[0]), r3(sp[1]), r3(Math.min(z0, z1))], [r3(sp[0]), r3(sp[1]), r3(Math.max(z0, z1))]], label: '', notes: '' }] }), { refresh: false });
      setSel({ kind: 'line', id });
      setTool('select');
      return;
    }
    if (tool === 'wall') {
      const sp = snapPoint(p, snapOpts(chain?.pts[chain.pts.length - 1])).p;
      if (!chain) return setChain({ pts: [sp] });
      const last = chain.pts[chain.pts.length - 1];
      if (dist(last, sp) < 0.05) return finishChain();
      const id = uid('w');
      mutate((f) => ({ ...f, walls: [...f.walls, { id, a: P3(last), b: P3(sp), t: defaults.t, ext: defaults.ext, openings: [] }] }));
      if (same(sp, chain.pts[0]) && chain.pts.length > 1) return finishChain();
      setChain({ pts: [...chain.pts, sp] });
      setTyped('');
      return;
    }
    if (tool === 'roomPoly') {
      const sp = snapPoint(p, snapOpts(chain?.pts[chain.pts.length - 1])).p;
      if (chain && chain.pts.length >= 3 && dist(sp, chain.pts[0]) < 12 / view.s) return finishChain();
      setChain({ pts: [...(chain?.pts || []), sp] });
      return;
    }
    if (tool === 'room') {
      const existing = (floor.rooms || []).find((r) => r.poly && pointInPoly(p, r.poly));
      if (existing) {
        setSel({ kind: 'room', id: existing.id });
        return;
      }
      const f = faceAt(p, walls);
      if (!f) return toast('Kein geschlossener Bereich. Schließe die Wände oder zeichne den Raum als Polygon.', 'warn', 4200);
      const id = uid('r');
      const poly = roomInnerPolygon(f.poly, walls).map(P3);
      mutate((fl) => ({ ...fl, rooms: [...(fl.rooms || []), { id, name: `Raum ${(fl.rooms || []).length + 1}`, type: 'sonstiges', poly, area: null, notes: '' }] }), { refresh: false });
      setSel({ kind: 'room', id, focus: true });
      return;
    }
    if (tool === 'window' || tool === 'door' || tool === 'opening') {
      const w = hitWall(p, walls, 0.35);
      if (!w) return toast('Klicke auf eine Wand, um die Öffnung zu setzen.', 'warn');
      const { L } = wallFrame(w);
      const d = { ...OPENING_DEFAULTS[tool] };
      if (tool === 'door' && w.ext) d.w = 1.01;
      if (d.w > L - 0.1) d.w = Math.max(0.4, L - 0.1);
      let pos = distToSeg(p, w.a, w.b).t * L;
      pos = Math.max(d.w / 2 + 0.05, Math.min(L - d.w / 2 - 0.05, Math.round(pos / 0.01) * 0.01));
      const id = uid('o');
      mutate((f) => ({ ...f, walls: f.walls.map((x) => (x.id === w.id ? { ...x, openings: [...(x.openings || []), { id, type: tool, pos: r3(pos), ...d }] } : x)) }), { refresh: false });
      setSel({ kind: 'opening', id, wallId: w.id });
      return;
    }
    if (tool === 'stairs') {
      const sp = snapPoint(p, { ...snapOpts(), walls: [] }).p;
      setDrag({ kind: 'newStairs', a: sp, b: sp });
      return;
    }
    if (tool === 'measure') {
      const sp = snapPoint(p, snapOpts(measure && !measure.b ? measure.a : null)).p;
      if (!measure || measure.b) return setMeasure({ a: sp, b: null });
      if (dist(measure.a, sp) < 0.02) return;
      const id = uid('d');
      mutate((f) => ({ ...f, dims: [...(f.dims || []), { id, a: P3(measure.a), b: P3(sp), value: null, label: '' }] }), { refresh: false });
      setMeasure(null);
      setSel({ kind: 'dim', id, focus: true });
      return;
    }
    if (tool === 'underlay' && floor.underlay) {
      if (calib) {
        const pts = [...calib.pts, p];
        if (pts.length === 2) setCalib({ pts, ask: true });
        else setCalib({ pts });
        return;
      }
      setDrag({ kind: 'underlay', p0: p, u0: { ...floor.underlay }, from: deepClone(floor) });
      return;
    }
    // select tool
    if (sel?.kind === 'dim') {
      const d = dims.find((x) => x.id === sel.id);
      const end = d && ['a', 'b'].find((k) => dist(p, d[k]) < 10 / view.s);
      if (end) return setDrag({ kind: 'dimPt', id: d.id, end, from: deepClone(floor) });
    }
    const hd = hitDim(p, dims, tolM);
    if (hd) {
      setSel({ kind: 'dim', id: hd.id });
      setDrag({ kind: 'dimMove', id: hd.id, p0: p, a0: [...hd.a], b0: [...hd.b], from: deepClone(floor) });
      return;
    }
    if (showLines) {
      const hp = hitPoint(p, points, 9 / view.s);
      if (hp) {
        setSel({ kind: 'point', id: hp.id });
        setDrag({ kind: 'ptMove', id: hp.id, from: deepClone(floor) });
        return;
      }
    }
    if (sel?.kind === 'line' && showLines) {
      const l = lines.find((x) => x.id === sel.id);
      if (l) {
        const hp = linePlanPts(l).find((q) => dist(p, q) < 10 / view.s);
        if (hp) {
          const idx = l.pts.map((q, i) => (same(q, hp, 0.002) ? i : -1)).filter((i) => i >= 0);
          setDrag({ kind: 'linePt', id: l.id, idx, from: deepClone(floor) });
          return;
        }
        const hl = hitLine(p, [l], tolM);
        if (hl) {
          setDrag({ kind: 'lineMove', id: l.id, p0: p, pts0: l.pts.map((q) => [...q]), from: deepClone(floor) });
          return;
        }
      }
    }
    // a click right inside a piece of furniture beats a line running next to or under it
    if (showFurn && !hitWall(p, walls, 0)) {
      const hf = hitFurniture(p, furniture, 0);
      if (hf) {
        setSel({ kind: 'furn', id: hf.id });
        setDrag({ kind: 'furnMove', id: hf.id, p0: p, x0: hf.x, y0: hf.y, from: deepClone(floor) });
        return;
      }
    }
    if (showLines) {
      const hl = hitLine(p, lines, tolM);
      if (hl) {
        setSel({ kind: 'line', id: hl.line.id });
        setDrag({ kind: 'lineMove', id: hl.line.id, p0: p, pts0: hl.line.pts.map((q) => [...q]), from: deepClone(floor) });
        return;
      }
    }
    if (sel?.kind === 'wall') {
      const w = walls.find((x) => x.id === sel.id);
      if (w) {
        for (const end of ['a', 'b'])
          if (dist(p, w[end]) < 10 / view.s) {
            setDrag({ kind: 'end', wallId: w.id, end, orig: [...w[end]], links: linkedEnds(walls, w[end]), from: deepClone(floor) });
            return;
          }
      }
    }
    if (showFurn && !hitWall(p, walls, 0)) {
      const hf = hitFurniture(p, furniture, 6 / view.s);
      if (hf) {
        setSel({ kind: 'furn', id: hf.id });
        setDrag({ kind: 'furnMove', id: hf.id, p0: p, x0: hf.x, y0: hf.y, from: deepClone(floor) });
        return;
      }
    }
    const ho = hitOpening(p, walls, tolM);
    if (ho) {
      setSel({ kind: 'opening', id: ho.opening.id, wallId: ho.wall.id });
      setDrag({ kind: 'opening', wallId: ho.wall.id, id: ho.opening.id, from: deepClone(floor) });
      return;
    }
    const hw = hitWall(p, walls, tolM);
    if (hw) {
      setSel({ kind: 'wall', id: hw.id });
      setDrag({ kind: 'wall', wallId: hw.id, p0: p, a0: [...hw.a], b0: [...hw.b], linksA: linkedEnds(walls, hw.a, hw.id), linksB: linkedEnds(walls, hw.b, hw.id), from: deepClone(floor) });
      return;
    }
    const st = (floor.items || []).find((it) => it.type === 'stairs' && pointInPoly(p, stairPoly(it)));
    if (st) {
      setSel({ kind: 'item', id: st.id });
      setDrag({ kind: 'item', id: st.id, p0: p, x0: st.x, y0: st.y, from: deepClone(floor) });
      return;
    }
    const rm = (floor.rooms || []).find((r) => r.poly && pointInPoly(p, r.poly));
    if (rm) {
      setSel({ kind: 'room', id: rm.id });
      return;
    }
    setDrag({ kind: 'pan', x0: e.clientX, y0: e.clientY, view: { ...view }, clear: true });
  };

  const onMove = (e) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const pc = pinch.current;
      const rect = svgRef.current.getBoundingClientRect();
      const k = d / pc.d;
      const s = Math.max(6, Math.min(400, pc.view.s * k));
      const mx = pc.cx - rect.left,
        my = pc.cy - rect.top;
      const ncx = (a.x + b.x) / 2 - rect.left,
        ncy = (a.y + b.y) / 2 - rect.top;
      setView({ s, tx: ncx - (mx - pc.view.tx) * (s / pc.view.s), ty: ncy - (my - pc.view.ty) * (s / pc.view.s) });
      return;
    }
    const p = toWorld(e);
    if (!drag) {
      if (tool === 'wall' || tool === 'roomPoly' || tool === 'measure' || tool === 'stairs' || tool === 'line' || tool === 'riser') {
        const from = tool === 'measure' ? (measure && !measure.b ? measure.a : null) : chain?.pts[chain.pts.length - 1];
        setCursor(snapPoint(p, snapOpts(from)));
      } else if (tool === 'window' || tool === 'door' || tool === 'opening') {
        const w = hitWall(p, walls, 0.35);
        setCursor(w ? { p, wall: w } : null);
      } else if (tool === 'furniture' && e.pointerType !== 'touch') {
        setCursor(hitFurniture(p, furniture, 6 / view.s) ? null : { p, furn: { id: 'ghost', ...placeFurniture(furnKey, p, walls, grid) } });
      } else if (cursor) setCursor(null);
      return;
    }
    if (drag.kind === 'pan') {
      const dx = e.clientX - drag.x0,
        dy = e.clientY - drag.y0;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      setView({ ...drag.view, tx: drag.view.tx + dx, ty: drag.view.ty + dy });
      return;
    }
    const f = deepClone(drag.from);
    if (drag.kind === 'end') {
      const others = drag.from.walls.filter((w) => !drag.links.some((l) => l.id === w.id));
      const w0 = f.walls.find((w) => w.id === drag.wallId);
      const fixed = drag.end === 'a' ? w0.b : w0.a;
      const sp = snapPoint(p, { from: fixed, walls: others, s: view.s, grid, ortho }).p;
      for (const w of f.walls) for (const end of ['a', 'b']) if (drag.links.some((l) => l.id === w.id && l.end === end)) w[end] = sp;
      save(f, { undo: false });
      drag.moved = true;
      return;
    }
    if (drag.kind === 'wall') {
      const w = f.walls.find((x) => x.id === drag.wallId);
      const { n } = wallFrame({ a: drag.a0, b: drag.b0 });
      let d = sub(p, drag.p0);
      const along = d[0] * n[0] + d[1] * n[1];
      const step = Math.round(along / grid) * grid;
      d = mul(n, step);
      if (Math.abs(step) < 1e-6) return;
      const na = P3(add(drag.a0, d)),
        nb = P3(add(drag.b0, d));
      for (const x of f.walls) {
        for (const end of ['a', 'b']) {
          if (drag.linksA.some((l) => l.id === x.id && l.end === end)) x[end] = na;
          if (drag.linksB.some((l) => l.id === x.id && l.end === end)) x[end] = nb;
        }
      }
      w.a = na;
      w.b = nb;
      save(f, { undo: false });
      drag.moved = true;
      return;
    }
    if (drag.kind === 'opening') {
      const w = f.walls.find((x) => x.id === drag.wallId);
      const o = w.openings.find((x) => x.id === drag.id);
      const { L } = wallFrame(w);
      const pos = distToSeg(p, w.a, w.b).t * L;
      o.pos = r3(Math.max(o.w / 2, Math.min(L - o.w / 2, Math.round(pos / 0.01) * 0.01)));
      save(f, { undo: false, refresh: false });
      drag.moved = true;
      return;
    }
    if (drag.kind === 'linePt') {
      const l = f.lines.find((x) => x.id === drag.id);
      const sp = snapPoint(p, snapOpts()).p;
      for (const i of drag.idx) l.pts[i] = [r3(sp[0]), r3(sp[1]), l.pts[i][2] ?? 0];
      l.auto = false;
      save(f, { undo: false, refresh: false });
      drag.moved = true;
      return;
    }
    if (drag.kind === 'dimPt') {
      const d = f.dims.find((x) => x.id === drag.id);
      d[drag.end] = P3(snapPoint(p, snapOpts(d[drag.end === 'a' ? 'b' : 'a'])).p);
      save(f, { undo: false, refresh: false });
      drag.moved = true;
      return;
    }
    if (drag.kind === 'dimMove') {
      const d = f.dims.find((x) => x.id === drag.id);
      const dx = Math.round((p[0] - drag.p0[0]) / grid) * grid,
        dy = Math.round((p[1] - drag.p0[1]) / grid) * grid;
      if (!dx && !dy && !drag.moved) return;
      d.a = P3([drag.a0[0] + dx, drag.a0[1] + dy]);
      d.b = P3([drag.b0[0] + dx, drag.b0[1] + dy]);
      save(f, { undo: false, refresh: false });
      drag.moved = true;
      return;
    }
    if (drag.kind === 'ptMove') {
      const q = f.points.find((x) => x.id === drag.id);
      const sf = snapFixture(p, q.kind, f.walls || [], grid);
      if (!drag.moved && dist(sf.p, [q.x, q.y]) < 0.02) return;
      Object.assign(q, { x: sf.p[0], y: sf.p[1], rot: sf.rot });
      save(f, { undo: false, refresh: false });
      drag.moved = true;
      return;
    }
    if (drag.kind === 'lineMove') {
      const l = f.lines.find((x) => x.id === drag.id);
      const dx = Math.round((p[0] - drag.p0[0]) / grid) * grid,
        dy = Math.round((p[1] - drag.p0[1]) / grid) * grid;
      if (!dx && !dy && !drag.moved) return;
      l.pts = drag.pts0.map((q) => [r3(q[0] + dx), r3(q[1] + dy), q[2] ?? 0]);
      l.auto = false;
      save(f, { undo: false, refresh: false });
      drag.moved = true;
      return;
    }
    if (drag.kind === 'furnMove') {
      const it = (f.furniture || []).find((x) => x.id === drag.id);
      if (!it) return;
      const nx = r3(Math.round((drag.x0 + p[0] - drag.p0[0]) / grid) * grid),
        ny = r3(Math.round((drag.y0 + p[1] - drag.p0[1]) / grid) * grid);
      if (!drag.moved && Math.hypot(nx - drag.x0, ny - drag.y0) < 0.02) return;
      Object.assign(it, { x: nx, y: ny });
      // magnetic walls; hold Alt to place freely
      if (!e.altKey) {
        const sn = snapToWalls(it, f.walls || []);
        Object.assign(it, { x: sn.x, y: sn.y });
      }
      save(f, { undo: false, refresh: false });
      drag.moved = true;
      return;
    }
    if (drag.kind === 'furnRot') {
      const it = (f.furniture || []).find((x) => x.id === drag.id);
      if (!it) return;
      const dx = p[0] - it.x,
        dy = p[1] - it.y;
      if (Math.hypot(dx, dy) < 0.05) return;
      const step = e.shiftKey ? 1 : 15;
      it.rot = normRot(Math.round(((Math.atan2(-dx, dy) * 180) / Math.PI) / step) * step);
      save(f, { undo: false, refresh: false });
      drag.moved = true;
      return;
    }
    if (drag.kind === 'furnSize') {
      const it = (f.furniture || []).find((x) => x.id === drag.id);
      if (!it) return;
      const r = ((it.rot || 0) * Math.PI) / 180;
      const ux = [Math.cos(r), Math.sin(r)],
        uy = [-Math.sin(r), Math.cos(r)];
      const rel = sub(p, drag.anchor);
      const step = Math.min(grid, 0.05);
      const w = Math.max(0.05, r3(Math.round((rel[0] * ux[0] + rel[1] * ux[1]) / step) * step));
      const d = Math.max(0.05, r3(Math.round((rel[0] * uy[0] + rel[1] * uy[1]) / step) * step));
      Object.assign(it, { w, d, x: r3(drag.anchor[0] + (ux[0] * w) / 2 + (uy[0] * d) / 2), y: r3(drag.anchor[1] + (ux[1] * w) / 2 + (uy[1] * d) / 2) });
      save(f, { undo: false, refresh: false });
      drag.moved = true;
      return;
    }
    if (drag.kind === 'item') {
      const it = f.items.find((x) => x.id === drag.id);
      it.x = r3(Math.round((drag.x0 + p[0] - drag.p0[0]) / grid) * grid);
      it.y = r3(Math.round((drag.y0 + p[1] - drag.p0[1]) / grid) * grid);
      save(f, { undo: false, refresh: false });
      drag.moved = true;
      return;
    }
    if (drag.kind === 'underlay') {
      f.underlay = { ...drag.u0, x: r3(drag.u0.x + p[0] - drag.p0[0]), y: r3(drag.u0.y + p[1] - drag.p0[1]) };
      save(f, { undo: false, refresh: false });
      drag.moved = true;
      return;
    }
    if (drag.kind === 'newStairs') {
      setDrag({ ...drag, b: snapPoint(p, { ...snapOpts(), walls: [] }).p });
    }
  };

  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!drag) return;
    if (drag.kind === 'pan' && drag.clear && !drag.moved) setSel(null);
    if (drag.moved && drag.from) {
      hist.current.undo.push(JSON.stringify(drag.from));
      hist.current.redo = [];
    }
    if (drag.kind === 'newStairs') {
      const x = Math.min(drag.a[0], drag.b[0]),
        y = Math.min(drag.a[1], drag.b[1]);
      const W = Math.abs(drag.b[0] - drag.a[0]),
        H = Math.abs(drag.b[1] - drag.a[1]);
      if (W > 0.4 && H > 0.4) {
        const vertical = H >= W;
        const id = uid('s');
        mutate((f) => ({ ...f, items: [...(f.items || []), { id, type: 'stairs', x: r3(x), y: r3(y), w: r3(vertical ? W : H), l: r3(vertical ? H : W), dir: vertical ? 'n' : 'e' }] }), { refresh: false });
        setSel({ kind: 'item', id });
        setTool('select');
      }
    }
    setDrag(null);
  };

  // typed length while drawing a line: next point at that distance towards the cursor
  const applyTypedLine = () => {
    const L = parseNum(typed);
    if (!chain || !L || L <= 0) return;
    const last = chain.pts[chain.pts.length - 1];
    const target = cursor?.p || add(last, [1, 0]);
    const dir = norm(sub(target, [last[0], last[1]]));
    if (!len(dir)) return;
    const sp = P3(add([last[0], last[1]], mul(dir, L)));
    setChain({ pts: lineStep(chain.pts, sp, zoneZ(lineOpts, floor)) });
    setTyped('');
  };

  // typed length while drawing walls
  const applyTyped = () => {
    const L = parseNum(typed);
    if (!chain || !L || L <= 0) return;
    const last = chain.pts[chain.pts.length - 1];
    const target = cursor?.p || add(last, [1, 0]);
    const dir = norm(sub(target, last));
    if (!len(dir)) return;
    const sp = P3(add(last, mul(dir, L)));
    const id = uid('w');
    mutate((f) => ({ ...f, walls: [...f.walls, { id, a: P3(last), b: sp, t: defaults.t, ext: defaults.ext, openings: [] }] }));
    setChain({ pts: [...chain.pts, sp] });
    setTyped('');
  };

  // ---------- underlay ----------
  const ulUrl = floor.underlay ? (floor.underlay.assetId ? blobUrl(floor.underlay.assetId) : data.underlays?.[floor.id]?.dataUrl) : null;
  const fileRef = useRef(null);
  const uploadUnderlay = async (file) => {
    if (!file.type.startsWith('image/')) return toast('Bitte ein Bild (JPG/PNG) hochladen. PDF-Pläne vorher als Bild exportieren oder fotografieren.', 'warn', 5000);
    const img = await new Promise((res) => {
      const u = URL.createObjectURL(file);
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = u;
    });
    if (!img) return toast('Bild konnte nicht gelesen werden.', 'err');
    const aspect = img.height / img.width;
    const bb = walls.length ? bbox(walls.flatMap((w) => [w.a, w.b])) : { minX: 0, minY: 0, w: 12 };
    // an underlay whose image is still missing keeps its calibration
    const keep = floor.underlay && !floor.underlay.assetId && !data.underlays?.[floor.id] ? floor.underlay : null;
    const base = keep
      ? { x: keep.x, y: keep.y, w: keep.w, aspect, rot: keep.rot || 0, opacity: keep.opacity ?? 0.55 }
      : { x: r3(bb.minX - 1), y: r3(bb.minY - 1), w: r3(Math.max(12, bb.w + 2)), aspect, rot: 0, opacity: 0.55 };
    const assets = await getAssets();
    try {
      if (assets) {
        const res = await assets.upload(file, { type: file.type });
        mutate((f) => ({ ...f, underlay: { ...base, assetId: res.id } }), { refresh: false });
      } else {
        const mode = getState().mode;
        const blob = await downscaleImage(file, mode === 'db' ? 1200 : 1800, mode === 'db' ? 0.6 : 0.75);
        const dataUrl = await new Promise((res) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.readAsDataURL(blob);
        });
        if (mode === 'db' && dataUrl.length > 240000) return toast('Das Bild ist zu groß. Verwende einen kleineren Ausschnitt.', 'warn');
        putDoc('underlays', floor.id, { id: floor.id, dataUrl }, 50);
        mutate((f) => ({ ...f, underlay: { ...base, assetId: null } }), { refresh: false });
      }
      setTool('underlay');
      if (keep) return toast('Plan geladen und an der gespeicherten Position eingepasst.');
      setCalib({ pts: [] });
      toast('Plan geladen. Klicke zwei Punkte mit bekanntem Abstand, um den Maßstab festzulegen.', 'ok', 6000);
    } catch (e) {
      toast('Hochladen fehlgeschlagen.', 'err');
    }
  };
  const applyCalibration = (meters) => {
    const [p1, p2] = calib.pts;
    const d = dist(p1, p2);
    if (!meters || d < 0.01) return setCalib(null);
    const k = meters / d;
    mutate((f) => {
      const u = f.underlay;
      // scale around p1 so the first clicked point stays in place
      return { ...f, underlay: { ...u, x: r3(p1[0] - (p1[0] - u.x) * k), y: r3(p1[1] - (p1[1] - u.y) * k), w: r3(u.w * k) } };
    }, { refresh: false });
    setCalib(null);
    toast(`Maßstab gesetzt: ${fmtFixed(meters, 2)} m`);
  };

  // ---------- render ----------
  const { s, tx, ty } = view;
  const px = (n) => n / s;
  const selWall = sel?.kind === 'wall' ? walls.find((w) => w.id === sel.id) : null;
  const selOpening = sel?.kind === 'opening' ? walls.find((w) => w.id === sel.wallId)?.openings?.find((o) => o.id === sel.id) : null;
  const selRoom = sel?.kind === 'room' ? (floor.rooms || []).find((r) => r.id === sel.id) : null;
  const selItem = sel?.kind === 'item' ? (floor.items || []).find((r) => r.id === sel.id) : null;
  const selLine = sel?.kind === 'line' ? lines.find((l) => l.id === sel.id) : null;
  const selPoint = sel?.kind === 'point' ? points.find((q) => q.id === sel.id) : null;
  const selDim = sel?.kind === 'dim' ? dims.find((d) => d.id === sel.id) : null;
  const selFurn = sel?.kind === 'furn' ? furniture.find((x) => x.id === sel.id) : null;
  const hints = {
    select: selFurn ? 'Möbel ziehen verschiebt es (rastet an Wänden ein, Alt = frei), runder Griff dreht, Eckquadrat ändert die Größe. R dreht um 90°, Pfeiltasten verschieben um 1 cm.' : 'Klicken wählt Wände, Öffnungen, Räume, Treppen und Möbel. Wand ziehen verschiebt sie, Endpunkte ziehen ändert die Länge. Leere Fläche ziehen verschiebt die Ansicht.',
    furniture: `${furnType(furnKey).name} (${Math.round(furnType(furnKey).w * 100)} × ${Math.round(furnType(furnKey).d * 100)} cm): in den Grundriss klicken zum Platzieren. Ziehen verschiebt, runder Griff dreht, Eckquadrat ändert die Größe.`,
    wall: chain ? 'Weiter klicken für die nächste Wand · Länge eintippen + Enter · Esc oder Doppelklick beendet' : 'Startpunkt klicken. Punkte rasten an Wandenden und auf Wänden ein.',
    room: 'In einen geschlossenen Bereich klicken – der Raum wird aus den Wänden erkannt.',
    roomPoly: 'Eckpunkte klicken, ersten Punkt erneut klicken oder Enter zum Schließen.',
    window: 'Auf eine Wand klicken, um ein Fenster zu setzen.',
    door: 'Auf eine Wand klicken, um eine Tür zu setzen.',
    opening: 'Auf eine Wand klicken, um einen Durchgang zu setzen.',
    stairs: 'Rechteck aufziehen. Richtung danach rechts einstellen.',
    measure: measure && !measure.b ? 'Jetzt den Endpunkt klicken. Punkte rasten an Wänden, Tür- und Fensterkanten ein.' : 'Anfang und Ende klicken – z. B. Türbreite oder Abstand zwischen zwei Fenstern. Den vor Ort gemessenen Wert trägst du danach rechts ein.',
    line: chain ? 'Weiter klicken für den nächsten Punkt · Länge eintippen + Enter setzt das nächste Stück in Cursorrichtung · Höhe rechts ändern = senkrechtes Stück · Doppelklick beendet' : 'Startpunkt der Leitung klicken. Punkte rasten an Wänden ein. Art und Höhe stellst du rechts ein.',
    fixture: `${fixtureKind(fixOpts.kind).wall ? 'Klicke neben die Wand, an der der Anschluss sitzt – er rastet auf dieser Wandseite ein.' : 'Klicke die Stelle im Raum, an der die Lampe hängt.'} Weitere Klicks setzen weitere Anschlüsse, Ziehen verschiebt sie.`,
    riser: 'Klicke die Stelle, an der die Leitung senkrecht verläuft (z. B. Steigleitung, Fallrohr). Von- und Bis-Höhe stellst du rechts ein.',
    underlay: calib ? (calib.pts.length ? 'Jetzt den zweiten Punkt klicken.' : 'Ersten Punkt einer bekannten Strecke auf dem Plan klicken (z. B. Außenmaß).') : 'Plan ziehen verschiebt ihn. Maßstab über „Kalibrieren“ festlegen.',
  };

  return (
    <>
      <div className="plan-main">
        <div className="plan-tools" role="toolbar" aria-label="Werkzeuge">
          <Seg
            small
            value={tool}
            onChange={(t) => {
              setTool(t);
              if (t !== 'select') setSel(null);
              setChain(null);
              setMeasure(null);
              setCalib(null);
              setCursor(null);
              if (t === 'line' || t === 'riser' || t === 'fixture') setUI({ planLines: true });
            }}
            options={[
              { value: 'select', icon: 'cursor', title: 'Auswählen' },
              { value: 'wall', icon: 'wall', label: 'Wand' },
              { value: 'room', icon: 'room', label: 'Raum' },
              { value: 'window', icon: 'window', title: 'Fenster' },
              { value: 'door', icon: 'door', title: 'Tür' },
              { value: 'opening', icon: 'split', title: 'Durchgang' },
              { value: 'stairs', icon: 'stairs', title: 'Treppe' },
              { value: 'furniture', icon: 'sofa', title: 'Möbel' },
              { value: 'line', icon: 'pipe', title: 'Leitung (Kabel, Rohr)' },
              { value: 'riser', icon: 'riser', title: 'Steigleitung (senkrecht)' },
              { value: 'fixture', icon: 'socket', title: 'Anschluss (Steckdose, Schalter, Lampe, Netzwerk, Wasser, Gas)' },
              { value: 'roomPoly', icon: 'edit', title: 'Raum als Polygon' },
              { value: 'measure', icon: 'ruler', title: 'Maß eintragen (Maßlinie)' },
              { value: 'underlay', icon: 'image', title: 'Plan-Unterlage' },
            ].filter((o) => !ctx || o.value !== 'underlay')}
          />
        </div>
        <div className="plan-canvas" ref={boxRef}>
          <div className="plan-quick">
            <IconBtn icon={showLines ? 'eye' : 'eyeOff'} label={showLines ? 'Leitungen und Anschlüsse ausblenden' : 'Leitungen und Anschlüsse einblenden'} active={showLines && lines.length + points.length > 0} onClick={() => setUI({ planLines: !showLines })} />
            <IconBtn icon="sofa" className={showFurn ? '' : 'is-struck'} label={showFurn ? 'Möbel ausblenden' : 'Möbel einblenden'} active={showFurn && furniture.length > 0} aria-pressed={showFurn} onClick={() => { if (showFurn && selFurn) setSel(null); setUI({ planFurniture: !showFurn }); }} />
            <IconBtn icon="undo" label="Rückgängig (Strg+Z)" onClick={undo} disabled={!hist.current.undo.length} />
            <IconBtn icon="redo" label="Wiederholen (Strg+Y)" onClick={redo} disabled={!hist.current.redo.length} />
            <FullBtn />
          </div>
          <svg
            ref={svgRef}
            width={size.w}
            height={size.h}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onDoubleClick={() => chain && finishChain()}
            onContextMenu={(e) => e.preventDefault()}
            style={{ cursor: tool === 'select' ? (drag?.kind === 'pan' ? 'grabbing' : 'default') : tool === 'underlay' && !calib ? 'move' : 'crosshair' }}
            role="application"
            aria-label={`Grundriss ${floor.name}`}
          >
            <g transform={`translate(${tx},${ty}) scale(${s})`}>
              <Grid view={view} size={size} />
              {ulUrl ? (
                <image
                  href={ulUrl}
                  x={floor.underlay.x}
                  y={floor.underlay.y}
                  width={floor.underlay.w}
                  height={floor.underlay.w * (floor.underlay.aspect || 0.7)}
                  opacity={floor.underlay.opacity ?? 0.5}
                  transform={floor.underlay.rot ? `rotate(${floor.underlay.rot} ${floor.underlay.x} ${floor.underlay.y})` : undefined}
                  preserveAspectRatio="none"
                  style={{ pointerEvents: 'none' }}
                />
              ) : null}
              {guide ? <rect x={guide.x} y={guide.y} width={guide.w} height={guide.d} fill="none" stroke="var(--ink-3)" strokeWidth={px(1.2)} strokeDasharray={`${px(6)} ${px(4)}`} /> : null}
              {below
                ? (below.walls || []).map((w) => <line key={'g' + w.id} x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} className="svg-ghost" strokeWidth={w.t} opacity="0.35" />)
                : null}
              {(floor.rooms || []).map((r) => (
                <polygon key={r.id} points={ptsAttr(r.poly || [])} fill={ROOM_COLORS[r.type] || ROOM_COLORS.sonstiges} className={`svg-room ${sel?.id === r.id ? 'sel' : ''}`} strokeWidth={sel?.id === r.id ? px(2) : 0} vectorEffect="non-scaling-stroke" />
              ))}
              {showFurn ? <PlanFurniture list={furniture} sel={sel} px={px} /> : null}
              {(floor.items || [])
                .filter((it) => it.type === 'stairs')
                .map((it) => {
                  const poly = stairPoly(it);
                  const steps = Math.max(3, Math.round(floor.height / 0.18));
                  const lines = [];
                  for (let k = 1; k < steps; k++) {
                    const t = k / steps;
                    if (it.dir === 'n' || it.dir === 's') lines.push(<line key={k} x1={it.x} x2={it.x + it.w} y1={it.y + it.l * t} y2={it.y + it.l * t} />);
                    else lines.push(<line key={k} y1={it.y} y2={it.y + it.w} x1={it.x + it.l * t} x2={it.x + it.l * t} />);
                  }
                  const c = [it.x + (it.dir === 'e' || it.dir === 'w' ? it.l : it.w) / 2, it.y + (it.dir === 'e' || it.dir === 'w' ? it.w : it.l) / 2];
                  const ang = { n: -90, s: 90, e: 0, w: 180 }[it.dir] || -90;
                  return (
                    <g key={it.id}>
                      <polygon points={ptsAttr(poly)} className="svg-stairs" strokeWidth={px(sel?.id === it.id ? 2.5 : 1)} style={sel?.id === it.id ? { stroke: 'var(--accent)' } : undefined} />
                      <g stroke="var(--ink-3)" strokeWidth={px(1)}>
                        {lines}
                      </g>
                      <g transform={`translate(${c[0]},${c[1]}) rotate(${ang})`}>
                        <line x1={-Math.min(it.l, 2) / 2.4} x2={Math.min(it.l, 2) / 2.4} y1={0} y2={0} stroke="var(--ink-2)" strokeWidth={px(1.5)} />
                        <path d={`M${Math.min(it.l, 2) / 2.4},0 l${-px(8)},${-px(5)} l0,${px(10)} z`} fill="var(--ink-2)" />
                      </g>
                    </g>
                  );
                })}
              {walls.map((w) => (
                <g key={w.id}>
                  {wallSolidPolys(w).map((poly, i) => (
                    <polygon key={i} points={ptsAttr(poly)} className={`svg-wall ${w.ext ? 'ext' : ''} ${sel?.kind === 'wall' && sel.id === w.id ? 'sel' : ''}`} />
                  ))}
                  {(w.openings || []).map((o) => {
                    const { u, n } = wallFrame(w);
                    const c = add(w.a, mul(u, o.pos));
                    const h = w.t / 2;
                    const a0 = add(c, mul(u, -o.w / 2)),
                      a1 = add(c, mul(u, o.w / 2));
                    const isSel = sel?.kind === 'opening' && sel.id === o.id;
                    const rect = [add(a0, mul(n, h)), add(a1, mul(n, h)), add(a1, mul(n, -h)), add(a0, mul(n, -h))];
                    if (o.type === 'window')
                      return (
                        <g key={o.id}>
                          <polygon points={ptsAttr(rect)} className="svg-window" strokeWidth={px(isSel ? 2.5 : 1.2)} style={isSel ? { stroke: 'var(--accent)' } : undefined} />
                          <line x1={a0[0]} y1={a0[1]} x2={a1[0]} y2={a1[1]} stroke="var(--info)" strokeWidth={px(1.2)} />
                        </g>
                      );
                    if (o.type === 'door') {
                      const side = o.flip ? -1 : 1;
                      const hinge = o.hinge === 'b' ? a1 : a0;
                      const other = o.hinge === 'b' ? a0 : a1;
                      const leaf = add(hinge, mul(n, side * o.w));
                      const sweep = (o.hinge === 'b') !== (side < 0) ? 1 : 0;
                      return (
                        <g key={o.id}>
                          <polygon points={ptsAttr(rect)} fill="var(--surface-2)" stroke={isSel ? 'var(--accent)' : 'none'} strokeWidth={px(2.5)} />
                          <line x1={hinge[0]} y1={hinge[1]} x2={leaf[0]} y2={leaf[1]} className="svg-door" strokeWidth={px(1.6)} />
                          <path d={`M${leaf[0]},${leaf[1]} A${o.w},${o.w} 0 0 ${sweep} ${other[0]},${other[1]}`} className="svg-door" strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(2)}`} />
                        </g>
                      );
                    }
                    return <polygon key={o.id} points={ptsAttr(rect)} fill="var(--surface-2)" stroke={isSel ? 'var(--accent)' : 'var(--ink-3)'} strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} />;
                  })}
                </g>
              ))}
              {(floor.rooms || []).map((r) => {
                if (!r.poly?.length) return null;
                const lp = labelPoint(r.poly);
                const fs = Math.min(px(13), 0.45);
                return (
                  <g key={'l' + r.id}>
                    <text x={lp[0]} y={lp[1] - fs * 0.15} textAnchor="middle" className="svg-room-label" fontSize={fs} fontWeight="600">
                      {r.name}
                    </text>
                    <text x={lp[0]} y={lp[1] + fs * 1.05} textAnchor="middle" className="svg-room-area" fontSize={fs * 0.82}>
                      {fmtFixed(roomArea(r), 2)} m²
                    </text>
                  </g>
                );
              })}
              {showLines ? <PassingRisers floor={floor} floors={floors} px={px} /> : null}
              {showLines ? <PlanLines lines={lines} sel={sel} px={px} /> : null}
              {showLines ? <PlanPoints points={points} sel={sel} px={px} /> : null}
              {chain && tool === 'line' ? <LinePreview pts={chain.pts} cursor={cursor?.p} kind={lineOpts.kind} px={px} /> : null}
              {cursor?.furn && tool === 'furniture' ? <FurnitureSymbol f={cursor.furn} px={px} ghost /> : null}
              {selFurn && showFurn ? <FurnitureHandles f={selFurn} px={px} s={s} /> : null}
              {selWall ? <WallDims w={selWall} px={px} /> : null}
              {selWall
                ? ['a', 'b'].map((end) => <circle key={end} cx={selWall[end][0]} cy={selWall[end][1]} r={px(6)} className="svg-handle" strokeWidth={px(2)} />)
                : null}
              {chain && cursor && (tool === 'wall' || tool === 'roomPoly') ? (
                <DrawPreview chain={chain} cursor={cursor} px={px} t={tool === 'wall' ? defaults.t : null} />
              ) : null}
              {chain && tool === 'roomPoly' ? <polyline points={ptsAttr(chain.pts)} fill="none" className="svg-preview" strokeWidth={px(2)} /> : null}
              {cursor && (tool === 'wall' || tool === 'roomPoly' || tool === 'measure' || tool === 'stairs' || tool === 'line' || tool === 'riser') ? (
                <g>
                  <circle cx={cursor.p[0]} cy={cursor.p[1]} r={px(cursor.kind === 'end' ? 7 : 5)} className="svg-snap" strokeWidth={px(2)} />
                  {cursor.kind === 'on' ? <rect x={cursor.p[0] - px(4)} y={cursor.p[1] - px(4)} width={px(8)} height={px(8)} className="svg-snap" strokeWidth={px(1.5)} /> : null}
                </g>
              ) : null}
              {cursor?.wall && (tool === 'window' || tool === 'door' || tool === 'opening') ? <OpeningGhost w={cursor.wall} p={cursor.p} type={tool} px={px} /> : null}
              {drag?.kind === 'newStairs' ? (
                <rect x={Math.min(drag.a[0], drag.b[0])} y={Math.min(drag.a[1], drag.b[1])} width={Math.abs(drag.b[0] - drag.a[0])} height={Math.abs(drag.b[1] - drag.a[1])} className="svg-stairs" strokeWidth={px(1.5)} style={{ stroke: 'var(--accent)' }} />
              ) : null}
              <DimLines dims={dims} sel={sel} px={px} />
              {measure ? <MeasureLine a={measure.a} b={measure.b || cursor?.p} px={px} /> : null}
              {calib?.pts?.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={px(6)} fill="var(--warn)" />)}
              {calib?.pts?.length === 2 ? <line x1={calib.pts[0][0]} y1={calib.pts[0][1]} x2={calib.pts[1][0]} y2={calib.pts[1][1]} stroke="var(--warn)" strokeWidth={px(2)} /> : null}
            </g>
          </svg>
          {chain && tool === 'wall' ? (
            <div className="plan-len">
              <span>Länge</span>
              <input
                id="plan-typed"
                className="input"
                inputMode="decimal"
                value={typed}
                placeholder={cursor ? fmtFixed(dist(chain.pts[chain.pts.length - 1], cursor.p), 2) : ''}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (typed.trim()) applyTyped();
                    else finishChain();
                  }
                }}
                aria-label="Wandlänge in Metern"
              />
              <span>m</span>
              <Btn small kind="ghost" onClick={finishChain}>
                Fertig
              </Btn>
            </div>
          ) : null}
          {chain && tool === 'line' ? (
            <div className="plan-len">
              <span className="dot" style={{ background: lineKind(lineOpts.kind).color }} />
              <span className="plan-len-info">
                {fmtFixed(lineLength({ pts: chain.pts }), 2)} m · Höhe {fmtFixed(zoneZ(lineOpts, floor), 2)} m
              </span>
              <input
                id="plan-typed"
                className="input"
                inputMode="decimal"
                value={typed}
                placeholder={cursor ? fmtFixed(dist(chain.pts[chain.pts.length - 1], cursor.p), 2) : 'Länge'}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (typed.trim()) applyTypedLine();
                    else finishChain();
                  }
                }}
                aria-label="Länge des nächsten Stücks in Metern"
              />
              <span>m</span>
              <Btn small kind="ghost" onClick={finishChain}>
                Fertig
              </Btn>
            </div>
          ) : null}
          {calib?.ask ? <CalibrationPrompt onApply={applyCalibration} onCancel={() => setCalib(null)} /> : null}
          <div className="plan-hint">{hints[tool]}</div>
          <div className="plan-zoom">
            <IconBtn icon="minus" label="Herauszoomen" size={16} onClick={() => setView((v) => ({ ...v, s: v.s / 1.25, tx: size.w / 2 - (size.w / 2 - v.tx) / 1.25, ty: size.h / 2 - (size.h / 2 - v.ty) / 1.25 }))} />
            <IconBtn icon="target" label="Einpassen" size={16} onClick={fit} />
            <IconBtn icon="plus" label="Hineinzoomen" size={16} onClick={() => setView((v) => ({ ...v, s: v.s * 1.25, tx: size.w / 2 - (size.w / 2 - v.tx) * 1.25, ty: size.h / 2 - (size.h / 2 - v.ty) * 1.25 }))} />
          </div>
        </div>
      </div>
      <PropsPanel
        title={selFurn && tool !== 'furniture' ? selFurn.label || furnName(selFurn) : tool === 'furniture' ? 'Möbel' : selDim ? `Maß${selDim.label ? ': ' + selDim.label : ''}` : selWall ? 'Wand' : selOpening ? OPENING_NAMES[selOpening.type] : selRoom ? `Raum: ${selRoom.name}` : selItem ? 'Treppe' : selPoint ? fixtureKind(selPoint.kind).name : selLine ? 'Leitung' : tool === 'line' || tool === 'riser' ? 'Neue Leitung' : tool === 'fixture' ? 'Anschluss' : ctx ? 'Nebengebäude' : 'Etage & Einstellungen'}
        openKey={sel ? sel.kind + sel.id : ['line', 'riser', 'fixture', 'wall', 'furniture'].includes(tool) ? tool : null}
      >
        {tool === 'furniture' ? (
          <FurnitureToolProps type={furnKey} setType={(k) => { setFurnKey(k); setSel(null); }} selected={selFurn} mutate={mutate} onDelete={deleteSelection} onDetails={() => setTool('select')} />
        ) : selFurn ? (
          <FurnitureProps f={selFurn} floor={floor} mutate={mutate} onDelete={deleteSelection} onSelect={(id) => setSel({ kind: 'furn', id })} />
        ) : selWall ? (
          <WallProps w={selWall} mutate={mutate} onDelete={deleteSelection} onSelectOpening={(o) => setSel({ kind: 'opening', id: o.id, wallId: selWall.id })} />
        ) : selOpening ? (
          <OpeningProps o={selOpening} w={walls.find((w) => w.id === sel.wallId)} mutate={mutate} onDelete={deleteSelection} />
        ) : selRoom ? (
          <RoomProps r={selRoom} floor={floor} mutate={mutate} onDelete={deleteSelection} focus={sel.focus} noDetails={ctx} />
        ) : selItem ? (
          <StairProps it={selItem} mutate={mutate} onDelete={deleteSelection} />
        ) : selDim ? (
          <DimProps d={selDim} floor={floor} mutate={mutate} onDelete={deleteSelection} focus={sel.focus} />
        ) : tool === 'fixture' ? (
          <FixtureToolProps opts={fixOpts} setOpts={setFixOpts} floor={floor} selected={selPoint} mutate={mutate} onDelete={deleteSelection} onDetails={() => setTool('select')} />
        ) : selPoint ? (
          <FixtureProps pt={selPoint} floor={floor} data={data} mutate={mutate} onDelete={deleteSelection} />
        ) : selLine ? (
          <LineProps l={selLine} floor={floor} floors={floors} data={data} mutate={mutate} onDelete={deleteSelection} />
        ) : tool === 'line' || tool === 'riser' ? (
          <LineToolProps opts={lineOpts} setOpts={changeLineOpts} floor={floor} floors={floors} riser={tool === 'riser'} />
        ) : ctx ? (
          <CtxProps b={guide} floor={floor} grid={grid} setGrid={setGrid} ortho={ortho} setOrtho={setOrtho} mutate={mutate} lines={lines} points={points} onSelectFurn={(id) => setSel({ kind: 'furn', id })} />
        ) : (
          <FloorProps
            floor={floor}
            tool={tool}
            defaults={defaults}
            setDefaults={setDefaults}
            grid={grid}
            setGrid={setGrid}
            ortho={ortho}
            setOrtho={setOrtho}
            mutate={mutate}
            lines={lines}
            points={points}
            dims={dims}
            onSelectFurn={(id) => { setUI({ planFurniture: true }); setSel({ kind: 'furn', id }); }}
            ulUrl={ulUrl}
            onUpload={() => fileRef.current?.click()}
            onCalibrate={() => { setTool('underlay'); setCalib({ pts: [] }); }}
          />
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) uploadUnderlay(f); }} />
      </PropsPanel>
    </>
  );
}

function PlanLines({ lines, sel, px }) {
  return (
    <g>
      {lines.map((l) => {
        const k = lineKind(l.kind);
        const isSel = sel?.kind === 'line' && sel.id === l.id;
        const pp = linePlanPts(l);
        const dash = l.status === 'geplant' ? `${px(7)} ${px(4)}` : l.status === 'stillgelegt' ? `${px(2)} ${px(4)}` : undefined;
        // points where the line goes up or down
        const vert = [];
        for (let i = 1; i < (l.pts || []).length; i++) if (same(l.pts[i - 1], l.pts[i], 0.002) && Math.abs((l.pts[i][2] ?? 0) - (l.pts[i - 1][2] ?? 0)) > 0.005) vert.push(l.pts[i]);
        return (
          <g key={l.id} opacity={l.status === 'stillgelegt' ? 0.55 : 1}>
            {isSel && pp.length > 1 ? <polyline points={ptsAttr(pp)} fill="none" stroke="var(--accent)" strokeOpacity="0.35" strokeWidth={px(10)} strokeLinecap="round" strokeLinejoin="round" /> : null}
            {pp.length > 1 ? <polyline points={ptsAttr(pp)} fill="none" stroke={k.color} strokeWidth={px(isSel ? 3.6 : 2.8)} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} /> : null}
            {l.riser ? (
              <g>
                <circle cx={pp[0][0]} cy={pp[0][1]} r={px(7)} fill="var(--surface)" stroke={k.color} strokeWidth={px(2.5)} />
                <circle cx={pp[0][0]} cy={pp[0][1]} r={px(2.5)} fill={k.color} />
              </g>
            ) : null}
            {vert.map((q, i) => (
              <circle key={i} cx={q[0]} cy={q[1]} r={px(4)} fill="var(--surface)" stroke={k.color} strokeWidth={px(2)} />
            ))}
            {isSel ? pp.map((q, i) => <circle key={'h' + i} cx={q[0]} cy={q[1]} r={px(5.5)} className="svg-handle" strokeWidth={px(2)} />) : null}
          </g>
        );
      })}
    </g>
  );
}

function FixtureGlyph({ kind, size, color, strokeWidth = 2.1 }) {
  const k = fixtureKind(kind);
  const sc = size / 24;
  return <path d={ICON_PATHS[k.icon]} transform={`translate(${-size / 2},${-size / 2}) scale(${sc})`} fill="none" stroke={color || k.color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
}

function PlanPoints({ points, sel, px }) {
  return (
    <g>
      {points.map((q) => {
        const k = fixtureKind(q.kind);
        const isSel = sel?.kind === 'point' && sel.id === q.id;
        const r = px(9.5);
        return (
          <g key={q.id} transform={`translate(${q.x},${q.y})`} opacity={q.status === 'stillgelegt' ? 0.5 : 1}>
            <title>{`${q.label || k.name}${q.count > 1 ? ` (${q.count}-fach)` : ''} · ${fmtFixed(q.z ?? 0, 2)} m`}</title>
            {isSel ? <circle r={r + px(4)} fill="var(--accent)" fillOpacity="0.25" /> : null}
            <circle r={r} fill="var(--surface)" stroke={isSel ? 'var(--accent)' : k.color} strokeWidth={px(isSel ? 2.4 : 1.8)} strokeDasharray={q.status === 'geplant' ? `${px(3)} ${px(2)}` : undefined} />
            <FixtureGlyph kind={q.kind} size={px(13)} />
            {q.count > 1 ? (
              <g transform={`translate(${r * 0.85},${-r * 0.85})`}>
                <circle r={px(6)} fill={k.color} />
                <text y={px(3.2)} textAnchor="middle" fontSize={px(8.5)} fontWeight="700" fill="#fff">
                  {q.count}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function FixtureKindSelect({ value, onChange }) {
  return (
    <div className="kind-grid" role="radiogroup" aria-label="Art des Anschlusses">
      {FIXTURE_KINDS.map((k) => (
        <button key={k.key} role="radio" aria-checked={value === k.key} className={`kind-btn ${value === k.key ? 'is-on' : ''}`} onClick={() => onChange(k.key)}>
          <span style={{ color: k.color, display: 'inline-flex' }}>
            <Icon name={k.icon} size={16} />
          </span>
          {k.name}
        </button>
      ))}
    </div>
  );
}

function fixturePresets(kind, floor) {
  const ceil = fixtureZ('lampe', floor);
  if (kind === 'lampe') return [{ label: 'Decke', z: r3(ceil) }, { label: 'Wand 2,0 m', z: 2.0 }];
  if (kind === 'schalter') return [{ label: 'Standard 1,05 m', z: 1.05 }, { label: 'Barrierefrei 0,85 m', z: 0.85 }];
  if (kind === 'steckdose' || kind === 'netzwerk') return [{ label: 'Unten 0,30 m', z: 0.3 }, { label: 'Arbeitsplatte 1,15 m', z: 1.15 }, { label: 'Neben Schalter 1,05 m', z: 1.05 }];
  if (kind === 'wasser') return [{ label: 'Waschtisch 0,55 m', z: 0.55 }, { label: 'Spüle 0,50 m', z: 0.5 }, { label: 'Dusche 1,10 m', z: 1.1 }, { label: 'Waschmaschine 1,00 m', z: 1.0 }];
  return [{ label: 'Herd 0,50 m', z: 0.5 }, { label: 'Therme 1,20 m', z: 1.2 }];
}

function FixtureHeight({ kind, z, floor, onChange }) {
  return (
    <>
      <Field label="Höhe über Fußboden">
        <NumInput value={z} onChange={(v) => v != null && onChange(v)} unit="m" digits={2} />
      </Field>
      <div className="chips">
        {fixturePresets(kind, floor).map((p) => (
          <button key={p.label} className={`chip ${Math.abs((z ?? -1) - p.z) < 0.005 ? 'is-on' : ''}`} onClick={() => onChange(p.z)}>
            {p.label}
          </button>
        ))}
      </div>
    </>
  );
}

function FixtureToolProps({ opts, setOpts, floor, selected, mutate, onDelete, onDetails }) {
  const k = fixtureKind(opts.kind);
  const sk = selected ? fixtureKind(selected.kind) : null;
  return (
    <div className="stack">
      {selected ? (
        <div className="panel fixture-last">
          <div className="spread">
            <span className="hstack" style={{ gap: 6 }}>
              <span style={{ color: sk.color, display: 'inline-flex' }}>
                <Icon name={sk.icon} size={16} />
              </span>
              <b className="small">{sk.name} gesetzt</b>
            </span>
            <ConfirmBtn onConfirm={onDelete}>{''}</ConfirmBtn>
          </div>
          <TextInput id={'ptq-label-' + selected.id} value={selected.label} onChange={(v) => mutate((f) => ({ ...f, points: (f.points || []).map((x) => (x.id === selected.id ? { ...x, label: v } : x)) }), { refresh: false })} placeholder="Bezeichnung (optional)" />
          <button className="link small" onClick={onDetails}>
            Alle Details bearbeiten →
          </button>
        </div>
      ) : null}
      <h4>Nächster Anschluss</h4>
      <FixtureKindSelect value={opts.kind} onChange={(kind) => setOpts({ ...opts, kind, z: null })} />
      <FixtureHeight kind={opts.kind} z={opts.z ?? fixtureZ(opts.kind, floor)} floor={floor} onChange={(z) => setOpts({ ...opts, z })} />
      {k.multi ? (
        <Field label="Anzahl" hint="z. B. 3 für eine Dreifach-Steckdose">
          <NumInput value={opts.count} onChange={(v) => v >= 1 && setOpts({ ...opts, count: Math.round(v) })} digits={0} min={1} max={12} />
        </Field>
      ) : null}
      <Field label="Zustand">
        <Seg small value={opts.status} onChange={(v) => setOpts({ ...opts, status: v })} options={LINE_STATUS} />
      </Field>
      <p className="small muted">{k.wall ? 'Wandanschlüsse rasten auf der Wandseite ein, auf der du klickst – innen oder außen.' : 'Deckenlampen setzt du frei in den Raum.'} Liegt eine passende Leitung in der Nähe (z. B. Strom bei Steckdosen), wird automatisch ein kurzes Anschlussstück bis zum Anschluss ergänzt. Im 3D-Modell erscheinen Anschlüsse zusammen mit den Leitungen im Röntgenblick.</p>
    </div>
  );
}

function FixtureProps({ pt, floor, data, mutate, onDelete }) {
  const set = (patch) => mutate((f) => ({ ...f, points: (f.points || []).map((x) => (x.id === pt.id ? { ...x, ...patch } : x)) }), { refresh: false });
  const k = fixtureKind(pt.kind);
  const room = roomOfPoint(floor, pt);
  const photos = Object.values(data.documents || {}).filter((d) => d.lineId === pt.id);
  return (
    <div className="stack">
      <div className="spread">
        <h4 className="hstack" style={{ gap: 6 }}>
          <span style={{ color: k.color, display: 'inline-flex' }}>
            <Icon name={k.icon} size={17} />
          </span>
          {k.name}
        </h4>
        <ConfirmBtn onConfirm={onDelete}>{''}</ConfirmBtn>
      </div>
      <FixtureKindSelect value={pt.kind} onChange={(kind) => set({ kind, z: r3(fixtureZ(kind, floor)), count: fixtureKind(kind).multi ? pt.count || 1 : 1 })} />
      <Field label="Bezeichnung">
        <TextInput id={'pt-label-' + pt.id} value={pt.label} onChange={(v) => set({ label: v })} placeholder={{ steckdose: 'z. B. Herd, Waschmaschine, Außensteckdose', schalter: 'z. B. Serienschalter Flur', lampe: 'z. B. Esstisch', netzwerk: 'z. B. LAN 2× Cat7', wasser: 'z. B. Waschtisch, Außenhahn', gas: 'z. B. Herd, Therme' }[pt.kind]} />
      </Field>
      <FixtureHeight kind={pt.kind} z={pt.z ?? 0} floor={floor} onChange={(z) => set({ z })} />
      {k.multi ? (
        <Field label="Anzahl" hint="Mehrfachdose">
          <NumInput value={pt.count || 1} onChange={(v) => v >= 1 && set({ count: Math.round(v) })} digits={0} min={1} max={12} />
        </Field>
      ) : null}
      <Field label="Zustand">
        <Seg small value={pt.status || 'bestand'} onChange={(v) => set({ status: v })} options={LINE_STATUS} />
      </Field>
      <div className="kv">
        <span>Raum</span>
        <b>{room ? room.name : pt.rot != null ? 'außen / nicht zugeordnet' : '–'}</b>
      </div>
      <Field label="Notizen">
        <TextInput multiline rows={3} value={pt.notes} onChange={(v) => set({ notes: v })} placeholder={pt.kind === 'steckdose' ? 'Stromkreis, Sicherung, Schuko/CEE …' : pt.kind === 'gas' ? 'Absperrung, Prüfung, Leitung …' : 'Details …'} />
      </Field>
      <div className="divider" />
      <div className="spread">
        <span className="field-label">Fotos ({photos.length})</span>
        <UploadButton small lineId={pt.id} label="Foto" accept="image/*" />
      </div>
      {photos.length ? <DocList data={data} filter={(d) => d.lineId === pt.id} compact /> : null}
    </div>
  );
}

// risers drawn on other floors that run through this one
function PassingRisers({ floor, floors, px }) {
  const lo = floor.elevation,
    hi = floor.elevation + floor.height;
  const items = [];
  for (const f of floors) {
    if (f.id === floor.id) continue;
    for (const l of f.lines || []) {
      if (!l.riser || !(l.pts || []).length) continue;
      const zs = l.pts.map((q) => f.elevation + (q[2] ?? 0));
      if (Math.min(hi, Math.max(...zs)) - Math.max(lo, Math.min(...zs)) > 0.05) items.push({ l, f });
    }
  }
  return (
    <g>
      {items.map(({ l, f }) => {
        const k = lineKind(l.kind);
        const q = l.pts[0];
        return (
          <g key={l.id}>
            <title>{`${l.label || k.name} – Steigleitung aus ${f.name}`}</title>
            <circle cx={q[0]} cy={q[1]} r={px(7)} fill="none" stroke={k.color} strokeWidth={px(2)} strokeDasharray={`${px(3)} ${px(2.5)}`} />
            <circle cx={q[0]} cy={q[1]} r={px(2)} fill={k.color} opacity="0.7" />
          </g>
        );
      })}
    </g>
  );
}

// From/to heights of a riser, relative to the floor of this storey (negative = below, above the storey height = upper floors)
function RiserHeights({ from, to, floor, floors, onChange }) {
  const fl = [...floors].sort((a, b) => a.elevation - b.elevation);
  const top = fl[fl.length - 1],
    low = fl[0];
  const presets = [
    { label: 'Diese Etage', v: [0, floor.height] },
    { label: 'Bis oben', v: [0, r3(top.elevation + top.height - floor.elevation)] },
    { label: 'Ab Keller', v: [r3(low.elevation - floor.elevation), floor.height] },
  ].filter((p, i, arr) => arr.findIndex((x) => x.v[0] === p.v[0] && x.v[1] === p.v[1]) === i);
  const abs = (z) => `${z + floor.elevation >= 0 ? '+' : '−'}${fmtFixed(Math.abs(z + floor.elevation), 2)} m`;
  return (
    <>
      <div className="grid2">
        <Field label="Von (über Fußboden)">
          <NumInput value={from} onChange={(v) => v != null && onChange(v, to)} unit="m" digits={2} />
        </Field>
        <Field label="Bis (über Fußboden)">
          <NumInput value={to} onChange={(v) => v != null && onChange(from, v)} unit="m" digits={2} />
        </Field>
      </div>
      <div className="chips">
        {presets.map((p) => (
          <button key={p.label} className={`chip ${from === p.v[0] && to === p.v[1] ? 'is-on' : ''}`} onClick={() => onChange(p.v[0], p.v[1])}>
            {p.label}
          </button>
        ))}
      </div>
      <p className="small muted">
        Bezogen auf den EG-Fußboden: {abs(Math.min(from, to))} bis {abs(Math.max(from, to))}. Negative Werte führen nach unten, Werte über der Geschosshöhe ({fmtFixed(floor.height, 2)} m) in die Etagen darüber.
      </p>
    </>
  );
}

// Length of a drawn line; a new value moves the end (or the start) so plan and 3D match the real length.
function LineLength({ l, set }) {
  const [atStart, setAtStart] = useState(false);
  const L = lineLength(l);
  // applied on Enter or when leaving the field – shortening while typing would cut pieces off
  const [text, setText] = useState(null);
  const apply = () => {
    const v = parseNum(text ?? '');
    setText(null);
    if (v > 0.02 && Math.abs(v - L) > 0.0005) set({ pts: resizeLine(l.pts, v, atStart) });
  };
  return (
    <>
      <Field label="Länge" hint={l.riser ? 'Ändert die obere Höhe der Steigleitung · Enter übernimmt' : 'Neue Länge verlängert oder kürzt die Leitung am gewählten Ende · Enter übernimmt'}>
        <span className="input-wrap">
          <input
            id={'ln-len-' + l.id}
            className="input num"
            style={{ paddingRight: 21 }}
            inputMode="decimal"
            value={text ?? fmtNum(L, 2)}
            onChange={(e) => setText(e.target.value)}
            onBlur={apply}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === 'Escape') setText(null);
            }}
          />
          <span className="input-unit">m</span>
        </span>
      </Field>
      {!l.riser ? (
        <Field label="Anpassen">
          <Seg small value={atStart ? 'start' : 'end'} onChange={(v) => setAtStart(v === 'start')} options={[{ value: 'end', label: 'am Ende' }, { value: 'start', label: 'am Anfang' }]} />
        </Field>
      ) : null}
    </>
  );
}

function LinePreview({ pts, cursor, kind, px }) {
  const k = lineKind(kind);
  const pp = linePlanPts({ pts });
  const all = cursor ? [...pp, cursor] : pp;
  return all.length > 1 ? <polyline points={ptsAttr(all)} fill="none" stroke={k.color} strokeWidth={px(2.8)} strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.8" /> : null;
}

function HeightPicker({ opts, setOpts, floor }) {
  return (
    <>
      <Field label="Höhe über Fußboden">
        <Select
          value={opts.zone}
          onChange={(v) => setOpts({ ...opts, zone: v, z: v === 'custom' ? zoneZ(opts, floor) : opts.z })}
          options={[...LINE_ZONES.map((z) => ({ value: z.key, label: `${z.name} – ${fmtFixed(z.z(floor), 2)} m` })), { value: 'custom', label: 'Eigene Höhe' }]}
        />
      </Field>
      {opts.zone === 'custom' ? (
        <Field label="Eigene Höhe">
          <NumInput value={opts.z} onChange={(v) => v != null && setOpts({ ...opts, z: v })} unit="m" digits={2} />
        </Field>
      ) : null}
    </>
  );
}

function KindSelect({ value, onChange }) {
  return (
    <div className="kind-grid" role="radiogroup" aria-label="Art der Leitung">
      {LINE_KINDS.map((k) => (
        <button key={k.key} role="radio" aria-checked={value === k.key} className={`kind-btn ${value === k.key ? 'is-on' : ''}`} onClick={() => onChange(k.key)}>
          <span className="dot" style={{ background: k.color }} />
          {k.name}
        </button>
      ))}
    </div>
  );
}

function LineToolProps({ opts, setOpts, floor, floors, riser }) {
  return (
    <div className="stack">
      <h4>{riser ? 'Neue Steigleitung' : 'Neue Leitung'}</h4>
      <KindSelect value={opts.kind} onChange={(kind) => setOpts({ ...opts, kind, zone: riser ? opts.zone : defaultZone(kind) })} />
      {!riser ? <HeightPicker opts={opts} setOpts={setOpts} floor={floor} /> : <RiserHeights from={opts.rFrom ?? 0} to={opts.rTo ?? floor.height} floor={floor} floors={floors} onChange={(a, b) => setOpts({ ...opts, rFrom: a, rTo: b })} />}
      <Field label="Zustand">
        <Seg small value={opts.status} onChange={(v) => setOpts({ ...opts, status: v })} options={LINE_STATUS} />
      </Field>
      <p className="small muted">
        {riser
          ? 'Eine Steigleitung läuft senkrecht – auch über mehrere Etagen. In den anderen Etagen erscheint sie im Grundriss als gestrichelter Kreis.'
          : 'Zeichne die Leitung dort, wo sie wirklich liegt – z. B. in der Wandachse. Im 3D-Modell blendest du sie über „Leitungen“ mit Röntgenblick ein. Tipp: Kabel liegen nach DIN 18015-3 waagerecht in Zonen 30 cm unter der Decke, 30 cm über dem Boden oder auf 1,15 m.'}
      </p>
    </div>
  );
}

function LineProps({ l, floor, floors, data, mutate, onDelete }) {
  const set = (patch) => mutate((f) => ({ ...f, lines: (f.lines || []).map((x) => (x.id === l.id ? { ...x, ...patch, auto: false } : x)) }), { refresh: false });
  const k = lineKind(l.kind);
  const zs = (l.pts || []).map((q) => q[2] ?? 0);
  const zMin = Math.min(...zs),
    zMax = Math.max(...zs);
  const flat = zMax - zMin < 0.005;
  const [zAll, setZAll] = useState(r3(zMin));
  const setAllZ = (z) => {
    // keep the shape: collapse vertical pieces, then put every point on the new height
    const pp = linePlanPts(l).map((q) => [q[0], q[1], r3(z)]);
    set({ pts: pp });
  };
  return (
    <div className="stack">
      <div className="spread">
        <h4>
          <span className="dot" style={{ background: k.color, marginRight: 6 }} />
          {l.riser ? 'Steigleitung' : l.stubFor ? 'Anschlussleitung' : 'Leitung'}
        </h4>
        <ConfirmBtn onConfirm={onDelete}>{''}</ConfirmBtn>
      </div>
      {l.auto ? <p className="small muted">Automatisch erzeugt: verbindet die Leitung in der Wand mit dem Anschluss. Sie passt sich an, wenn du den Anschluss verschiebst – sobald du sie hier änderst, bleibt sie so.</p> : null}
      <KindSelect value={l.kind} onChange={(kind) => set({ kind })} />
      <Field label="Bezeichnung">
        <TextInput id={'ln-label-' + l.id} value={l.label} onChange={(v) => set({ label: v })} placeholder={l.riser ? 'z. B. Fallrohr Bad' : 'z. B. Zuleitung Küche, NYM 5×2,5'} />
      </Field>
      <Field label="Zustand">
        <Seg small value={l.status || 'bestand'} onChange={(v) => set({ status: v })} options={LINE_STATUS} />
      </Field>
      <LineLength l={l} set={set} />
      <div>
        <div className="kv">
          <span>Höhe über Fußboden</span>
          <b>{flat ? `${fmtFixed(zMin, 2)} m` : `${fmtFixed(zMin, 2)} – ${fmtFixed(zMax, 2)} m`}</b>
        </div>
      </div>
      {l.riser ? (
        <RiserHeights
          from={r3(zMin)}
          to={r3(zMax)}
          floor={floor}
          floors={floors}
          onChange={(a, b) => {
            const q = l.pts[0];
            set({ pts: [[q[0], q[1], r3(Math.min(a, b))], [q[0], q[1], r3(Math.max(a, b))]] });
          }}
        />
      ) : null}
      {!l.riser ? (
        <Field label={flat ? 'Höhe ändern' : 'Alle Punkte auf eine Höhe setzen'}>
          <div className="inline-form">
            <NumInput value={zAll} onChange={(v) => v != null && setZAll(v)} unit="m" digits={2} />
            <Btn small onClick={() => setAllZ(zAll)}>
              Übernehmen
            </Btn>
          </div>
        </Field>
      ) : null}
      <Field label="Notizen">
        <TextInput multiline rows={3} value={l.notes} onChange={(v) => set({ notes: v })} placeholder="Querschnitt, Material, Absicherung, Baujahr …" />
      </Field>
      <div className="divider" />
      <div className="spread">
        <span className="field-label">Fotos ({Object.values(data.documents || {}).filter((d) => d.lineId === l.id).length})</span>
        <UploadButton small lineId={l.id} label="Foto" accept="image/*" />
      </div>
      {Object.values(data.documents || {}).some((d) => d.lineId === l.id) ? <DocList data={data} filter={(d) => d.lineId === l.id} compact /> : null}
      <p className="small muted">Fotografiere offene Wände, bevor sie geschlossen werden – so weißt du später genau, wo die Leitung verläuft.</p>
    </div>
  );
}

function linkedEnds(walls, pt, exceptId) {
  const out = [];
  for (const w of walls) {
    if (w.id === exceptId) continue;
    for (const end of ['a', 'b']) if (same(w[end], pt, 0.002)) out.push({ id: w.id, end });
  }
  return out;
}

function WallDims({ w, px }) {
  const { L, u, n } = wallFrame(w);
  const off = w.t / 2 + px(18);
  const a = add(w.a, mul(n, off)),
    b = add(w.b, mul(n, off));
  const m = add(w.a, add(mul(u, L / 2), mul(n, off + px(4))));
  const ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  const rot = ang > 90 || ang < -90 ? ang + 180 : ang;
  return (
    <g>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="svg-dim-line" strokeWidth={px(1.2)} />
      <line x1={a[0] - n[0] * px(5)} y1={a[1] - n[1] * px(5)} x2={a[0] + n[0] * px(5)} y2={a[1] + n[1] * px(5)} className="svg-dim-line" strokeWidth={px(1.2)} />
      <line x1={b[0] - n[0] * px(5)} y1={b[1] - n[1] * px(5)} x2={b[0] + n[0] * px(5)} y2={b[1] + n[1] * px(5)} className="svg-dim-line" strokeWidth={px(1.2)} />
      <text x={m[0]} y={m[1]} textAnchor="middle" className="svg-dim" fontSize={px(12)} transform={`rotate(${rot} ${m[0]} ${m[1]})`}>
        {fmtFixed(L, 3)} m
      </text>
    </g>
  );
}

function DrawPreview({ chain, cursor, px, t }) {
  const last = chain.pts[chain.pts.length - 1];
  const L = dist(last, cursor.p);
  const m = [(last[0] + cursor.p[0]) / 2, (last[1] + cursor.p[1]) / 2];
  return (
    <g>
      <line x1={last[0]} y1={last[1]} x2={cursor.p[0]} y2={cursor.p[1]} className="svg-preview" strokeWidth={t || px(2)} strokeOpacity={t ? 0.35 : 1} />
      <line x1={last[0]} y1={last[1]} x2={cursor.p[0]} y2={cursor.p[1]} className="svg-preview" strokeWidth={px(1.5)} />
      <rect x={m[0] - px(30)} y={m[1] - px(22)} width={px(60)} height={px(17)} rx={px(4)} fill="var(--surface)" stroke="var(--accent)" strokeWidth={px(1)} />
      <text x={m[0]} y={m[1] - px(9.5)} textAnchor="middle" className="svg-dim" fontSize={px(11.5)}>
        {fmtFixed(L, 2)} m
      </text>
    </g>
  );
}

// Saved dimension lines: ticks at both ends, the measured value (or the plan length) above the line.
function DimLines({ dims, sel, px }) {
  return (
    <g>
      {dims.map((d) => {
        const isSel = sel?.kind === 'dim' && sel.id === d.id;
        const L = dimLength(d);
        if (L < 0.005) return null;
        const u = [(d.b[0] - d.a[0]) / L, (d.b[1] - d.a[1]) / L];
        const n = [-u[1], u[0]];
        const m = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
        const ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
        const rot = ang > 90 || ang < -90 ? ang + 180 : ang;
        const tick = (q) => `M${q[0] + (u[0] + n[0]) * px(5)},${q[1] + (u[1] + n[1]) * px(5)} L${q[0] - (u[0] + n[0]) * px(5)},${q[1] - (u[1] + n[1]) * px(5)}`;
        const ext = (q) => `M${q[0] + n[0] * px(7)},${q[1] + n[1] * px(7)} L${q[0] - n[0] * px(7)},${q[1] - n[1] * px(7)}`;
        const off = d.value != null && Math.abs(d.value - L) > 0.02;
        const text = `${d.label ? d.label + ': ' : ''}${fmtFixed(d.value ?? L, 2)} m`;
        const tp = [m[0] - n[0] * px(9), m[1] - n[1] * px(9)];
        return (
          <g key={d.id} className="svg-dimline">
            {isSel ? <line x1={d.a[0]} y1={d.a[1]} x2={d.b[0]} y2={d.b[1]} stroke="var(--accent)" strokeOpacity="0.3" strokeWidth={px(10)} strokeLinecap="round" /> : null}
            <line x1={d.a[0]} y1={d.a[1]} x2={d.b[0]} y2={d.b[1]} stroke="var(--violet)" strokeWidth={px(1.6)} />
            <path d={`${tick(d.a)} ${tick(d.b)} ${ext(d.a)} ${ext(d.b)}`} stroke="var(--violet)" strokeWidth={px(1.6)} fill="none" />
            <text x={tp[0]} y={tp[1]} textAnchor="middle" fontSize={px(11.5)} fontWeight="700" fill="var(--violet)" stroke="var(--surface)" strokeWidth={px(3)} paintOrder="stroke" transform={`rotate(${rot} ${tp[0]} ${tp[1]})`}>
              {text}
              {off ? <tspan fontWeight="400" fontSize={px(10)}>{` (Plan ${fmtFixed(L, 2)})`}</tspan> : null}
            </text>
            {isSel ? ['a', 'b'].map((k) => <circle key={k} cx={d[k][0]} cy={d[k][1]} r={px(5.5)} className="svg-handle" strokeWidth={px(2)} />) : null}
          </g>
        );
      })}
    </g>
  );
}

function DimProps({ d, floor, mutate, onDelete, focus }) {
  const set = (patch) => mutate((f) => ({ ...f, dims: (f.dims || []).map((x) => (x.id === d.id ? { ...x, ...patch } : x)) }), { refresh: false });
  const L = dimLength(d);
  const ref = useRef(null);
  useEffect(() => {
    // after the click on the plan has finished moving the focus
    if (!focus) return;
    const t = setTimeout(() => ref.current?.querySelector('input')?.focus(), 60);
    return () => clearTimeout(t);
  }, [d.id]);
  const room = (floor.rooms || []).find((r) => r.poly?.length && pointInPoly([(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2], r.poly));
  const fit = () => {
    const k = d.value / L;
    set({ b: P3([d.a[0] + (d.b[0] - d.a[0]) * k, d.a[1] + (d.b[1] - d.a[1]) * k]) });
  };
  return (
    <div className="stack">
      <div className="spread">
        <h4>Maß</h4>
        <ConfirmBtn onConfirm={onDelete}>{''}</ConfirmBtn>
      </div>
      <div ref={ref}>
        <Field label="Gemessen (vor Ort)" hint="Leer = Länge aus dem Plan">
          <NumInput value={d.value} onChange={(v) => set({ value: v > 0 ? v : null })} unit="m" digits={3} />
        </Field>
      </div>
      <Field label="Bezeichnung">
        <TextInput id={'dim-label-' + d.id} value={d.label} onChange={(v) => set({ label: v })} placeholder="z. B. Türbreite Bad, Abstand Fenster" />
      </Field>
      <div>
        <div className="kv">
          <span>Länge im Plan</span>
          <b className="mono">{fmtFixed(L, 3)} m</b>
        </div>
        {d.value != null ? (
          <div className="kv">
            <span>Abweichung</span>
            <b className="mono" style={{ color: Math.abs(d.value - L) > 0.05 ? 'var(--warn-ink)' : undefined }}>
              {d.value - L >= 0 ? '+' : '−'}
              {fmtFixed(Math.abs(d.value - L) * 100, 1)} cm
            </b>
          </div>
        ) : null}
        {room ? (
          <div className="kv">
            <span>Raum</span>
            <b>{room.name}</b>
          </div>
        ) : null}
      </div>
      {d.value != null && Math.abs(d.value - L) > 0.005 ? (
        <Btn small icon="ruler" onClick={fit}>
          Linie auf {fmtFixed(d.value, 2)} m anpassen
        </Btn>
      ) : null}
      <p className="small muted">Maßlinien halten fest, was du vor Ort gemessen hast – z. B. Türbreiten oder Abstände zwischen Fenstern. Weicht der Plan ab, passe Wand oder Öffnung an oder ziehe die Linie zurecht. Endpunkte ziehen ändert die Linie, die Linie ziehen verschiebt sie.</p>
    </div>
  );
}

function DimSummary({ dims }) {
  if (!dims.length) return null;
  return (
    <>
      <div className="divider" />
      <h4>Maße in dieser Etage</h4>
      <ul className="legend-list">
        {dims.map((d) => (
          <li key={d.id}>
            <Icon name="ruler" size={13} />
            <span>{d.label || 'Maß'}</span>
            <b>{fmtFixed(d.value ?? dimLength(d), 2)} m</b>
          </li>
        ))}
      </ul>
    </>
  );
}

function MeasureLine({ a, b, px }) {
  if (!a) return null;
  if (!b) return <circle cx={a[0]} cy={a[1]} r={px(5)} fill="var(--violet)" />;
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return (
    <g>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="var(--violet)" strokeWidth={px(2)} strokeDasharray={`${px(6)} ${px(4)}`} />
      <circle cx={a[0]} cy={a[1]} r={px(4)} fill="var(--violet)" />
      <circle cx={b[0]} cy={b[1]} r={px(4)} fill="var(--violet)" />
      <rect x={m[0] - px(34)} y={m[1] - px(24)} width={px(68)} height={px(18)} rx={px(4)} fill="var(--surface)" stroke="var(--violet)" strokeWidth={px(1)} />
      <text x={m[0]} y={m[1] - px(11)} textAnchor="middle" fontSize={px(12)} fill="var(--violet)" fontFamily="var(--font-mono)">
        {fmtFixed(dist(a, b), 3)} m
      </text>
    </g>
  );
}

function OpeningGhost({ w, p, type, px }) {
  const { L, u, n } = wallFrame(w);
  const d = OPENING_DEFAULTS[type];
  const ow = Math.min(d.w, L - 0.1);
  let pos = distToSeg(p, w.a, w.b).t * L;
  pos = Math.max(ow / 2, Math.min(L - ow / 2, pos));
  const c = add(w.a, mul(u, pos));
  const h = w.t / 2 + px(3);
  const a0 = add(c, mul(u, -ow / 2)),
    a1 = add(c, mul(u, ow / 2));
  return <polygon points={ptsAttr([add(a0, mul(n, h)), add(a1, mul(n, h)), add(a1, mul(n, -h)), add(a0, mul(n, -h))])} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={px(1.5)} />;
}

function CalibrationPrompt({ onApply, onCancel }) {
  const [v, setV] = useState('');
  return (
    <div className="plan-len" style={{ top: 56 }}>
      <span>Echter Abstand</span>
      <input
        className="input"
        autoFocus
        inputMode="decimal"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onApply(parseNum(v))}
        placeholder="z. B. 10,49"
        aria-label="Abstand in Metern"
      />
      <span>m</span>
      <Btn small kind="primary" onClick={() => onApply(parseNum(v))}>
        Übernehmen
      </Btn>
      <IconBtn icon="x" label="Abbrechen" size={15} onClick={onCancel} />
    </div>
  );
}

// ---------- property panels ----------
function WallProps({ w, mutate, onDelete, onSelectOpening }) {
  const { L, u } = wallFrame(w);
  const set = (patch, opts) => mutate((f) => ({ ...f, walls: f.walls.map((x) => (x.id === w.id ? { ...x, ...patch } : x)) }), opts);
  const setLength = (v) => {
    if (!v || v < 0.05) return;
    mutate((f) => {
      const nb = P3(add(w.a, mul(u, v)));
      return { ...f, walls: f.walls.map((x) => {
        if (x.id === w.id) return { ...x, b: nb, openings: (x.openings || []).map((o) => ({ ...o, pos: Math.min(o.pos, v - o.w / 2) })) };
        const y = { ...x };
        if (same(x.a, w.b, 0.002)) y.a = nb;
        if (same(x.b, w.b, 0.002)) y.b = nb;
        return y;
      }) };
    });
  };
  const addOpening = (type) => {
    const d = { ...OPENING_DEFAULTS[type] };
    if (type === 'door' && w.ext) d.w = 1.01;
    if (d.w > L - 0.1) d.w = Math.max(0.4, L - 0.1);
    const id = uid('o');
    set({ openings: [...(w.openings || []), { id, type, pos: r3(L / 2), ...d }] }, { refresh: false });
    setTimeout(() => onSelectOpening({ id }), 0);
  };
  const preset = THICKNESS.find((t) => Math.abs(t.value - w.t) < 1e-4);
  return (
    <div className="stack">
      <div className="spread">
        <h4>{w.ext ? 'Außenwand' : 'Innenwand'}</h4>
        <ConfirmBtn onConfirm={onDelete}>{''}</ConfirmBtn>
      </div>
      <Field label="Länge (Achsmaß)">
        <NumInput id={'w-len-' + w.id} value={r3(L)} onChange={setLength} unit="m" digits={3} />
      </Field>
      <Field label="Dicke">
        <Select id={'w-t-' + w.id} value={preset ? String(preset.value) : 'custom'} onChange={(v) => v !== 'custom' && set({ t: Number(v) })} options={[...THICKNESS.map((t) => ({ value: String(t.value), label: t.label })), { value: 'custom', label: 'Eigene' }]} />
      </Field>
      {!preset ? (
        <Field label="Eigene Dicke">
          <NumInput value={w.t * 100} onChange={(v) => v && set({ t: v / 100 })} unit="cm" digits={1} />
        </Field>
      ) : null}
      <Toggle checked={w.ext} onChange={(v) => set({ ext: v })} label="Außenwand" />
      {w.ext ? (
        <Field label="Außenseite grenzt an" hint="Für den Heizlast-Check">
          <Select value={w.adj || ''} onChange={(v) => set({ adj: v || undefined }, { refresh: false })} options={[{ value: '', label: 'Automatisch (aus Lageplan)' }, ...ADJ.map((a) => ({ value: a.key, label: a.name }))]} />
        </Field>
      ) : null}
      <Field label="Höhe" hint="Leer = Geschosshöhe">
        <NumInput value={w.h} onChange={(v) => set({ h: v }, { refresh: false })} unit="m" digits={2} />
      </Field>
      <div className="divider" />
      <span className="field-label">Öffnungen ({(w.openings || []).length})</span>
      <div className="chips">
        {(w.openings || []).map((o) => (
          <button key={o.id} className="chip" onClick={() => onSelectOpening(o)}>
            <Icon name={o.type === 'window' ? 'window' : o.type === 'door' ? 'door' : 'split'} size={13} /> {OPENING_NAMES[o.type]} {fmtFixed(o.w, 2)}
          </button>
        ))}
      </div>
      <div className="hstack">
        <Btn small icon="window" onClick={() => addOpening('window')}>
          Fenster
        </Btn>
        <Btn small icon="door" onClick={() => addOpening('door')}>
          Tür
        </Btn>
      </div>
    </div>
  );
}

function OpeningProps({ o, w, mutate, onDelete }) {
  if (!w) return null;
  const { L } = wallFrame(w);
  const set = (patch) =>
    mutate((f) => ({ ...f, walls: f.walls.map((x) => (x.id === w.id ? { ...x, openings: x.openings.map((y) => (y.id === o.id ? { ...y, ...patch } : y)) } : x)) }), { refresh: false });
  return (
    <div className="stack">
      <div className="spread">
        <h4>{OPENING_NAMES[o.type]}</h4>
        <ConfirmBtn onConfirm={onDelete}>{''}</ConfirmBtn>
      </div>
      <Seg small value={o.type} onChange={(v) => set({ type: v, sill: v === 'window' ? o.sill || 0.8 : 0 })} options={Object.entries(OPENING_NAMES).map(([k, v]) => ({ value: k, label: v }))} />
      <div className="grid2">
        <Field label="Breite">
          <NumInput value={o.w} onChange={(v) => v && set({ w: Math.min(v, L) })} unit="m" digits={3} />
        </Field>
        <Field label="Höhe">
          <NumInput value={o.h} onChange={(v) => v && set({ h: v })} unit="m" digits={3} />
        </Field>
        {o.type === 'window' ? (
          <Field label="Brüstung">
            <NumInput value={o.sill} onChange={(v) => set({ sill: v ?? 0 })} unit="m" digits={2} />
          </Field>
        ) : null}
        <Field label="Abstand Mitte" hint="vom Wandanfang">
          <NumInput value={o.pos} onChange={(v) => v != null && set({ pos: Math.max(o.w / 2, Math.min(L - o.w / 2, v)) })} unit="m" digits={3} />
        </Field>
      </div>
      {o.type === 'door' ? (
        <div className="hstack">
          <Btn small icon="split" onClick={() => set({ flip: !o.flip })}>
            Aufschlag wechseln
          </Btn>
          <Btn small icon="rotR" onClick={() => set({ hinge: o.hinge === 'b' ? 'a' : 'b' })}>
            Band links/rechts
          </Btn>
        </div>
      ) : null}
      <p className="small muted">
        Wandlänge {fmtFixed(L, 2)} m · Öffnung {fmtFixed(o.w * o.h, 2)} m²
      </p>
    </div>
  );
}

function RoomProps({ r, floor, mutate, onDelete, focus, noDetails }) {
  const set = (patch) => mutate((f) => ({ ...f, rooms: f.rooms.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) }), { refresh: false });
  const ref = useRef(null);
  useEffect(() => {
    if (focus) ref.current?.select();
  }, [r.id]);
  return (
    <div className="stack">
      <div className="spread">
        <h4>Raum</h4>
        <ConfirmBtn onConfirm={onDelete}>{''}</ConfirmBtn>
      </div>
      <Field label="Name">
        <input ref={ref} id={'pr-name-' + r.id} className="input" value={r.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Typ">
        <Select value={r.type} onChange={(v) => set({ type: v })} options={ROOM_TYPES.map((t) => ({ value: t.key, label: t.name }))} />
      </Field>
      <div className="kv">
        <span>Fläche (Innenmaß)</span>
        <b className="mono">{fmtFixed(Math.abs(polyArea(r.poly || [])), 2)} m²</b>
      </div>
      {r.manual ? <p className="small muted">Als Polygon gezeichnet – folgt Wandänderungen nicht automatisch.</p> : <p className="small muted">Folgt automatisch den umgebenden Wänden.</p>}
      {noDetails ? null : (
        <Btn small icon="edit" onClick={() => openDrawer({ type: 'room', floorId: floor.id, roomId: r.id })}>
          Ausstattung & Details
        </Btn>
      )}
    </div>
  );
}

function StairProps({ it, mutate, onDelete }) {
  const set = (patch) => mutate((f) => ({ ...f, items: f.items.map((x) => (x.id === it.id ? { ...x, ...patch } : x)) }), { refresh: false });
  return (
    <div className="stack">
      <div className="spread">
        <h4>Treppe</h4>
        <ConfirmBtn onConfirm={onDelete}>{''}</ConfirmBtn>
      </div>
      <Field label="Laufrichtung (aufwärts)">
        <Seg small value={it.dir} onChange={(v) => set({ dir: v })} options={[{ value: 'n', label: '↑' }, { value: 'e', label: '→' }, { value: 's', label: '↓' }, { value: 'w', label: '←' }]} />
      </Field>
      <div className="grid2">
        <Field label="Breite">
          <NumInput value={it.w} onChange={(v) => v && set({ w: v })} unit="m" digits={2} />
        </Field>
        <Field label="Lauflänge">
          <NumInput value={it.l} onChange={(v) => v && set({ l: v })} unit="m" digits={2} />
        </Field>
      </div>
      <p className="small muted">In der Etage darüber wird automatisch eine Deckenöffnung ausgespart.</p>
    </div>
  );
}

function LineSummary({ lines, points = [] }) {
  if (!lines.length && !points.length) return null;
  const by = new Map();
  for (const l of lines) by.set(l.kind, (by.get(l.kind) || 0) + lineLength(l));
  const pc = new Map();
  for (const q of points) pc.set(q.kind, (pc.get(q.kind) || 0) + (q.count || 1));
  return (
    <>
      <div className="divider" />
      {lines.length ? (
        <>
          <h4>Leitungen in dieser Etage</h4>
          <ul className="legend-list">
            {LINE_KINDS.filter((k) => by.has(k.key)).map((k) => (
              <li key={k.key}>
                <span className="dot" style={{ background: k.color }} />
                <span>{k.name}</span>
                <b>{fmtFixed(by.get(k.key), 1)} m</b>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {points.length ? (
        <>
          <h4>Anschlüsse in dieser Etage</h4>
          <ul className="legend-list">
            {FIXTURE_KINDS.filter((k) => pc.has(k.key)).map((k) => (
              <li key={k.key}>
                <span style={{ color: k.color, display: 'inline-flex' }}>
                  <Icon name={k.icon} size={14} />
                </span>
                <span>{k.name}</span>
                <b>{pc.get(k.key)}</b>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

function FloorProps({ floor, tool, defaults, setDefaults, grid, setGrid, ortho, setOrtho, mutate, ulUrl, onUpload, onCalibrate, lines = [], points = [], dims = [], onSelectFurn }) {
  const set = (patch) => mutate((f) => ({ ...f, ...patch }), { refresh: false });
  const ul = floor.underlay;
  return (
    <div className="stack">
      {tool === 'wall' ? (
        <div className="panel" style={{ padding: 10 }}>
          <span className="field-label">Neue Wände</span>
          <div className="stack" style={{ gap: 8, marginTop: 6 }}>
            <Select value={String(defaults.t)} onChange={(v) => setDefaults({ ...defaults, t: Number(v) })} options={THICKNESS.map((t) => ({ value: String(t.value), label: t.label }))} />
            <Toggle checked={defaults.ext} onChange={(v) => setDefaults({ ...defaults, ext: v, t: v && defaults.t < 0.24 ? 0.365 : !v && defaults.t > 0.24 ? 0.115 : defaults.t })} label="Außenwand" />
          </div>
        </div>
      ) : null}
      <h4>Etage</h4>
      <div className="grid2">
        <Field label="Name">
          <TextInput id={'fl-name-' + floor.id} value={floor.name} onChange={(v) => set({ name: v })} />
        </Field>
        <Field label="Kürzel">
          <TextInput id={'fl-short-' + floor.id} value={floor.short} onChange={(v) => set({ short: v.slice(0, 4) })} />
        </Field>
        <Field label="Fußbodenhöhe" hint="OKFF zu EG ±0">
          <NumInput value={floor.elevation} onChange={(v) => v != null && set({ elevation: v })} unit="m" digits={2} />
        </Field>
        <Field label="Geschosshöhe">
          <NumInput value={floor.height} onChange={(v) => v && set({ height: v })} unit="m" digits={2} />
        </Field>
        <Field label="Deckenstärke">
          <NumInput value={floor.slab ?? 0.2} onChange={(v) => v != null && set({ slab: v })} unit="m" digits={2} />
        </Field>
        <Field label="Kniestock" hint="Nur Dachgeschoss">
          <NumInput value={floor.kneeWall ?? null} onChange={(v) => set({ kneeWall: v })} unit="m" digits={2} disabled={!floor.underRoof} />
        </Field>
      </div>
      <Toggle checked={!!floor.underRoof} onChange={(v) => set({ underRoof: v, kneeWall: v ? floor.kneeWall ?? 1.0 : floor.kneeWall })} label="Dachgeschoss (Wände unter Dachschräge)" />
      <LineSummary lines={lines} points={points} />
      <FurnitureSummary list={floor.furniture} floor={floor} onSelect={onSelectFurn} />
      <DimSummary dims={dims} />
      <div className="divider" />
      <h4>Raster & Fang</h4>
      <Field label="Raster">
        <Select value={String(grid)} onChange={(v) => setGrid(Number(v))} options={[{ value: '0.01', label: '1 cm' }, { value: '0.05', label: '5 cm' }, { value: '0.1', label: '10 cm' }, { value: '0.25', label: '25 cm' }, { value: '0.5', label: '50 cm' }]} />
      </Field>
      <Toggle checked={ortho} onChange={setOrtho} label="Rechte Winkel bevorzugen" />
      <div className="divider" />
      <h4>Plan-Unterlage</h4>
      <p className="small muted">Lade deinen Grundriss als Bild hoch, lege den Maßstab über eine bekannte Strecke fest und zeichne die Wände darüber nach.</p>
      {ul && ulUrl ? (
        <>
          <Field label="Deckkraft">
            <input type="range" min="0.1" max="1" step="0.05" value={ul.opacity ?? 0.5} onChange={(e) => set({ underlay: { ...ul, opacity: Number(e.target.value) } })} />
          </Field>
          <div className="grid2">
            <Field label="Breite">
              <NumInput value={ul.w} onChange={(v) => v && set({ underlay: { ...ul, w: v } })} unit="m" digits={2} />
            </Field>
            <Field label="Drehung">
              <NumInput value={ul.rot || 0} onChange={(v) => set({ underlay: { ...ul, rot: v || 0 } })} unit="°" digits={1} />
            </Field>
          </div>
          <div className="hstack">
            <Btn small icon="ruler" onClick={onCalibrate}>
              Kalibrieren
            </Btn>
            <Btn small kind="ghost" icon="image" onClick={onUpload}>
              Ersetzen
            </Btn>
            <ConfirmBtn onConfirm={() => set({ underlay: null })}>Entfernen</ConfirmBtn>
          </div>
        </>
      ) : (
        <Btn small icon="upload" onClick={onUpload}>
          Grundriss-Bild laden
        </Btn>
      )}
    </div>
  );
}

// =====================================================================
function RoofEditor({ data, floors }) {
  const boxRef = useRef(null);
  const svgRef = useRef(null);
  const [sel, setSel] = useState(null);
  const [tool, setTool] = useState('select');
  const [drag, setDrag] = useState(null);
  const hist = useRef({ undo: [], redo: [] });
  const house = data.house;
  const sections = house?.model?.roofSections || [];
  const top = floors[floors.length - 1];
  const outline = top ? outerOutline(top.walls || []) : null;
  const fitPts = useCallback(() => (outline || []).concat(sections.flatMap((s) => [[s.x - 1, s.y - 1], [s.x + s.w + 1, s.y + s.d + 1]])), [top?.id]);
  const { size, view, setView, fit } = useViewport(boxRef, fitPts, 'roof');
  const { pointers } = usePanZoom(svgRef, view, setView);
  const baseAuto = autoRoofBase(floors);
  const saveSections = (next, undo = true) => {
    if (undo) {
      hist.current.undo.push(JSON.stringify(sections));
      hist.current.redo = [];
    }
    updateHouse((h) => ({ ...h, model: { ...h.model, roofSections: next } }), 300);
  };
  const toWorld = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return [(e.clientX - r.left - view.tx) / view.s, (e.clientY - r.top - view.ty) / view.s];
  };
  const snap = (p) => {
    const pts = outline || [];
    for (const q of pts) if (dist(p, q) < 12 / view.s) return [...q];
    return [Math.round(p[0] / 0.05) * 0.05, Math.round(p[1] / 0.05) * 0.05].map(r3);
  };
  const fromOutline = () => {
    if (!outline) return;
    const bb = bbox(outline);
    const s = { id: uid('rs'), x: r3(bb.minX), y: r3(bb.minY), w: r3(bb.w), d: r3(bb.h), type: 'gable', pitch: 35, ridge: bb.w >= bb.h ? 'x' : 'y', overhang: 0.45, base: null };
    saveSections([s]);
    setSel(s.id);
  };
  const onDown = (e) => {
    svgRef.current.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, true);
    const p = toWorld(e);
    if (tool === 'rect') return setDrag({ kind: 'new', a: snap(p), b: snap(p) });
    const hit = [...sections].reverse().find((s) => p[0] >= s.x && p[0] <= s.x + s.w && p[1] >= s.y && p[1] <= s.y + s.d);
    if (hit) {
      setSel(hit.id);
      return setDrag({ kind: 'move', id: hit.id, p0: p, x0: hit.x, y0: hit.y, from: JSON.stringify(sections) });
    }
    setSel(null);
    setDrag({ kind: 'pan', x0: e.clientX, y0: e.clientY, view: { ...view } });
  };
  const onMove = (e) => {
    if (!drag) return;
    const p = toWorld(e);
    if (drag.kind === 'pan') return setView({ ...drag.view, tx: drag.view.tx + e.clientX - drag.x0, ty: drag.view.ty + e.clientY - drag.y0 });
    if (drag.kind === 'new') return setDrag({ ...drag, b: snap(p) });
    if (drag.kind === 'move') {
      drag.moved = true;
      saveSections(sections.map((s) => (s.id === drag.id ? { ...s, x: r3(Math.round((drag.x0 + p[0] - drag.p0[0]) / 0.05) * 0.05), y: r3(Math.round((drag.y0 + p[1] - drag.p0[1]) / 0.05) * 0.05) } : s)), false);
    }
  };
  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (drag?.kind === 'new') {
      const x = Math.min(drag.a[0], drag.b[0]),
        y = Math.min(drag.a[1], drag.b[1]);
      const w = Math.abs(drag.b[0] - drag.a[0]),
        d = Math.abs(drag.b[1] - drag.a[1]);
      if (w > 0.5 && d > 0.5) {
        const s = { id: uid('rs'), x: r3(x), y: r3(y), w: r3(w), d: r3(d), type: 'gable', pitch: 35, ridge: w >= d ? 'x' : 'y', overhang: 0.45, base: null };
        saveSections([...sections, s]);
        setSel(s.id);
        setTool('select');
      }
    }
    if (drag?.kind === 'move' && drag.moved) {
      hist.current.undo.push(drag.from);
      hist.current.redo = [];
    }
    setDrag(null);
  };
  const undo = () => {
    if (!hist.current.undo.length) return;
    hist.current.redo.push(JSON.stringify(sections));
    saveSections(JSON.parse(hist.current.undo.pop()), false);
  };
  const redo = () => {
    if (!hist.current.redo.length) return;
    hist.current.undo.push(JSON.stringify(sections));
    saveSections(JSON.parse(hist.current.redo.pop()), false);
  };
  const s = sections.find((x) => x.id === sel);
  const setSec = (patch) => saveSections(sections.map((x) => (x.id === s.id ? { ...x, ...patch } : x)));
  const { s: sc, tx, ty } = view;
  const px = (n) => n / sc;
  return (
    <>
      <div className="plan-main">
        <div className="plan-tools">
          <Seg small value={tool} onChange={setTool} options={[{ value: 'select', icon: 'cursor', label: 'Auswählen' }, { value: 'rect', icon: 'roof', label: 'Dachfläche zeichnen' }]} />
          <Btn small kind="ghost" icon="magic" onClick={fromOutline} disabled={!outline}>
            Aus Außenwänden
          </Btn>
        </div>
        <div className="plan-canvas" ref={boxRef}>
          <div className="plan-quick">
            <IconBtn icon="undo" label="Rückgängig" onClick={undo} disabled={!hist.current.undo.length} />
            <IconBtn icon="redo" label="Wiederholen" onClick={redo} disabled={!hist.current.redo.length} />
            <FullBtn />
          </div>
          <svg ref={svgRef} width={size.w} height={size.h} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ cursor: tool === 'rect' ? 'crosshair' : 'default' }} role="application" aria-label="Dachflächen">
            <g transform={`translate(${tx},${ty}) scale(${sc})`}>
              <Grid view={view} size={size} />
              {floors.map((f) => {
                const ol = outerOutline(f.walls || []);
                return ol ? <polygon key={f.id} points={ptsAttr(ol)} fill={f.id === top?.id ? 'var(--surface)' : 'none'} stroke="var(--ink-3)" strokeWidth={px(1)} strokeDasharray={f.id === top?.id ? 'none' : `${px(4)} ${px(3)}`} /> : null;
              })}
              {sections.map((x) => {
                const geo = sectionGeometry(x, x.base ?? baseAuto, house.northAngle || 0);
                const o = x.overhang ?? 0.45;
                const ridgeX = (x.ridge || (x.w >= x.d ? 'x' : 'y')) === 'x';
                return (
                  <g key={x.id}>
                    <rect x={x.x - o} y={x.y - o} width={x.w + 2 * o} height={x.d + 2 * o} fill="none" stroke="var(--warn)" strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} />
                    <rect x={x.x} y={x.y} width={x.w} height={x.d} className={`svg-roof ${sel === x.id ? 'sel' : ''}`} strokeWidth={px(sel === x.id ? 2.5 : 1.5)} />
                    {x.type !== 'flat' && x.type !== 'shed' ? (
                      ridgeX ? <line x1={x.x + (x.type === 'hip' ? x.d / 2 : 0)} x2={x.x + x.w - (x.type === 'hip' ? x.d / 2 : 0)} y1={x.y + x.d / 2} y2={x.y + x.d / 2} stroke="var(--warn)" strokeWidth={px(2.5)} /> : <line y1={x.y + (x.type === 'hip' ? x.w / 2 : 0)} y2={x.y + x.d - (x.type === 'hip' ? x.w / 2 : 0)} x1={x.x + x.w / 2} x2={x.x + x.w / 2} stroke="var(--warn)" strokeWidth={px(2.5)} />
                    ) : null}
                    <text x={x.x + x.w / 2} y={x.y + x.d / 2 - px(8)} textAnchor="middle" fontSize={px(12)} className="svg-room-label" fontWeight="600">
                      {ROOF_TYPES.find((t) => t.key === x.type)?.name} · {fmtNum(x.pitch, 0)}°
                    </text>
                    <text x={x.x + x.w / 2} y={x.y + x.d / 2 + px(10)} textAnchor="middle" fontSize={px(11)} className="svg-room-area">
                      First {fmtFixed(geo.ridgeZ, 2)} m
                    </text>
                  </g>
                );
              })}
              {drag?.kind === 'new' ? <rect x={Math.min(drag.a[0], drag.b[0])} y={Math.min(drag.a[1], drag.b[1])} width={Math.abs(drag.b[0] - drag.a[0])} height={Math.abs(drag.b[1] - drag.a[1])} className="svg-roof sel" strokeWidth={px(2)} /> : null}
            </g>
          </svg>
          <div className="plan-hint">{tool === 'rect' ? 'Rechteck über dem Grundriss aufziehen (inkl. Außenwände, ohne Überstand).' : 'Dachfläche anklicken zum Bearbeiten, ziehen zum Verschieben.'}</div>
          <div className="plan-zoom">
            <IconBtn icon="target" label="Einpassen" size={16} onClick={fit} />
          </div>
        </div>
      </div>
      <PropsPanel title={s ? 'Dachfläche' : 'Dach'} openKey={s?.id || (tool === 'rect' ? 'rect' : null)}>
        {s ? (
          <div className="stack">
            <div className="spread">
              <h4>Dachfläche</h4>
              <ConfirmBtn onConfirm={() => { saveSections(sections.filter((x) => x.id !== s.id)); setSel(null); }}>{''}</ConfirmBtn>
            </div>
            <Field label="Dachform">
              <Select value={s.type} onChange={(v) => setSec({ type: v })} options={ROOF_TYPES.map((t) => ({ value: t.key, label: t.name }))} />
            </Field>
            {s.type !== 'flat' ? (
              <Field label="Neigung">
                <NumInput value={s.pitch} onChange={(v) => v && setSec({ pitch: v })} unit="°" digits={1} min={3} max={70} />
              </Field>
            ) : null}
            {s.type !== 'flat' ? (
              <Field label={s.type === 'shed' ? 'Gefälle' : 'Firstrichtung'}>
                <Seg small value={s.ridge || (s.w >= s.d ? 'x' : 'y')} onChange={(v) => setSec({ ridge: v })} options={[{ value: 'x', label: s.type === 'shed' ? 'Nord–Süd' : 'Ost–West' }, { value: 'y', label: s.type === 'shed' ? 'Ost–West' : 'Nord–Süd' }]} />
              </Field>
            ) : null}
            {s.type === 'shed' ? <Toggle checked={!!s.flip} onChange={(v) => setSec({ flip: v })} label="Hohe Seite tauschen" /> : null}
            <div className="grid2">
              <Field label="Links (x)">
                <NumInput value={s.x} onChange={(v) => v != null && setSec({ x: v })} unit="m" digits={3} />
              </Field>
              <Field label="Oben (y)">
                <NumInput value={s.y} onChange={(v) => v != null && setSec({ y: v })} unit="m" digits={3} />
              </Field>
              <Field label="Breite">
                <NumInput value={s.w} onChange={(v) => v && setSec({ w: v })} unit="m" digits={3} />
              </Field>
              <Field label="Tiefe">
                <NumInput value={s.d} onChange={(v) => v && setSec({ d: v })} unit="m" digits={3} />
              </Field>
              <Field label="Überstand">
                <NumInput value={s.overhang} onChange={(v) => setSec({ overhang: v ?? 0 })} unit="m" digits={2} />
              </Field>
              <Field label="Traufhöhe" hint={`Leer = automatisch (${fmtFixed(baseAuto, 2)} m)`}>
                <NumInput value={s.base} onChange={(v) => setSec({ base: v })} unit="m" digits={2} />
              </Field>
            </div>
          </div>
        ) : (
          <div className="stack">
            <h4>Dach</h4>
            <p className="small muted">Das Dach besteht aus rechteckigen Dachflächen. Ein L-förmiges Haus bekommt zwei Flächen, z. B. zwei Satteldächer.</p>
            <p className="small muted">Ist das oberste Geschoss ein Dachgeschoss, schneidet die Dachschräge seine Wände automatisch ab.</p>
            {!sections.length ? (
              <Btn icon="magic" onClick={fromOutline} disabled={!outline}>
                Dach aus Außenwänden erzeugen
              </Btn>
            ) : null}
          </div>
        )}
      </PropsPanel>
    </>
  );
}

// =====================================================================
// Plot with outbuildings (garage, carport, shed …) and neighbouring houses as simple boxes.
const CTX_KINDS = [
  { value: 'outbuilding', label: 'Nebengebäude' },
  { value: 'neighbor', label: 'Nachbarhaus' },
];
function SiteEditor({ data, floors }) {
  const boxRef = useRef(null);
  const svgRef = useRef(null);
  const [sel, setSel] = useState(null);
  const [tool, setTool] = useState('select');
  const [drag, setDrag] = useState(null);
  const hist = useRef({ undo: [], redo: [] });
  const model = data.house?.model || {};
  const list = model.context || [];
  const plot = model.plot?.poly || [];
  const ground = floors.find((f) => f.short === 'EG') || floors.find((f) => f.elevation >= -0.01) || floors[0];
  const outline = ground ? outerOutline(ground.walls || []) : null;
  const fitPts = useCallback(() => {
    const pts = [...plot, ...(outline || [])];
    for (const b of list) if (b.kind !== 'neighbor') pts.push([b.x - 1, b.y - 1], [b.x + b.w + 1, b.y + b.d + 1]);
    return pts;
  }, [ground?.id, plot.length]);
  const { size, view, setView, fit } = useViewport(boxRef, fitPts, 'site');
  const { pointers } = usePanZoom(svgRef, view, setView);
  const save = (next, undo = true) => {
    if (undo) {
      hist.current.undo.push(JSON.stringify(list));
      hist.current.redo = [];
    }
    updateHouse((h) => ({ ...h, model: { ...h.model, context: next } }), 300);
  };
  const toWorld = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return [(e.clientX - r.left - view.tx) / view.s, (e.clientY - r.top - view.ty) / view.s];
  };
  const snap = (v) => r3(Math.round(v / 0.05) * 0.05);
  const inside = (p, b) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.d;
  const onDown = (e) => {
    svgRef.current.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, true);
    const p = toWorld(e);
    if (tool === 'rect') return setDrag({ kind: 'new', a: [snap(p[0]), snap(p[1])], b: [snap(p[0]), snap(p[1])] });
    const cur = list.find((b) => b.id === sel);
    if (cur && dist(p, [cur.x + cur.w, cur.y + cur.d]) < 10 / view.s) return setDrag({ kind: 'size', id: cur.id, from: JSON.stringify(list) });
    // outbuildings are picked before neighbours
    const hit = [...list.filter((b) => b.kind !== 'neighbor'), ...list.filter((b) => b.kind === 'neighbor')].reverse().find((b) => inside(p, b));
    if (hit) {
      setSel(hit.id);
      return setDrag({ kind: 'move', id: hit.id, p0: p, x0: hit.x, y0: hit.y, from: JSON.stringify(list) });
    }
    setDrag({ kind: 'pan', x0: e.clientX, y0: e.clientY, view: { ...view }, clear: true });
  };
  const onMove = (e) => {
    if (!drag) return;
    const p = toWorld(e);
    if (drag.kind === 'pan') {
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 3) drag.moved = true;
      return setView({ ...drag.view, tx: drag.view.tx + e.clientX - drag.x0, ty: drag.view.ty + e.clientY - drag.y0 });
    }
    if (drag.kind === 'new') return setDrag({ ...drag, b: [snap(p[0]), snap(p[1])] });
    if (drag.kind === 'move') {
      drag.moved = true;
      save(list.map((b) => (b.id === drag.id ? { ...b, x: snap(drag.x0 + p[0] - drag.p0[0]), y: snap(drag.y0 + p[1] - drag.p0[1]) } : b)), false);
    }
    if (drag.kind === 'size') {
      drag.moved = true;
      save(list.map((b) => (b.id === drag.id ? { ...b, w: Math.max(0.5, snap(p[0] - b.x)), d: Math.max(0.5, snap(p[1] - b.y)) } : b)), false);
    }
  };
  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (drag?.kind === 'pan' && drag.clear && !drag.moved) setSel(null);
    if (drag?.kind === 'new') {
      const x = Math.min(drag.a[0], drag.b[0]),
        y = Math.min(drag.a[1], drag.b[1]);
      const w = Math.abs(drag.b[0] - drag.a[0]),
        d = Math.abs(drag.b[1] - drag.a[1]);
      if (w > 0.5 && d > 0.5) {
        const b = { id: uid('ctx-'), kind: 'outbuilding', name: 'Nebengebäude', x: r3(x), y: r3(y), w: r3(w), d: r3(d), h: 2.4, roof: 'flat', notes: '' };
        save([...list, b]);
        setSel(b.id);
        setTool('select');
      }
    }
    if ((drag?.kind === 'move' || drag?.kind === 'size') && drag.moved) {
      hist.current.undo.push(drag.from);
      hist.current.redo = [];
    }
    setDrag(null);
  };
  const undo = () => {
    if (!hist.current.undo.length) return;
    hist.current.redo.push(JSON.stringify(list));
    save(JSON.parse(hist.current.undo.pop()), false);
  };
  const redo = () => {
    if (!hist.current.redo.length) return;
    hist.current.undo.push(JSON.stringify(list));
    save(JSON.parse(hist.current.redo.pop()), false);
  };
  const b = list.find((x) => x.id === sel);
  const setB = (patch) => save(list.map((x) => (x.id === b.id ? { ...x, ...patch } : x)));
  const { s: sc, tx, ty } = view;
  const px = (n) => n / sc;
  const outbuildings = list.filter((x) => x.kind !== 'neighbor');
  return (
    <>
      <div className="plan-main">
        <div className="plan-tools">
          <Seg small value={tool} onChange={setTool} options={[{ value: 'select', icon: 'cursor', label: 'Auswählen' }, { value: 'rect', icon: 'plus', label: 'Nebengebäude zeichnen' }]} />
        </div>
        <div className="plan-canvas" ref={boxRef}>
          <div className="plan-quick">
            <IconBtn icon="undo" label="Rückgängig" onClick={undo} disabled={!hist.current.undo.length} />
            <IconBtn icon="redo" label="Wiederholen" onClick={redo} disabled={!hist.current.redo.length} />
            <FullBtn />
          </div>
          <svg ref={svgRef} width={size.w} height={size.h} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ cursor: tool === 'rect' ? 'crosshair' : 'default' }} role="application" aria-label="Grundstück">
            <g transform={`translate(${tx},${ty}) scale(${sc})`}>
              <Grid view={view} size={size} />
              {plot.length >= 3 ? <polygon points={ptsAttr(plot)} fill="var(--accent-soft)" fillOpacity="0.55" stroke="var(--accent)" strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} /> : null}
              {(model.paving || []).map((pv, i) => (
                <polygon key={i} points={ptsAttr(pv.poly || [])} fill="var(--surface-3)" stroke="var(--line-2)" strokeWidth={px(1)} />
              ))}
              {outline ? <polygon points={ptsAttr(outline)} fill="var(--ink-3)" fillOpacity="0.85" stroke="var(--ink-2)" strokeWidth={px(1)} /> : null}
              {outline ? (
                <text x={labelPoint(outline)[0]} y={labelPoint(outline)[1] + px(4)} textAnchor="middle" fontSize={px(12)} fontWeight="700" fill="#fff">
                  Wohnhaus
                </text>
              ) : null}
              {[...list.filter((x) => x.kind === 'neighbor'), ...outbuildings].map((x) => {
                const nb = x.kind === 'neighbor';
                const isSel = sel === x.id;
                return (
                  <g key={x.id}>
                    <rect
                      x={x.x}
                      y={x.y}
                      width={x.w}
                      height={x.d}
                      fill={nb ? 'var(--surface-2)' : x.color || '#c9b79e'}
                      fillOpacity={nb ? 0.9 : x.open ? 0.35 : 0.85}
                      stroke={isSel ? 'var(--accent)' : nb ? 'var(--line-2)' : '#8a7356'}
                      strokeWidth={px(isSel ? 2.5 : 1.2)}
                      strokeDasharray={x.open && !isSel ? `${px(5)} ${px(3)}` : undefined}
                    />
                    {x.name ? (
                      <text x={x.x + x.w / 2} y={x.y + x.d / 2 - (nb ? 0 : px(3))} textAnchor="middle" fontSize={px(nb ? 11 : 12)} className="svg-room-label" fontWeight={nb ? 500 : 700}>
                        {x.name}
                      </text>
                    ) : null}
                    {!nb ? (
                      <text x={x.x + x.w / 2} y={x.y + x.d / 2 + px(11)} textAnchor="middle" fontSize={px(10.5)} className="svg-room-area">
                        {fmtFixed(x.w, 2)} × {fmtFixed(x.d, 2)} m
                      </text>
                    ) : null}
                    {isSel ? <circle cx={x.x + x.w} cy={x.y + x.d} r={px(6)} className="svg-handle" strokeWidth={px(2)} style={{ cursor: 'nwse-resize' }} /> : null}
                  </g>
                );
              })}
              {drag?.kind === 'new' ? <rect x={Math.min(drag.a[0], drag.b[0])} y={Math.min(drag.a[1], drag.b[1])} width={Math.abs(drag.b[0] - drag.a[0])} height={Math.abs(drag.b[1] - drag.a[1])} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={px(2)} /> : null}
            </g>
          </svg>
          <div className="plan-hint">{tool === 'rect' ? 'Rechteck für das neue Nebengebäude aufziehen.' : 'Gebäude anklicken zum Bearbeiten, ziehen zum Verschieben, Eckpunkt ziehen ändert die Größe.'}</div>
          <div className="plan-zoom">
            <IconBtn icon="minus" label="Herauszoomen" size={16} onClick={() => setView((v) => ({ ...v, s: v.s / 1.25, tx: size.w / 2 - (size.w / 2 - v.tx) / 1.25, ty: size.h / 2 - (size.h / 2 - v.ty) / 1.25 }))} />
            <IconBtn icon="target" label="Einpassen" size={16} onClick={fit} />
            <IconBtn icon="plus" label="Hineinzoomen" size={16} onClick={() => setView((v) => ({ ...v, s: v.s * 1.25, tx: size.w / 2 - (size.w / 2 - v.tx) * 1.25, ty: size.h / 2 - (size.h / 2 - v.ty) * 1.25 }))} />
          </div>
        </div>
      </div>
      <PropsPanel title={b ? b.name || 'Nebengebäude' : 'Grundstück'} openKey={b?.id || null}>
        {b ? (
          <div className="stack">
            <div className="spread">
              <h4>{b.kind === 'neighbor' ? 'Nachbarhaus' : 'Nebengebäude'}</h4>
              <ConfirmBtn onConfirm={() => { save(list.filter((x) => x.id !== b.id)); setSel(null); }}>{''}</ConfirmBtn>
            </div>
            <Field label="Name">
              <TextInput id={'ctx-name-' + b.id} value={b.name} onChange={(v) => setB({ name: v })} placeholder="z. B. Garage, Schuppen" />
            </Field>
            <Field label="Art">
              <Seg small value={b.kind === 'neighbor' ? 'neighbor' : 'outbuilding'} onChange={(v) => setB({ kind: v })} options={CTX_KINDS} />
            </Field>
            {b.kind !== 'neighbor' ? (
              <Btn small kind="primary" icon="plan" onClick={() => setUI({ floorId: 'ctx:' + b.id })}>
                {(b.walls || []).length ? 'Grundriss bearbeiten' : 'Wände, Räume & Leitungen zeichnen'}
              </Btn>
            ) : null}
            {b.kind !== 'neighbor' ? <Toggle checked={!!b.open} onChange={(v) => setB({ open: v })} label="Offen (Carport, Überdachung)" /> : null}
            <div className="grid2">
              <Field label="Breite (x)">
                <NumInput value={b.w} onChange={(v) => v > 0.2 && setB({ w: v })} unit="m" digits={2} />
              </Field>
              <Field label="Tiefe (y)">
                <NumInput value={b.d} onChange={(v) => v > 0.2 && setB({ d: v })} unit="m" digits={2} />
              </Field>
              <Field label="Wandhöhe">
                <NumInput value={b.h} onChange={(v) => v > 0.5 && setB({ h: v })} unit="m" digits={2} />
              </Field>
              <Field label="Grundfläche">
                <div className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)' }}>
                  {fmtFixed(b.w * b.d, 1)} m²
                </div>
              </Field>
              <Field label="Links (x)">
                <NumInput value={b.x} onChange={(v) => v != null && setB({ x: v })} unit="m" digits={2} />
              </Field>
              <Field label="Oben (y)">
                <NumInput value={b.y} onChange={(v) => v != null && setB({ y: v })} unit="m" digits={2} />
              </Field>
            </div>
            <Field label="Dachform">
              <Select value={b.roof || 'flat'} onChange={(v) => setB({ roof: v, pitch: v === 'flat' ? b.pitch : b.pitch ?? (v === 'shed' ? 10 : 30) })} options={ROOF_TYPES.map((t) => ({ value: t.key, label: t.name }))} />
            </Field>
            {b.roof && b.roof !== 'flat' ? (
              <div className="grid2">
                <Field label="Neigung">
                  <NumInput value={b.pitch ?? 30} onChange={(v) => v && setB({ pitch: v })} unit="°" digits={0} min={3} max={60} />
                </Field>
                <Field label={b.roof === 'shed' ? 'Gefälle' : 'First'}>
                  <Seg small value={b.ridge || (b.w >= b.d ? 'x' : 'y')} onChange={(v) => setB({ ridge: v })} options={[{ value: 'x', label: 'quer' }, { value: 'y', label: 'längs' }]} />
                </Field>
              </div>
            ) : null}
            {b.roof === 'shed' ? <Toggle checked={!!b.flip} onChange={(v) => setB({ flip: v })} label="Hohe Seite tauschen" /> : null}
            <Toggle checked={b.label !== false} onChange={(v) => setB({ label: v ? undefined : false })} label="Beschriftung im 3D-Modell" />
            <Field label="Notizen">
              <TextInput multiline rows={3} value={b.notes || ''} onChange={(v) => setB({ notes: v })} placeholder="Boden, Elektrik, Zustand, Nutzung …" />
            </Field>
          </div>
        ) : (
          <div className="stack">
            <h4>Grundstück</h4>
            <p className="small muted">Garage, Carport, Schuppen und Gartenhaus stehen hier als einfache Baukörper. Sie werfen im 3D-Modell Schatten und fließen in die PV-Verschattung ein.</p>
            <span className="field-label">Nebengebäude ({outbuildings.length})</span>
            <div className="chips">
              {outbuildings.map((x) => (
                <button key={x.id} className="chip" onClick={() => setSel(x.id)}>
                  {x.name || 'Ohne Namen'} · {fmtFixed(x.w * x.d, 0)} m²
                </button>
              ))}
            </div>
            <div>
              <Btn small icon="plus" onClick={() => setTool('rect')}>
                Nebengebäude zeichnen
              </Btn>
            </div>
          </div>
        )}
      </PropsPanel>
    </>
  );
}

// =====================================================================
// Floor plan of an outbuilding: the regular editor, stored inside the site entry.
function CtxFloorEditor({ data, b }) {
  const ground = data.house?.model?.groundLevel ?? 0;
  const floor = { id: b.id, name: b.name || 'Nebengebäude', short: 'NG', elevation: r3(ground + (b.z ?? 0)), height: b.h ?? 2.4, slab: 0, walls: b.walls || [], rooms: b.rooms || [], items: b.items || [], lines: b.lines || [], points: b.points || [], dims: b.dims || [], furniture: b.furniture || [] };
  const persist = (n, delay) =>
    updateHouse(
      (h) => ({
        ...h,
        model: { ...h.model, context: (h.model?.context || []).map((x) => (x.id === b.id ? { ...x, walls: n.walls || [], rooms: n.rooms || [], items: n.items || [], lines: n.lines || [], points: n.points || [], dims: n.dims || [], furniture: n.furniture || [] } : x)) },
      }),
      delay,
    );
  return <FloorEditor data={data} floor={floor} floors={[floor]} persist={persist} guide={b} ctx />;
}

function CtxProps({ b, floor, grid, setGrid, ortho, setOrtho, mutate, lines, points, onSelectFurn }) {
  const [t, setT] = useState(0.24);
  const setB = (patch) => updateHouse((h) => ({ ...h, model: { ...h.model, context: (h.model?.context || []).map((x) => (x.id === b.id ? { ...x, ...patch } : x)) } }), 300);
  const outlineWalls = () => {
    const h = t / 2;
    const c = [[b.x + h, b.y + h], [b.x + b.w - h, b.y + h], [b.x + b.w - h, b.y + b.d - h], [b.x + h, b.y + b.d - h]].map(P3);
    mutate((f) => ({ ...f, walls: [...(f.walls || []), ...c.map((a, i) => ({ id: uid('w'), a, b: c[(i + 1) % 4], t, ext: true, openings: [] }))] }));
    toast('Außenwände erzeugt – setze jetzt Türen und Fenster und klicke mit „Raum“ in die Fläche.');
  };
  return (
    <div className="stack">
      <div className="spread">
        <h4>{b.name || 'Nebengebäude'}</h4>
        <Btn small kind="ghost" icon="chevL" onClick={() => setUI({ floorId: 'site' })}>
          Grundstück
        </Btn>
      </div>
      <Field label="Name">
        <TextInput id={'ctxp-name-' + b.id} value={b.name} onChange={(v) => setB({ name: v })} />
      </Field>
      <div className="grid2">
        <Field label="Wandhöhe">
          <NumInput value={b.h} onChange={(v) => v > 0.5 && setB({ h: v })} unit="m" digits={2} />
        </Field>
        <Field label="Grundfläche">
          <div className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)' }}>
            {fmtFixed(b.w * b.d, 1)} m²
          </div>
        </Field>
      </div>
      {!(floor.walls || []).length ? (
        <div className="panel" style={{ padding: 10 }}>
          <span className="field-label">Außenwände aus dem Umriss</span>
          <div className="stack" style={{ gap: 8, marginTop: 6 }}>
            <Select value={String(t)} onChange={(v) => setT(Number(v))} options={THICKNESS.map((x) => ({ value: String(x.value), label: x.label }))} />
            <Btn small icon="magic" onClick={outlineWalls}>
              Außenwände erzeugen
            </Btn>
          </div>
        </div>
      ) : null}
      <p className="small muted">Der gestrichelte Rahmen ist der Umriss aus dem Lageplan. Wände, Räume, Türen, Leitungen und Anschlüsse zeichnest du wie im Wohnhaus. Lage und Größe änderst du unter „Grundstück“.</p>
      <LineSummary lines={lines} points={points} />
      <FurnitureSummary list={floor.furniture} floor={floor} onSelect={onSelectFurn} />
      <div className="divider" />
      <h4>Raster & Fang</h4>
      <Field label="Raster">
        <Select value={String(grid)} onChange={(v) => setGrid(Number(v))} options={[{ value: '0.01', label: '1 cm' }, { value: '0.05', label: '5 cm' }, { value: '0.1', label: '10 cm' }, { value: '0.25', label: '25 cm' }, { value: '0.5', label: '50 cm' }]} />
      </Field>
      <Toggle checked={ortho} onChange={setOrtho} label="Rechte Winkel bevorzugen" />
    </div>
  );
}
