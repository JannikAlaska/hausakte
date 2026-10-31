// Furniture in the floor plan: plan symbols (scaled to the entered size), catalog with previews and the properties panel.
import { Icon } from './icons.jsx';
import { Btn, Field, TextInput, NumInput, Select, Seg, ConfirmBtn } from './common.jsx';
import { FURNITURE, FURN_CATS, FURN_SWATCHES, furnType, furnColor, furnSize, furnToPlan, wallAlign, snapToWalls, standsAtWall } from '../furniture.js';
import { roomOfPoint } from '../planops.js';
import { uid } from '../util.js';

const { useState, useMemo } = React;
const r3 = (v) => Math.round(v * 1000) / 1000;
const cm = (m) => Math.round(m * 100);
export const normRot = (r) => Math.round((((r % 360) + 360) % 360) * 10) / 10 % 360;

// ---------- plan symbol ----------
export function FurnitureSymbol({ f, px, sel, ghost }) {
  const t = furnType(f.type);
  const { w, d } = furnSize(f);
  const col = furnColor(f);
  const planned = f.status === 'geplant';
  const stroke = sel ? 'var(--accent)' : 'var(--furn-line)';
  const body = { fill: col, fillOpacity: ghost ? 0.22 : 0.4, stroke, strokeWidth: px(sel ? 2 : 1.1), strokeDasharray: planned || ghost ? `${px(4)} ${px(3)}` : undefined, strokeLinejoin: 'round' };
  const det = { fill: 'none', stroke, strokeWidth: px(0.8), strokeOpacity: 0.85 };
  const solid = { fill: '#ffffff', fillOpacity: 0.85, stroke, strokeWidth: px(0.8) };
  const x0 = -w / 2,
    y0 = -d / 2,
    x1 = w / 2,
    y1 = d / 2;
  const R = (x, y, ww, hh, p = det, rx = 0) => <rect x={x} y={y} width={Math.max(0.001, ww)} height={Math.max(0.001, hh)} rx={Math.max(0, Math.min(rx, ww / 2, hh / 2))} {...p} />;
  const L = (ax, ay, bx, by, p = det) => <line x1={ax} y1={ay} x2={bx} y2={by} {...p} />;
  const C = (cx, cy, r, p = det) => <circle cx={cx} cy={cy} r={Math.max(0.001, r)} {...p} />;
  const E = (cx, cy, rx, ry, p = det) => <ellipse cx={cx} cy={cy} rx={Math.max(0.001, rx)} ry={Math.max(0.001, ry)} {...p} />;
  const m = Math.min(w, d);
  let el;
  switch (t.kind) {
    case 'sofa':
    case 'armchair': {
      const arm = Math.min(0.2, w * 0.14),
        back = Math.min(0.25, d * 0.25);
      const n = t.kind === 'sofa' ? Math.max(1, Math.round((w - 2 * arm) / 0.65)) : 1;
      const cw = (w - 2 * arm) / n;
      el = (
        <>
          {R(x0, y0, w, d, body, 0.06)}
          {R(x0 + arm, y0, w - 2 * arm, back)}
          {R(x0, y0, arm, d, det, 0.05)}
          {R(x1 - arm, y0, arm, d, det, 0.05)}
          {Array.from({ length: n - 1 }, (_, i) => <line key={i} x1={x0 + arm + cw * (i + 1)} y1={y0 + back} x2={x0 + arm + cw * (i + 1)} y2={y1 - 0.03} {...det} />)}
        </>
      );
      break;
    }
    case 'cornerSofa': {
      const sd = Math.min(0.95, d * 0.55),
        back = 0.22;
      el = (
        <>
          <path d={`M${x0},${y0} H${x1} V${y1} H${x1 - sd} V${y0 + sd} H${x0} Z`} {...body} />
          {R(x0 + 0.18, y0, w - 0.18 - back, back)}
          {R(x1 - back, y0, back, d)}
          {R(x0, y0, 0.18, sd, det, 0.05)}
          {L(x1 - sd, y0 + sd, x1 - back, y0 + back)}
        </>
      );
      break;
    }
    case 'table':
    case 'bench':
      el = (
        <>
          {R(x0, y0, w, d, body, 0.02)}
          {t.kind === 'bench' ? L(x0 + 0.04, 0, x1 - 0.04, 0) : R(x0 + 0.04, y0 + 0.04, w - 0.08, d - 0.08, det, 0.02)}
        </>
      );
      break;
    case 'roundTable':
      el = (
        <>
          {E(0, 0, w / 2, d / 2, body)}
          {E(0, 0, w / 2 - 0.04, d / 2 - 0.04)}
        </>
      );
      break;
    case 'chair':
      el = (
        <>
          {R(x0, y0 + d * 0.15, w, d * 0.85, body, 0.04)}
          {R(x0, y0, w, d * 0.15, body, 0.03)}
        </>
      );
      break;
    case 'officeChair':
      el = (
        <>
          {C(0, 0, m / 2, { ...det, strokeDasharray: `${px(3)} ${px(3)}` })}
          {R(-w * 0.4, -d * 0.33, w * 0.8, d * 0.78, body, 0.08)}
          {R(-w * 0.38, y0 + 0.02, w * 0.76, 0.09, body, 0.04)}
        </>
      );
      break;
    case 'bed':
    case 'cot': {
      const n = w >= 1.3 ? 2 : 1;
      const fold = y0 + d * 0.34;
      el = (
        <>
          {R(x0, y0, w, d, body, 0.03)}
          {R(x0, y0, w, 0.06, det)}
          {Array.from({ length: n }, (_, i) => (
            <rect key={i} x={x0 + (w / n) * i + 0.07} y={y0 + 0.11} width={Math.max(0.01, w / n - 0.14)} height={Math.min(0.4, d * 0.2)} rx={0.06} {...solid} />
          ))}
          {L(x0 + 0.03, fold, x1 - 0.03, fold)}
          <path d={`M${x1 - Math.min(0.4, w * 0.3)},${fold} L${x1 - 0.03},${fold + Math.min(0.4, w * 0.3)}`} {...det} />
          {t.kind === 'cot' ? Array.from({ length: 7 }, (_, i) => <line key={'b' + i} x1={x0} x2={x0 + 0.05} y1={y0 + (d / 8) * (i + 1)} y2={y0 + (d / 8) * (i + 1)} {...det} />) : null}
        </>
      );
      break;
    }
    case 'lounger':
      el = (
        <>
          {R(x0, y0, w, d, body, 0.05)}
          {L(x0, y0 + Math.min(0.55, d * 0.3), x1, y0 + Math.min(0.55, d * 0.3))}
          {R(x0 + 0.08, y0 + 0.06, w - 0.16, Math.min(0.42, d * 0.25), det, 0.05)}
        </>
      );
      break;
    case 'wardrobe':
    case 'tallCab': {
      const doors = Math.max(1, Math.round(w / 0.5));
      el = (
        <>
          {R(x0, y0, w, d, body)}
          {L(x0, y0, x1, y1)}
          {L(x0, y1 - 0.03, x1, y1 - 0.03)}
          {Array.from({ length: doors - 1 }, (_, i) => <line key={i} x1={x0 + (w / doors) * (i + 1)} x2={x0 + (w / doors) * (i + 1)} y1={y1 - 0.06} y2={y1} {...det} />)}
        </>
      );
      break;
    }
    case 'cabinet':
    case 'drawers':
    case 'baseCab':
      el = (
        <>
          {R(x0, y0, w, d, body)}
          {L(x0, y1 - 0.035, x1, y1 - 0.035)}
          {t.kind === 'drawers' ? L(-Math.min(0.12, w / 4), y1 - 0.08, Math.min(0.12, w / 4), y1 - 0.08) : null}
          {t.kind === 'cabinet' && w > 0.9 ? L(0, y1 - 0.035, 0, y1) : null}
        </>
      );
      break;
    case 'wallCab':
    case 'hood':
      el = (
        <>
          {R(x0, y0, w, d, { ...body, fillOpacity: ghost ? 0.15 : 0.22, strokeDasharray: `${px(5)} ${px(3)}` })}
          {t.kind === 'hood' ? R(-w * 0.2, y0, w * 0.4, d * 0.45, { ...det, strokeDasharray: `${px(3)} ${px(2)}` }) : L(x0, y0, x1, y1, { ...det, strokeDasharray: `${px(3)} ${px(3)}` })}
        </>
      );
      break;
    case 'shelf': {
      const n = Math.max(1, Math.round(w / 0.8));
      el = (
        <>
          {R(x0, y0, w, d, body)}
          {L(x0 + 0.02, y0 + 0.02, x1 - 0.02, y0 + 0.02)}
          {Array.from({ length: n - 1 }, (_, i) => <line key={i} x1={x0 + (w / n) * (i + 1)} x2={x0 + (w / n) * (i + 1)} y1={y0} y2={y1} {...det} />)}
        </>
      );
      break;
    }
    case 'sinkCab':
      el = (
        <>
          {R(x0, y0, w, d, body)}
          {R(-w * 0.32, y0 + d * 0.2, w * 0.64, d * 0.62, solid, 0.06)}
          {C(0, y0 + d * 0.51, 0.025)}
          {C(0, y0 + 0.07, 0.025, solid)}
        </>
      );
      break;
    case 'hob':
      el = (
        <>
          {R(x0, y0, w, d, body)}
          {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy], i) => <circle key={i} cx={sx * w * 0.22} cy={sy * d * 0.22} r={m * (i % 2 ? 0.1 : 0.13)} {...det} />)}
        </>
      );
      break;
    case 'fridge':
      el = (
        <>
          {R(x0, y0, w, d, body)}
          {R(x0 + 0.04, y0 + 0.04, w - 0.08, d - 0.1)}
          {L(x0, y1 - 0.04, x1, y1 - 0.04)}
        </>
      );
      break;
    case 'bathtub':
      el = (
        <>
          {R(x0, y0, w, d, body, 0.03)}
          {R(x0 + 0.07, y0 + 0.07, w - 0.14, d - 0.14, solid, Math.min(0.3, d / 2 - 0.07))}
          {C(x0 + 0.2, 0, 0.025)}
        </>
      );
      break;
    case 'shower':
      el = (
        <>
          {R(x0, y0, w, d, body)}
          {L(x0, y0, x1, y1)}
          {L(x1, y0, x0, y1)}
          {C(0, 0, 0.045, solid)}
        </>
      );
      break;
    case 'toilet':
      el = (
        <>
          {R(x0, y0, w, d * 0.25, body, 0.03)}
          {E(0, y0 + d * 0.25 + (d * 0.75) / 2 - 0.01, w / 2, (d * 0.75) / 2, body)}
          {E(0, y0 + d * 0.25 + (d * 0.75) / 2 + 0.01, w / 2 - 0.07, (d * 0.75) / 2 - 0.08, solid)}
        </>
      );
      break;
    case 'washbasin': {
      const n = t.basins || 1;
      el = (
        <>
          {R(x0, y0, w, d, body, 0.03)}
          {Array.from({ length: n }, (_, i) => {
            const x = x0 + (w / n) * (i + 0.5);
            return (
              <g key={i}>
                {E(x, 0.03, Math.min(w / n, 0.7) * 0.34, d * 0.3, solid)}
                {C(x, y0 + 0.06, 0.02)}
              </g>
            );
          })}
        </>
      );
      break;
    }
    case 'towelRad':
      el = (
        <>
          {R(x0, y0, w, d, body)}
          {L(x0, 0, x1, 0)}
        </>
      );
      break;
    case 'washer':
      el = (
        <>
          {R(x0, y0, w, d, body, 0.02)}
          {C(0, 0.03, m * 0.32)}
          {C(0, 0.03, m * 0.2)}
        </>
      );
      break;
    case 'tv':
      el = R(x0, y0, w, d, { ...body, fill: '#1c1f23', fillOpacity: ghost ? 0.3 : 0.85 });
      break;
    case 'floorLamp':
      el = (
        <>
          {C(0, 0, m / 2, body)}
          {C(0, 0, m / 6)}
          {L(-m / 2, 0, m / 2, 0)}
          {L(0, -m / 2, 0, m / 2)}
        </>
      );
      break;
    case 'plant':
      el = (
        <>
          {C(0, 0, m / 2, body)}
          {Array.from({ length: 6 }, (_, i) => (
            <ellipse key={i} cx={0} cy={-m * 0.24} rx={m * 0.1} ry={m * 0.22} transform={`rotate(${i * 60})`} {...det} />
          ))}
          {C(0, 0, m * 0.08)}
        </>
      );
      break;
    case 'rug':
      el = (
        <>
          {R(x0, y0, w, d, { ...body, fillOpacity: ghost ? 0.15 : 0.25 })}
          {R(x0 + 0.08, y0 + 0.08, w - 0.16, d - 0.16, { ...det, strokeDasharray: `${px(4)} ${px(3)}` })}
        </>
      );
      break;
    case 'fireplace':
      el = (
        <>
          {R(x0, y0, w, d, body, 0.04)}
          {R(x0 + w * 0.15, y1 - 0.12, w * 0.7, 0.09, { ...det, fill: '#ff9a3c', fillOpacity: 0.5 })}
          {C(0, y0 + d * 0.38, 0.08)}
        </>
      );
      break;
    case 'piano': {
      const keys = 14;
      el = (
        <>
          {R(x0, y0, w, d, body)}
          {R(x0, y0 + d * 0.55, w, d * 0.45, solid)}
          {Array.from({ length: keys - 1 }, (_, i) => <line key={i} x1={x0 + (w / keys) * (i + 1)} x2={x0 + (w / keys) * (i + 1)} y1={y0 + d * 0.55} y2={y1} {...det} />)}
        </>
      );
      break;
    }
    case 'coatRack': {
      const n = Math.max(2, Math.round(w / 0.2));
      el = (
        <>
          {R(x0, y0, w, d, body)}
          {Array.from({ length: n }, (_, i) => <circle key={i} cx={x0 + (w / n) * (i + 0.5)} cy={y0 + 0.08} r={0.025} {...det} />)}
        </>
      );
      break;
    }
    case 'boiler':
      el = (
        <>
          {R(x0, y0, w, d, body, 0.03)}
          {C(0, 0, m * 0.3)}
        </>
      );
      break;
    case 'heatpump':
      el = (
        <>
          {R(x0, y0, w, d, body, 0.03)}
          {C(-w * 0.15, 0, d * 0.36)}
          {L(-w * 0.15 - d * 0.25, -d * 0.25, -w * 0.15 + d * 0.25, d * 0.25)}
          {L(-w * 0.15 - d * 0.25, d * 0.25, -w * 0.15 + d * 0.25, -d * 0.25)}
          {[0.22, 0.3, 0.38].map((k) => <line key={k} x1={w * k} x2={w * k} y1={y0 + 0.08} y2={y1 - 0.08} {...det} />)}
        </>
      );
      break;
    case 'car':
      el = (
        <>
          {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy], i) => (
            <rect key={i} x={sx * (w / 2) - 0.11 + (sx > 0 ? -0.02 : 0.02)} y={sy * (d / 2 - 0.75) - 0.32} width={0.22} height={0.64} rx={0.05} fill="#1c1f22" />
          ))}
          {R(x0, y0, w, d, body, 0.3)}
          {R(x0 + 0.14, -d * 0.2, w - 0.28, d * 0.36, solid, 0.12)}
          {L(x0 + 0.12, -d * 0.2 - 0.25, x1 - 0.12, -d * 0.2 - 0.25)}
        </>
      );
      break;
    case 'bike':
      el = (
        <>
          {E(0, y0 + 0.36, 0.025, 0.34, body)}
          {E(0, y1 - 0.36, 0.025, 0.34, body)}
          {L(0, y0 + 0.36, 0, y1 - 0.36, { ...det, strokeWidth: px(1.6) })}
          {L(-w * 0.35, y1 - 0.42, w * 0.35, y1 - 0.42, { ...det, strokeWidth: px(1.6) })}
          {R(-0.06, -0.12, 0.12, 0.24, body, 0.04)}
        </>
      );
      break;
    case 'bin':
      el = (
        <>
          {R(x0, y0, w, d, body, 0.03)}
          {L(x0, y0 + 0.07, x1, y0 + 0.07)}
          {C(x0 + 0.1, y0 + 0.03, 0.06, solid)}
          {C(x1 - 0.1, y0 + 0.03, 0.06, solid)}
        </>
      );
      break;
    case 'mower':
      el = (
        <>
          {R(x0, y1 - w, w, w, body, 0.06)}
          {C(0, y1 - w / 2, w * 0.3)}
          {L(-w * 0.3, y1 - w, -w * 0.3, y0)}
          {L(w * 0.3, y1 - w, w * 0.3, y0)}
          {L(-w * 0.3, y0, w * 0.3, y0, { ...det, strokeWidth: px(1.6) })}
        </>
      );
      break;
    default:
      el = (
        <>
          {R(x0, y0, w, d, body)}
          {L(x0, y0, x1, y1)}
        </>
      );
  }
  return (
    <g transform={`translate(${f.x},${f.y}) rotate(${f.rot || 0})`} opacity={ghost ? 0.75 : f.hidden ? 0.4 : 1} style={ghost ? { pointerEvents: 'none' } : undefined}>
      <title>{f.label || t.name}</title>
      {el}
    </g>
  );
}

// all pieces of a floor; rugs first so everything else lies on top
export function PlanFurniture({ list, sel, px }) {
  const sorted = [...(list || [])].sort((a, b) => (furnType(a.type).kind === 'rug' ? 0 : 1) - (furnType(b.type).kind === 'rug' ? 0 : 1));
  return (
    <g className="svg-furniture">
      {sorted.map((f) => (
        <FurnitureSymbol key={f.id} f={f} px={px} sel={sel?.kind === 'furn' && sel.id === f.id} />
      ))}
    </g>
  );
}

// handle positions in plan coordinates (also used for hit testing)
export function furnHandles(f, s) {
  const { w, d } = furnSize(f);
  return { rot: furnToPlan(f, 0, d / 2 + 28 / s), size: furnToPlan(f, w / 2, d / 2), front: furnToPlan(f, 0, d / 2) };
}

export function FurnitureHandles({ f, px, s }) {
  const { w, d } = furnSize(f);
  const h = furnHandles(f, s);
  const rot = normRot(f.rot || 0);
  const flip = rot > 90 && rot <= 270;
  const fs = Math.min(px(11.5), Math.max(0.08, Math.min(w, d) / 4));
  return (
    <g>
      <g transform={`translate(${f.x},${f.y}) rotate(${(f.rot || 0) + (flip ? 180 : 0)})`} style={{ pointerEvents: 'none' }}>
        <text x={0} y={fs * 0.35} textAnchor="middle" fontSize={fs} className="svg-furn-size">
          {cm(w)} × {cm(d)}
        </text>
      </g>
      <line x1={h.front[0]} y1={h.front[1]} x2={h.rot[0]} y2={h.rot[1]} stroke="var(--accent)" strokeWidth={px(1.2)} />
      <circle cx={h.rot[0]} cy={h.rot[1]} r={px(7)} className="svg-handle" strokeWidth={px(2)} />
      <path d={`M${h.rot[0] - px(3)},${h.rot[1] - px(1)} a${px(3)},${px(3)} 0 1 1 ${px(1)},${px(3)}`} fill="none" stroke="var(--accent)" strokeWidth={px(1.2)} />
      <rect x={h.size[0] - px(5.5)} y={h.size[1] - px(5.5)} width={px(11)} height={px(11)} rx={px(2)} className="svg-handle" strokeWidth={px(2)} transform={`rotate(${f.rot || 0} ${h.size[0]} ${h.size[1]})`} />
    </g>
  );
}

// ---------- catalog ----------
export function FurniturePreview({ type, size = 56, color }) {
  const t = furnType(type);
  const pad = Math.max(t.w, t.d) * 0.08;
  const vw = t.w + 2 * pad,
    vh = t.d + 2 * pad;
  const k = Math.min(size / vw, (size * 0.72) / vh);
  return (
    <svg width={size} height={Math.round(size * 0.72)} viewBox={`${-vw / 2} ${-vh / 2} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" className="furn-preview">
      <FurnitureSymbol f={{ type, x: 0, y: 0, w: t.w, d: t.d, rot: 0, color }} px={(n) => (n * 1.05) / k} />
    </svg>
  );
}

export function FurnitureCatalog({ value, onPick }) {
  const [cat, setCat] = useState(furnType(value).cat);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? FURNITURE.filter((f) => `${f.name} ${FURN_CATS.find((c) => c.key === f.cat)?.name}`.toLowerCase().includes(s)) : FURNITURE.filter((f) => f.cat === cat);
  }, [cat, q]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Suchen in ${FURNITURE.length} Möbeln …`} aria-label="Möbel suchen" />
      {!q.trim() ? (
        <div className="chips furn-cats" role="tablist" aria-label="Kategorie">
          {FURN_CATS.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={cat === c.key} className={`chip ${cat === c.key ? 'is-on' : ''}`} onClick={() => setCat(c.key)}>
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="furn-grid" role="radiogroup" aria-label="Möbelstück">
        {list.map((f) => (
          <button key={f.key} type="button" role="radio" aria-checked={value === f.key} className={`furn-btn ${value === f.key ? 'is-on' : ''}`} onClick={() => onPick(f.key)} title={f.name}>
            <FurniturePreview type={f.key} />
            <span className="furn-name">{f.name}</span>
            <span className="furn-dim">
              {cm(f.w)} × {cm(f.d)}
            </span>
          </button>
        ))}
        {!list.length ? <p className="small muted">Nichts gefunden.</p> : null}
      </div>
    </div>
  );
}

// ---------- properties ----------
function SizeFields({ f, set, compact }) {
  const t = furnType(f.type);
  const { w, d, h } = furnSize(f);
  // the piece grows from its back left corner, so it stays against the wall it stands at
  const resize = (patch) => {
    const nw = patch.w ?? w,
      nd = patch.d ?? d;
    const anchor = furnToPlan(f, -w / 2, -d / 2);
    const g = { ...f, w: nw, d: nd, x: 0, y: 0 };
    const off = furnToPlan(g, nw / 2, nd / 2);
    set({ ...patch, x: r3(anchor[0] + off[0]), y: r3(anchor[1] + off[1]) });
  };
  return (
    <div className="grid3 furn-size">
      <Field label="Breite">
        <NumInput id={compact ? undefined : 'furn-w-' + f.id} value={cm(w)} onChange={(v) => v >= 1 && resize({ w: v / 100 })} unit="cm" digits={0} />
      </Field>
      <Field label="Tiefe">
        <NumInput value={cm(d)} onChange={(v) => v >= 1 && resize({ d: v / 100 })} unit="cm" digits={0} />
      </Field>
      <Field label="Höhe">
        <NumInput value={cm(h)} onChange={(v) => v >= 1 && set({ h: v / 100 })} unit="cm" digits={0} />
      </Field>
    </div>
  );
}

function RotateButtons({ f, set }) {
  const rot = normRot(f.rot || 0);
  return (
    <div className="furn-rot">
      <button type="button" className="icon-btn" title="90° nach links drehen" aria-label="90° nach links drehen" onClick={() => set({ rot: normRot(rot - 90) })}>
        <Icon name="rotL" size={17} />
      </button>
      <button type="button" className="chip" onClick={() => set({ rot: normRot(rot - 15) })}>
        −15°
      </button>
      <span className="furn-rot-val">
        <NumInput value={rot} onChange={(v) => v != null && set({ rot: normRot(v) })} unit="°" digits={0} aria-label="Drehung in Grad" />
      </span>
      <button type="button" className="chip" onClick={() => set({ rot: normRot(rot + 15) })}>
        +15°
      </button>
      <button type="button" className="icon-btn" title="90° nach rechts drehen" aria-label="90° nach rechts drehen" onClick={() => set({ rot: normRot(rot + 90) })}>
        <Icon name="rotR" size={17} />
      </button>
    </div>
  );
}

export function duplicateFurniture(f, list) {
  const { w } = furnSize(f);
  const p = furnToPlan(f, w, 0);
  const copy = { ...f, id: uid('fu'), x: r3(p[0]), y: r3(p[1]) };
  return [...list, copy];
}

export function alignFurnitureToWall(f, walls) {
  const { d } = furnSize(f);
  const al = wallAlign([f.x, f.y], walls, d, 3);
  if (!al) return null;
  const { x, y } = snapToWalls({ ...f, ...al }, walls);
  return { ...al, x, y };
}

export function FurnitureToolProps({ type, setType, selected, mutate, onDelete, onDetails }) {
  const set = (patch) => mutate((fl) => ({ ...fl, furniture: (fl.furniture || []).map((x) => (x.id === selected.id ? { ...x, ...patch } : x)) }), { refresh: false });
  const st = selected ? furnType(selected.type) : null;
  return (
    <div className="stack">
      {selected ? (
        <div className="panel fixture-last">
          <div className="spread">
            <span className="hstack" style={{ gap: 6 }}>
              <Icon name="sofa" size={16} />
              <b className="small">{selected.label || st.name}</b>
            </span>
            <ConfirmBtn onConfirm={onDelete}>{''}</ConfirmBtn>
          </div>
          <SizeFields f={selected} set={set} compact />
          <RotateButtons f={selected} set={set} />
          <button className="link small" onClick={onDetails}>
            Farbe, Bezeichnung & mehr →
          </button>
        </div>
      ) : null}
      <h4>{selected ? 'Nächstes Möbelstück' : 'Möbelstück wählen'}</h4>
      <FurnitureCatalog value={type} onPick={setType} />
      <p className="small muted">
        Wähle ein Möbelstück und klicke in den Grundriss. {standsAtWall(type) ? 'Es stellt sich mit der Rückseite an die nächste Wand.' : 'Es wird frei an die Stelle gesetzt.'} Ziehen verschiebt, der runde Griff dreht, das Eckquadrat ändert die Größe. Taste R dreht um 90°.
      </p>
    </div>
  );
}

export function FurnitureProps({ f, floor, mutate, onDelete, onSelect }) {
  const t = furnType(f.type);
  const set = (patch) => mutate((fl) => ({ ...fl, furniture: (fl.furniture || []).map((x) => (x.id === f.id ? { ...x, ...patch } : x)) }), { refresh: false });
  const room = roomOfPoint(floor, { x: f.x, y: f.y });
  const walls = floor.walls || [];
  const color = furnColor(f);
  const typeOptions = FURN_CATS.flatMap((c) => FURNITURE.filter((x) => x.cat === c.key).map((x) => ({ value: x.key, label: `${c.name} · ${x.name}` })));
  return (
    <div className="stack">
      <div className="spread">
        <h4 className="hstack" style={{ gap: 8 }}>
          <FurniturePreview type={f.type} size={40} color={f.color} />
          {f.label || t.name}
        </h4>
        <ConfirmBtn onConfirm={onDelete}>{''}</ConfirmBtn>
      </div>
      <Field label="Art">
        <Select
          value={f.type}
          onChange={(k) => {
            const n = furnType(k);
            set({ type: k, w: n.w, d: n.d, h: n.h, elev: n.elev ?? null, color: null });
          }}
          options={typeOptions}
        />
      </Field>
      <Field label="Bezeichnung">
        <TextInput id={'furn-label-' + f.id} value={f.label || ''} onChange={(v) => set({ label: v })} placeholder={`z. B. ${t.cat === 'kueche' ? 'Spülmaschine Bosch' : t.cat === 'schlafen' ? 'Bett Gästezimmer' : 'Erbstück, neu kaufen …'}`} />
      </Field>
      <SizeFields f={f} set={set} />
      <div className="spread small muted" style={{ marginTop: -4 }}>
        <span>Standard: {cm(t.w)} × {cm(t.d)} × {cm(t.h)} cm</span>
        {furnSize(f).w !== t.w || furnSize(f).d !== t.d || furnSize(f).h !== t.h ? (
          <button className="link small" onClick={() => set({ w: t.w, d: t.d, h: t.h })}>
            zurücksetzen
          </button>
        ) : null}
      </div>
      {t.elev != null || f.elev ? (
        <Field label="Höhe über dem Boden" hint="Unterkante, z. B. Hängeschrank 145 cm">
          <NumInput value={cm(f.elev ?? t.elev ?? 0)} onChange={(v) => v != null && v >= 0 && set({ elev: v / 100 })} unit="cm" digits={0} />
        </Field>
      ) : null}
      <Field label="Drehung">
        <RotateButtons f={f} set={set} />
      </Field>
      <div className="hstack wrap" style={{ gap: 6 }}>
        <Btn
          small
          kind="ghost"
          icon="magic"
          onClick={() => {
            const al = alignFurnitureToWall(f, walls);
            if (al) set(al);
          }}
          disabled={!walls.length}
        >
          An Wand ausrichten
        </Btn>
        <Btn
          small
          kind="ghost"
          icon="copy"
          onClick={() => {
            let id = null;
            mutate((fl) => {
              const list = duplicateFurniture(f, fl.furniture || []);
              id = list[list.length - 1].id;
              return { ...fl, furniture: list };
            }, { refresh: false });
            if (id) onSelect?.(id);
          }}
        >
          Daneben duplizieren
        </Btn>
      </div>
      <Field label="Farbe">
        <div className="swatches" role="radiogroup" aria-label="Farbe">
          {FURN_SWATCHES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} className={`swatch ${color === c ? 'is-on' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} />
          ))}
          <label className="swatch swatch-custom" title="Eigene Farbe">
            <input type="color" value={color.slice(0, 7)} onChange={(e) => set({ color: e.target.value })} aria-label="Eigene Farbe" />
          </label>
          {f.color ? (
            <button type="button" className="link small" onClick={() => set({ color: null })}>
              Standard
            </button>
          ) : null}
        </div>
      </Field>
      <Field label="Zustand">
        <Seg small value={f.status || 'bestand'} onChange={(v) => set({ status: v })} options={[{ value: 'bestand', label: 'Vorhanden' }, { value: 'geplant', label: 'Geplant / neu' }]} />
      </Field>
      <div className="kv">
        <span>Raum</span>
        <b>{room ? room.name : '–'}</b>
      </div>
      <Field label="Notizen">
        <TextInput multiline rows={2} value={f.notes || ''} onChange={(v) => set({ notes: v })} placeholder="Preis, Händler, Lieferzeit, Maße vor Ort prüfen …" />
      </Field>
    </div>
  );
}

// short list on the floor panel: which pieces stand where
export function FurnitureSummary({ list, floor, onSelect }) {
  if (!list?.length) return null;
  const byRoom = new Map();
  for (const f of list) {
    const r = roomOfPoint(floor, { x: f.x, y: f.y });
    const k = r?.name || 'Ohne Raum';
    if (!byRoom.has(k)) byRoom.set(k, []);
    byRoom.get(k).push(f);
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <h4>Möbel ({list.length})</h4>
      {[...byRoom].map(([room, items]) => (
        <div key={room} className="furn-sum">
          <span className="field-label">{room}</span>
          <div className="chips">
            {items.map((f) => (
              <button key={f.id} type="button" className="chip" onClick={() => onSelect(f.id)}>
                {f.label || furnType(f.type).name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
