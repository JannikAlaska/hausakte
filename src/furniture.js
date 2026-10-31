// Furniture catalog and simple 3D shapes. Sizes in metres: w = width, d = depth (back at -d/2), h = height;
// elev lifts wall-mounted pieces (wall cabinets, mirror cabinets, TV) off the floor.

export const FURN_CATS = [
  { key: 'wohnen', name: 'Wohnen' },
  { key: 'schlafen', name: 'Schlafen' },
  { key: 'essen', name: 'Essen' },
  { key: 'kueche', name: 'Küche' },
  { key: 'bad', name: 'Bad & Wäsche' },
  { key: 'arbeiten', name: 'Arbeiten' },
  { key: 'flur', name: 'Flur & Stauraum' },
  { key: 'heizung', name: 'Heizung' },
  { key: 'technik', name: 'Technik & Garage' },
  { key: 'garten', name: 'Garten' },
];

export const FURN_COLORS = {
  oak: '#d2ad7c', wood: '#b98a5e', walnut: '#7a5638', white: '#f1f0ec', cream: '#e8e0d0', grey: '#9aa1aa', fabric: '#7d8b9a',
  fabricWarm: '#a68f7a', dark: '#3b4048', black: '#24272c', green: '#5e9b6a', ceramic: '#fbfbfa', steel: '#b9bdc3', red: '#b6463e', blue: '#4a6fa5',
};
export const FURN_SWATCHES = ['#d2ad7c', '#b98a5e', '#7a5638', '#f1f0ec', '#e8e0d0', '#9aa1aa', '#7d8b9a', '#a68f7a', '#3b4048', '#5e9b6a', '#b6463e', '#4a6fa5'];

const F = (key, name, cat, w, d, h, kind, color, extra = {}) => ({ key, name, cat, w, d, h, kind, color, ...extra });
export const FURNITURE = [
  // living
  F('sofa2', 'Sofa 2-Sitzer', 'wohnen', 1.6, 0.9, 0.85, 'sofa', 'fabric'),
  F('sofa3', 'Sofa 3-Sitzer', 'wohnen', 2.1, 0.95, 0.85, 'sofa', 'fabric'),
  F('sofaL', 'Ecksofa', 'wohnen', 2.6, 1.7, 0.85, 'cornerSofa', 'fabric'),
  F('armchair', 'Sessel', 'wohnen', 0.85, 0.85, 0.9, 'armchair', 'fabricWarm'),
  F('coffeetable', 'Couchtisch', 'wohnen', 1.1, 0.6, 0.45, 'table', 'oak'),
  F('tvboard', 'TV-Board', 'wohnen', 1.8, 0.45, 0.5, 'cabinet', 'white'),
  F('tv', 'Fernseher', 'wohnen', 1.3, 0.08, 0.75, 'tv', 'black', { elev: 0.55 }),
  F('bookshelf', 'Bücherregal', 'wohnen', 0.8, 0.35, 2.0, 'shelf', 'oak'),
  F('sideboard', 'Sideboard', 'wohnen', 1.6, 0.45, 0.8, 'cabinet', 'walnut'),
  F('floorlamp', 'Stehlampe', 'wohnen', 0.4, 0.4, 1.6, 'floorLamp', 'dark'),
  F('plant', 'Zimmerpflanze', 'wohnen', 0.45, 0.45, 1.2, 'plant', 'green'),
  F('rug', 'Teppich', 'wohnen', 2.0, 1.4, 0.01, 'rug', 'fabricWarm'),
  F('stove', 'Kaminofen', 'wohnen', 0.6, 0.5, 1.1, 'fireplace', 'black'),
  F('piano', 'Klavier', 'wohnen', 1.5, 0.6, 1.25, 'piano', 'black'),
  // sleeping
  F('bed180', 'Doppelbett 180', 'schlafen', 1.8, 2.1, 0.9, 'bed', 'oak'),
  F('bed140', 'Bett 140', 'schlafen', 1.4, 2.1, 0.9, 'bed', 'oak'),
  F('bed90', 'Einzelbett 90', 'schlafen', 0.9, 2.05, 0.85, 'bed', 'white'),
  F('cot', 'Kinderbett', 'schlafen', 0.76, 1.46, 0.9, 'cot', 'white'),
  F('wardrobe2', 'Kleiderschrank 2-türig', 'schlafen', 1.0, 0.6, 2.0, 'wardrobe', 'white'),
  F('wardrobe3', 'Kleiderschrank 3-türig', 'schlafen', 1.5, 0.6, 2.2, 'wardrobe', 'white'),
  F('dresser', 'Kommode', 'schlafen', 1.0, 0.45, 0.85, 'drawers', 'oak'),
  F('nightstand', 'Nachttisch', 'schlafen', 0.45, 0.4, 0.55, 'drawers', 'oak'),
  // dining
  F('table4', 'Esstisch 4 Personen', 'essen', 1.4, 0.85, 0.75, 'table', 'oak'),
  F('table6', 'Esstisch 6 Personen', 'essen', 1.9, 0.95, 0.75, 'table', 'oak'),
  F('roundtable', 'Runder Tisch', 'essen', 1.1, 1.1, 0.75, 'roundTable', 'oak'),
  F('chair', 'Stuhl', 'essen', 0.45, 0.52, 0.9, 'chair', 'wood'),
  F('bench', 'Sitzbank', 'essen', 1.4, 0.4, 0.45, 'bench', 'oak'),
  F('highchair', 'Hochstuhl', 'essen', 0.5, 0.6, 1.0, 'chair', 'white'),
  // kitchen
  F('basecab', 'Unterschrank', 'kueche', 0.6, 0.6, 0.9, 'baseCab', 'white'),
  F('sinkcab', 'Spüle', 'kueche', 0.8, 0.6, 0.9, 'sinkCab', 'white'),
  F('hob', 'Herd mit Kochfeld', 'kueche', 0.6, 0.6, 0.9, 'hob', 'white'),
  F('dishwasher', 'Geschirrspüler', 'kueche', 0.6, 0.6, 0.9, 'baseCab', 'white'),
  F('fridge', 'Kühlschrank', 'kueche', 0.6, 0.65, 1.85, 'fridge', 'white'),
  F('fridgeAm', 'Kühl-Gefrier-Kombi breit', 'kueche', 0.9, 0.7, 1.8, 'fridge', 'steel'),
  F('tallcab', 'Hochschrank / Backofen', 'kueche', 0.6, 0.6, 2.1, 'tallCab', 'white'),
  F('wallcab', 'Hängeschrank', 'kueche', 0.6, 0.35, 0.7, 'wallCab', 'white', { elev: 1.45 }),
  F('island', 'Kücheninsel', 'kueche', 1.2, 0.9, 0.92, 'baseCab', 'white'),
  F('hood', 'Dunstabzugshaube', 'kueche', 0.6, 0.5, 0.6, 'hood', 'steel', { elev: 1.55 }),
  // bath & laundry
  F('bathtub', 'Badewanne', 'bad', 1.7, 0.75, 0.58, 'bathtub', 'ceramic'),
  F('shower', 'Dusche 90×90', 'bad', 0.9, 0.9, 2.0, 'shower', 'ceramic'),
  F('shower120', 'Dusche 120×90', 'bad', 1.2, 0.9, 2.0, 'shower', 'ceramic'),
  F('wc', 'WC', 'bad', 0.38, 0.62, 0.8, 'toilet', 'ceramic'),
  F('washbasin', 'Waschtisch', 'bad', 0.8, 0.48, 0.85, 'washbasin', 'ceramic'),
  F('washbasin2', 'Doppelwaschtisch', 'bad', 1.4, 0.5, 0.85, 'washbasin', 'ceramic', { basins: 2 }),
  F('mirrorcab', 'Spiegelschrank', 'bad', 0.8, 0.15, 0.7, 'wallCab', 'white', { elev: 1.2 }),
  F('washer', 'Waschmaschine', 'bad', 0.6, 0.6, 0.85, 'washer', 'white'),
  F('dryer', 'Trockner', 'bad', 0.6, 0.6, 0.85, 'washer', 'white'),
  // work
  F('desk', 'Schreibtisch', 'arbeiten', 1.4, 0.7, 0.75, 'table', 'white'),
  F('officechair', 'Bürostuhl', 'arbeiten', 0.62, 0.62, 1.1, 'officeChair', 'black'),
  F('shelf', 'Regal', 'arbeiten', 0.8, 0.35, 1.8, 'shelf', 'white'),
  F('filing', 'Aktenschrank', 'arbeiten', 0.8, 0.4, 1.1, 'cabinet', 'grey'),
  // hall & storage
  F('coatrack', 'Garderobe', 'flur', 1.0, 0.35, 1.9, 'coatRack', 'oak'),
  F('shoecab', 'Schuhschrank', 'flur', 0.8, 0.3, 1.0, 'cabinet', 'white'),
  F('storageshelf', 'Schwerlastregal', 'flur', 1.2, 0.5, 2.0, 'shelf', 'steel'),
  // heating (rtype = panel radiator type: panels + convector layers, e.g. 22)
  F('rad22', 'Heizkörper Typ 22', 'heizung', 1.0, 0.1, 0.6, 'radiator', 'white', { elev: 0.15, rtype: '22' }),
  F('rad11', 'Heizkörper Typ 11 (flach)', 'heizung', 0.8, 0.065, 0.6, 'radiator', 'white', { elev: 0.15, rtype: '11' }),
  F('rad33', 'Heizkörper Typ 33 (groß)', 'heizung', 1.4, 0.155, 0.6, 'radiator', 'white', { elev: 0.15, rtype: '33' }),
  F('radlow', 'Niedriger Heizkörper', 'heizung', 1.2, 0.1, 0.3, 'radiator', 'white', { elev: 0.12, rtype: '22' }),
  F('radhigh', 'Hoher Heizkörper', 'heizung', 0.8, 0.1, 0.9, 'radiator', 'white', { elev: 0.12, rtype: '22' }),
  F('radvert', 'Vertikaler Heizkörper', 'heizung', 0.5, 0.1, 1.8, 'radiator', 'white', { elev: 0.1, rtype: '21' }),
  F('radcast', 'Gliederheizkörper (Rippen)', 'heizung', 0.9, 0.16, 0.6, 'columnRad', 'cream', { elev: 0.12 }),
  F('towelrad', 'Badheizkörper (Handtuch)', 'heizung', 0.5, 0.1, 1.2, 'towelRad', 'white', { elev: 0.2 }),
  F('boiler', 'Heizkessel', 'heizung', 0.6, 0.6, 1.5, 'boiler', 'white'),
  F('heatpump', 'Wärmepumpe (Außengerät)', 'heizung', 1.1, 0.5, 1.0, 'heatpump', 'grey'),
  F('tank', 'Öltank', 'heizung', 1.6, 0.75, 1.6, 'cabinet', 'grey'),
  // technical & garage
  F('workbench', 'Werkbank', 'technik', 1.5, 0.7, 0.9, 'table', 'wood'),
  F('car', 'Auto', 'technik', 1.8, 4.5, 1.5, 'car', 'blue'),
  F('bike', 'Fahrrad', 'technik', 0.6, 1.8, 1.0, 'bike', 'dark'),
  F('bin', 'Mülltonne', 'technik', 0.6, 0.75, 1.05, 'bin', 'grey'),
  // garden
  F('gardentable', 'Gartentisch', 'garten', 1.6, 0.9, 0.75, 'table', 'wood'),
  F('lounger', 'Sonnenliege', 'garten', 0.7, 1.95, 0.4, 'lounger', 'white'),
  F('grill', 'Grill', 'garten', 1.2, 0.6, 1.1, 'cabinet', 'black'),
  F('mower', 'Rasenmäher', 'garten', 0.55, 1.4, 1.0, 'mower', 'red'),
];
export const furnType = (k) => FURNITURE.find((f) => f.key === k) || FURNITURE[0];
export const RAD_TYPES = [
  { key: '10', d: 0.047 }, { key: '11', d: 0.065 }, { key: '20', d: 0.072 }, { key: '21', d: 0.08 }, { key: '22', d: 0.1 }, { key: '33', d: 0.155 },
];
export const radType = (f) => String(f.rtype || furnType(f.type).rtype || '22');
// catalog name; panel radiators show their current type ("Heizkörper Typ 33")
export function furnName(f) {
  const t = furnType(f.type);
  if (t.kind !== 'radiator') return t.name;
  const rt = radType(f);
  return /Typ \d\d/.test(t.name) ? t.name.replace(/Typ \d\d/, `Typ ${rt}`) : `${t.name} (Typ ${rt})`;
}
export const isRadiator = (f) => ['radiator', 'columnRad', 'towelRad'].includes(furnType(f.type).kind);
// rough heat output in watts after EN 442 tables (75/65/20 °C) and at lower flow temperatures (exponent 1.3)
const W_PER_M = { 10: 650, 11: 1000, 20: 1100, 21: 1400, 22: 1800, 33: 2600 }; // at 600 mm height
export function radiatorOutput(f) {
  const t = furnType(f.type);
  const w = f.w ?? t.w,
    d = f.d ?? t.d,
    h = f.h ?? t.h;
  let nominal;
  if (t.kind === 'radiator') nominal = (W_PER_M[radType(f)] || 1800) * w * Math.pow(h / 0.6, 0.83);
  else if (t.kind === 'columnRad') nominal = 1600 * w * Math.pow(d / 0.16, 0.9) * Math.pow(h / 0.6, 0.85);
  else if (t.kind === 'towelRad') nominal = 650 * w * h;
  else return null;
  const lmtd = (vl, rl) => (vl - rl) / Math.log((vl - 20) / (rl - 20));
  const at = (vl, rl) => nominal * Math.pow(lmtd(vl, rl) / lmtd(75, 65), 1.3);
  const round = (v) => Math.round(v / 10) * 10;
  return { nominal: round(nominal), at55: round(at(55, 45)), at45: round(at(45, 35)) };
}
export const furnColor = (f) => f.color || FURN_COLORS[furnType(f.type).color] || '#b98a5e';

// ---------- 3D shapes ----------
// Parts in local coordinates (x along the width, y up from the floor, z along the depth, back at -d/2):
// { shape: 'box', size: [sx, sy, sz], at: [x, y, z] } with at = centre, or 'cyl' (size [r, h]) or 'sphere' (size [r]); color optional.
export function furnitureParts(f) {
  const t = furnType(f.type);
  const w = f.w ?? t.w,
    d = f.d ?? t.d,
    h = f.h ?? t.h;
  const c = furnColor(f);
  const P = [];
  const box = (sx, sy, sz, x, y0, z, color = c, extra) => P.push({ shape: 'box', size: [Math.max(0.005, sx), Math.max(0.005, sy), Math.max(0.005, sz)], at: [x, y0 + sy / 2, z], color, ...extra });
  const cyl = (r, ch, x, y0, z, color = c, extra) => P.push({ shape: 'cyl', size: [r, ch], at: [x, y0 + ch / 2, z], color, ...extra });
  const sphere = (r, x, y, z, color = c) => P.push({ shape: 'sphere', size: [r], at: [x, y, z], color });
  const legs = (lh, inset = 0.04, r = 0.025, color = '#4a4038') => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) cyl(r, lh, sx * (w / 2 - inset - r), 0, sz * (d / 2 - inset - r), color);
  };
  const front = d / 2;
  // supply and return pipes from the floor, thermostat valve at the top side
  const radiatorPipes = (rw, rd, elev, rh) => {
    for (const x of [rw / 2 - 0.05, -rw / 2 + 0.05]) if (elev > 0.02) cyl(0.008, elev + 0.03, x, -elev, -rd / 2 + 0.025, '#c6cbd1');
    P.push({ shape: 'cyl', size: [0.024, 0.07], at: [rw / 2 + 0.035, rh - 0.08, 0], color: '#f4f4f2', rotZ: true });
  };
  switch (t.kind) {
    case 'sofa':
    case 'armchair': {
      const arm = Math.min(0.2, w * 0.14),
        back = Math.min(0.25, d * 0.25),
        seat = h * 0.5;
      box(w, 0.12, d, 0, 0, 0, '#3b3530');
      box(w - 2 * arm, seat - 0.12, d - back, 0, 0.12, back / 2);
      box(w, h - 0.12, back, 0, 0.12, -d / 2 + back / 2);
      for (const s of [-1, 1]) box(arm, h * 0.72 - 0.12, d, s * (w / 2 - arm / 2), 0.12, 0);
      break;
    }
    case 'cornerSofa': {
      const sd = Math.min(0.95, d * 0.55),
        back = 0.22,
        seat = h * 0.5;
      box(w, seat, sd, 0, 0, -d / 2 + sd / 2);
      box(sd, seat, d - sd, w / 2 - sd / 2, 0, sd / 2);
      box(w, h, back, 0, 0, -d / 2 + back / 2);
      box(back, h, d, w / 2 - back / 2, 0, 0);
      box(0.18, h * 0.72, sd, -w / 2 + 0.09, 0, -d / 2 + sd / 2);
      break;
    }
    case 'table':
      box(w, 0.04, d, 0, h - 0.04, 0);
      legs(h - 0.04);
      break;
    case 'roundTable':
      P.push({ shape: 'cyl', size: [w / 2, 0.04], at: [0, h - 0.02, 0], color: c, scaleZ: d / w });
      cyl(0.05, h - 0.04, 0, 0, 0, '#4a4038');
      cyl(Math.min(0.3, w / 4), 0.03, 0, 0, 0, '#4a4038');
      break;
    case 'chair':
      box(w, 0.04, d * 0.85, 0, h * 0.5 - 0.04, d * 0.075);
      legs(h * 0.5 - 0.04, 0.02, 0.018);
      box(w, h * 0.5, 0.04, 0, h * 0.5, -d / 2 + 0.03);
      break;
    case 'officeChair':
      cyl(0.3, 0.04, 0, 0, 0, '#2b2f35');
      cyl(0.03, 0.42, 0, 0.04, 0, '#2b2f35');
      box(w * 0.8, 0.08, d * 0.8, 0, 0.46, 0.03);
      box(w * 0.75, h - 0.6, 0.06, 0, 0.6, -d / 2 + 0.06);
      break;
    case 'bench':
      box(w, 0.05, d, 0, h - 0.05, 0);
      legs(h - 0.05, 0.05, 0.03);
      break;
    case 'bed':
    case 'cot':
    case 'lounger': {
      const base = h * (t.kind === 'lounger' ? 0.55 : 0.4);
      box(w, base, d, 0, 0, 0);
      box(w - 0.06, t.kind === 'lounger' ? 0.06 : 0.2, d - 0.08, 0, base, 0.02, t.kind === 'lounger' ? '#e8e6e0' : '#f4f4f2');
      if (t.kind !== 'lounger') {
        box(w, h, 0.06, 0, 0, -d / 2 + 0.03);
        const n = w >= 1.3 ? 2 : 1;
        for (let i = 0; i < n; i++) box(w / n - 0.12, 0.1, 0.4, -w / 2 + (w / n) * (i + 0.5), base + 0.2, -d / 2 + 0.3, '#ffffff');
        box(w - 0.04, 0.05, d * 0.55, 0, base + 0.2, d * 0.2, '#c9d3dc');
      }
      if (t.kind === 'cot') for (const s of [-1, 1]) box(0.03, h - base, d, s * (w / 2 - 0.015), base, 0);
      break;
    }
    case 'wardrobe':
    case 'cabinet':
    case 'drawers':
    case 'tallCab':
    case 'baseCab':
    case 'wallCab': {
      const kitchen = t.kind === 'baseCab' || t.kind === 'tallCab';
      const plinth = t.kind === 'wallCab' ? 0 : kitchen ? 0.1 : 0.04;
      const top = t.kind === 'baseCab' ? 0.04 : 0;
      if (plinth) box(w - 0.04, plinth, d - 0.06, 0, 0, -0.03, '#3b3f45');
      box(w, h - plinth - top, d, 0, plinth, 0);
      if (top) box(w + 0.02, top, d + 0.02, 0, h - top, 0.01, '#5d5650');
      const doors = t.kind === 'drawers' ? 0 : Math.max(1, Math.round(w / 0.5));
      for (let i = 1; i < doors; i++) box(0.006, h - plinth - top - 0.02, 0.006, -w / 2 + (w / doors) * i, plinth + 0.01, front + 0.002, '#00000033');
      if (t.kind === 'drawers') for (let i = 1; i < 4; i++) box(w - 0.02, 0.006, 0.006, 0, plinth + ((h - plinth) / 4) * i, front + 0.002, '#00000033');
      break;
    }
    case 'shelf': {
      for (const s of [-1, 1]) box(0.02, h, d, s * (w / 2 - 0.01), 0, 0);
      box(w, h, 0.01, 0, 0, -d / 2 + 0.005);
      const n = Math.max(2, Math.round(h / 0.38));
      for (let i = 0; i <= n; i++) box(w - 0.04, 0.02, d, 0, Math.min(h - 0.02, (h / n) * i), 0);
      break;
    }
    case 'sinkCab':
      box(w - 0.04, 0.1, d - 0.06, 0, 0, -0.03, '#3b3f45');
      box(w, h - 0.14, d, 0, 0.1, 0);
      box(w + 0.02, 0.04, d + 0.02, 0, h - 0.04, 0.01, '#5d5650');
      box(w * 0.6, 0.012, d * 0.55, 0, h, 0.02, '#c6cbd1');
      cyl(0.015, 0.25, 0, h, -d / 2 + 0.08, '#c6cbd1');
      break;
    case 'hob':
      box(w - 0.04, 0.1, d - 0.06, 0, 0, -0.03, '#3b3f45');
      box(w, h - 0.14, d, 0, 0.1, 0);
      box(w, 0.04, d, 0, h - 0.04, 0, '#1f2226');
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) cyl(Math.min(w, d) * 0.12, 0.005, x * w * 0.22, h, z * d * 0.22, '#3a3f45');
      box(w * 0.9, 0.006, 0.006, 0, h * 0.6, front + 0.002, '#00000044');
      break;
    case 'fridge':
      box(w, h, d, 0, 0, 0);
      box(w, 0.006, 0.006, 0, h * 0.62, front + 0.002, '#00000044');
      box(0.02, h * 0.25, 0.03, w / 2 - 0.06, h * 0.68, front + 0.015, '#b9bdc3');
      break;
    case 'hood':
      box(w, 0.08, d, 0, 0, 0);
      box(w * 0.4, h - 0.08, d * 0.45, 0, 0.08, -d / 2 + d * 0.225);
      break;
    case 'bathtub':
      box(w, h, d, 0, 0, 0);
      box(w - 0.12, 0.012, d - 0.12, 0, h, 0, '#c9d6e0');
      break;
    case 'shower':
      box(w, 0.06, d, 0, 0, 0);
      box(0.12, 0.004, 0.12, 0, 0.06, 0, '#8a9097');
      box(w, h - 0.06, 0.008, 0, 0.06, front - 0.004, '#bfe3f2', { glass: true });
      box(0.008, h - 0.06, d, w / 2 - 0.004, 0.06, 0, '#bfe3f2', { glass: true });
      cyl(0.012, h - 0.2, -w / 2 + 0.06, 0.06, -d / 2 + 0.06, '#c6cbd1');
      break;
    case 'toilet':
      box(w, 0.42, d * 0.25, 0, 0.42, -d / 2 + d * 0.125);
      P.push({ shape: 'cyl', size: [w / 2, 0.42], at: [0, 0.21, d * 0.08], color: c, scaleZ: (d * 0.75) / w });
      P.push({ shape: 'cyl', size: [w / 2 + 0.01, 0.03], at: [0, 0.435, d * 0.08], color: '#ffffff', scaleZ: (d * 0.75) / w });
      break;
    case 'washbasin': {
      const n = t.basins || 1;
      box(w, h - 0.15, d - 0.04, 0, 0.3, -0.02, '#e8e2d8');
      box(w, 0.15, d, 0, h - 0.15, 0);
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (w / n) * (i + 0.5);
        P.push({ shape: 'cyl', size: [Math.min(w / n, d) * 0.32, 0.01], at: [x, h + 0.003, 0.02], color: '#c9d6e0' });
        cyl(0.012, 0.18, x, h, -d / 2 + 0.06, '#c6cbd1');
      }
      break;
    }
    case 'radiator': {
      const rt = radType(f);
      const n = Math.max(1, Math.min(3, Number(rt[0]) || 2));
      const pt = 0.02;
      const step = n > 1 ? (d - pt) / (n - 1) : 0;
      for (let i = 0; i < n; i++) box(w, h, pt, 0, 0, front - pt / 2 - i * step);
      // convector fins between the panels show as a darker core, the profile as grooves on the front
      if (n > 1) box(w - 0.02, h - 0.03, Math.max(0.005, d - 2 * pt), 0, 0.015, 0, '#c9cbcf');
      if (n > 1 && Number(rt[1]) > 0) box(w, 0.006, d, 0, h - 0.006, 0, '#e4e4e1');
      const grooves = Math.min(70, Math.floor(w / 0.033));
      for (let i = 1; i < grooves; i++) box(0.004, h * 0.86, 0.003, -w / 2 + (w / grooves) * i, h * 0.07, front + 0.0015, '#00000018');
      radiatorPipes(w, d, f.elev ?? t.elev ?? 0.15, h);
      break;
    }
    case 'columnRad': {
      const n = Math.max(2, Math.min(45, Math.round(w / 0.06)));
      const sw = w / n;
      for (let i = 0; i < n; i++) box(sw * 0.72, h - 0.02, d * 0.92, -w / 2 + sw * (i + 0.5), 0.01, 0);
      for (const y of [0.05, h - 0.05]) P.push({ shape: 'cyl', size: [0.022, w], at: [0, y, 0], color: c, rotZ: true });
      radiatorPipes(w, d, f.elev ?? t.elev ?? 0.12, h);
      break;
    }
    case 'towelRad':
      for (const s of [-1, 1]) box(0.03, h, 0.03, s * (w / 2 - 0.015), 0, 0);
      for (let i = 0; i < 10; i++) box(w, 0.02, 0.02, 0, (h / 10) * i + 0.03, 0);
      break;
    case 'washer':
      box(w, h, d, 0, 0, 0);
      P.push({ shape: 'cyl', size: [Math.min(w, h) * 0.3, 0.02], at: [0, h * 0.48, front + 0.01], color: '#30353b', rotX: true });
      box(w, 0.1, 0.005, 0, h - 0.12, front + 0.003, '#d7d9dc');
      break;
    case 'tv':
      box(w, h, d, 0, 0, 0, '#16181b');
      break;
    case 'floorLamp':
      cyl(0.15, 0.02, 0, 0, 0, '#2b2f35');
      cyl(0.012, h - 0.25, 0, 0.02, 0, '#2b2f35');
      P.push({ shape: 'cyl', size: [Math.min(w, d) / 2, 0.25], at: [0, h - 0.125, 0], color: '#efe6d2', rTop: Math.min(w, d) / 3.2 });
      break;
    case 'plant':
      cyl(Math.min(w, d) * 0.3, Math.min(0.35, h * 0.3), 0, 0, 0, '#a5714c');
      sphere(Math.min(w, d) * 0.5, 0, Math.min(0.35, h * 0.3) + (h - Math.min(0.35, h * 0.3)) * 0.5, 0, c);
      break;
    case 'rug':
      box(w, Math.max(0.01, h), d, 0, 0, 0);
      break;
    case 'fireplace':
      box(w, h * 0.85, d, 0, 0, 0);
      box(w * 0.7, h * 0.4, 0.01, 0, h * 0.25, front + 0.005, '#ff9a3c');
      cyl(0.08, h * 0.15, 0, h * 0.85, -d * 0.1, '#24272c');
      break;
    case 'piano':
      box(w, h, d * 0.55, 0, 0, -d / 2 + d * 0.275);
      box(w, 0.05, d * 0.45, 0, h * 0.58, d * 0.275, '#f4f4f2');
      legs(h * 0.58, 0.04, 0.03, c);
      break;
    case 'coatRack':
      box(w, h, 0.03, 0, 0, -d / 2 + 0.015);
      box(w, 0.03, d, 0, h * 0.85, 0);
      box(w, 0.4, d, 0, 0, 0);
      break;
    case 'boiler':
      box(w, h, d, 0, 0, 0);
      for (const x of [-0.12, 0, 0.12]) cyl(0.02, 0.3, x, h, -d / 4, '#b9bdc3');
      break;
    case 'heatpump':
      box(w, h, d, 0, 0.1, 0);
      P.push({ shape: 'cyl', size: [h * 0.35, 0.02], at: [-w * 0.15, 0.1 + h / 2, front + 0.01], color: '#2b2f35', rotX: true });
      for (const s of [-1, 1]) box(0.05, 0.1, d, s * (w / 2 - 0.1), 0, 0, '#2b2f35');
      break;
    case 'car': {
      const bodyH = h * 0.45;
      box(w, bodyH, d, 0, 0.2, 0);
      box(w * 0.86, h - bodyH - 0.2, d * 0.5, 0, 0.2 + bodyH, -d * 0.05, '#9fb6c8');
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.push({ shape: 'cyl', size: [0.32, 0.22], at: [sx * (w / 2 - 0.1), 0.32, sz * (d / 2 - 0.75)], color: '#1c1f22', rotZ: true });
      break;
    }
    case 'bike':
      for (const s of [-1, 1]) P.push({ shape: 'cyl', size: [0.34, 0.04], at: [0, 0.34, s * (d / 2 - 0.36)], color: '#1c1f22', rotZ: true });
      box(0.04, 0.04, d * 0.6, 0, 0.55, 0);
      box(0.04, 0.45, 0.04, 0, 0.5, -d * 0.12);
      box(w * 0.7, 0.03, 0.03, 0, h - 0.03, d / 2 - 0.4);
      break;
    case 'bin':
      box(w, h - 0.05, d, 0, 0, 0);
      box(w + 0.02, 0.05, d + 0.04, 0, h - 0.05, 0.01, '#3b3f45');
      break;
    case 'mower':
      box(w, 0.3, w, 0, 0.05, d / 2 - w / 2);
      box(0.03, 0.03, d - w, 0, h * 0.7, -w / 2 + 0.05, '#2b2f35');
      break;
    default:
      box(w, h, d, 0, 0, 0);
  }
  return P;
}

// ---------- plan geometry ----------
// Plan frame: rot in degrees, clockwise (y points down). Local x = width, local y = depth, back at y = -d/2.
const r3 = (v) => Math.round(v * 1000) / 1000;
export const furnSize = (f) => {
  const t = furnType(f.type);
  return { w: f.w ?? t.w, d: f.d ?? t.d, h: f.h ?? t.h };
};
const axes = (rot) => {
  const r = ((rot || 0) * Math.PI) / 180;
  return { ux: [Math.cos(r), Math.sin(r)], uy: [-Math.sin(r), Math.cos(r)] };
};
export const furnToPlan = (f, lx, ly) => {
  const { ux, uy } = axes(f.rot);
  return [f.x + ux[0] * lx + uy[0] * ly, f.y + ux[1] * lx + uy[1] * ly];
};
export const planToFurn = (f, p) => {
  const { ux, uy } = axes(f.rot);
  const dx = p[0] - f.x,
    dy = p[1] - f.y;
  return [dx * ux[0] + dy * ux[1], dx * uy[0] + dy * uy[1]];
};
export function furnCorners(f) {
  const { w, d } = furnSize(f);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => furnToPlan(f, x, y));
}
// smallest piece under the point, so a chair on a rug or at a table can still be picked
export function hitFurniture(p, list, tol = 0) {
  let best = null;
  for (const f of list || []) {
    const { w, d } = furnSize(f);
    const [lx, ly] = planToFurn(f, p);
    // tol = minimum half size, so thin pieces like radiators stay easy to hit
    if (Math.abs(lx) <= Math.max(w / 2, tol) && Math.abs(ly) <= Math.max(d / 2, tol) && (!best || w * d < best.a)) best = { f, a: w * d };
  }
  return best?.f || null;
}

const FREE_KINDS = new Set(['table', 'roundTable', 'rug', 'chair', 'officeChair', 'car', 'bike', 'plant', 'floorLamp', 'lounger', 'mower']);
// pieces that usually stand with their back against a wall
export const standsAtWall = (key) => {
  const t = furnType(key);
  if (key === 'island') return false;
  if (key === 'desk' || key === 'workbench') return true;
  return !FREE_KINDS.has(t.kind);
};

function wallInfo(wl) {
  const L = Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1]);
  if (L < 0.05) return null;
  const u = [(wl.b[0] - wl.a[0]) / L, (wl.b[1] - wl.a[1]) / L];
  return { L, u, n: [-u[1], u[0]], t: wl.t || 0.1 };
}

// back against the nearest wall (within maxDist of the wall face): rotation and centre, or null
export function wallAlign(p, walls, depth, maxDist = 0.9) {
  let best = null;
  for (const wl of walls || []) {
    const wi = wallInfo(wl);
    if (!wi) continue;
    const rel = [p[0] - wl.a[0], p[1] - wl.a[1]];
    const along = rel[0] * wi.u[0] + rel[1] * wi.u[1];
    if (along < -0.1 || along > wi.L + 0.1) continue;
    const off = rel[0] * wi.n[0] + rel[1] * wi.n[1];
    const gap = Math.abs(off) - wi.t / 2;
    if (gap > maxDist || (best && gap >= best.gap)) continue;
    const s = off >= 0 ? 1 : -1;
    const k = s * (wi.t / 2 + depth / 2);
    best = { gap, rot: (Math.atan2(-s * wi.n[0], s * wi.n[1]) * 180) / Math.PI, x: wl.a[0] + wi.u[0] * along + wi.n[0] * k, y: wl.a[1] + wi.u[1] * along + wi.n[1] * k };
  }
  if (!best) return null;
  return { rot: (Math.round((((best.rot % 360) + 360) % 360) * 10) / 10) % 360, x: r3(best.x), y: r3(best.y) };
}

// moves a piece flush against walls it almost touches (up to two walls, e.g. into a corner)
export function snapToWalls(f, walls, tol = 0.12) {
  const { w, d } = furnSize(f);
  const { ux, uy } = axes(f.rot);
  let x = f.x,
    y = f.y;
  const cands = [];
  for (const wl of walls || []) {
    const wi = wallInfo(wl);
    if (!wi) continue;
    const { u, n } = wi;
    const eN = (Math.abs(n[0] * ux[0] + n[1] * ux[1]) * w) / 2 + (Math.abs(n[0] * uy[0] + n[1] * uy[1]) * d) / 2;
    const eU = (Math.abs(u[0] * ux[0] + u[1] * ux[1]) * w) / 2 + (Math.abs(u[0] * uy[0] + u[1] * uy[1]) * d) / 2;
    const rel = [x - wl.a[0], y - wl.a[1]];
    const along = rel[0] * u[0] + rel[1] * u[1];
    if (along < -eU + 0.05 || along > wi.L + eU - 0.05) continue;
    const off = rel[0] * n[0] + rel[1] * n[1];
    const gap = Math.abs(off) - wi.t / 2 - eN;
    // close to the wall, or sticking into it while the centre is still on one side
    if (gap > -eN && gap < tol) cands.push({ n, s: off >= 0 ? 1 : -1, gap });
  }
  cands.sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));
  const used = [];
  for (const c of cands) {
    if (used.some((n) => Math.abs(n[0] * c.n[0] + n[1] * c.n[1]) > 0.9)) continue;
    x -= c.s * c.n[0] * c.gap;
    y -= c.s * c.n[1] * c.gap;
    used.push(c.n);
    if (used.length >= 2) break;
  }
  return { x: r3(x), y: r3(y), snapped: used.length };
}

// a new piece at point p: catalog size, back against a nearby wall when it usually stands there
export function placeFurniture(type, p, walls, grid = 0.05) {
  const t = furnType(type);
  const snap = (v) => r3(Math.round(v / grid) * grid);
  const f = { type, x: snap(p[0]), y: snap(p[1]), w: t.w, d: t.d, h: t.h, rot: 0 };
  if (t.elev != null) f.elev = t.elev;
  if (standsAtWall(type)) {
    const al = wallAlign(p, walls, t.d, Math.max(0.6, t.d / 2 + 0.5));
    if (al) Object.assign(f, al);
  }
  const { x, y } = snapToWalls(f, walls);
  return { ...f, x, y };
}

// "Doppelbett 180 (Schlafzimmer)" style one-liners for the AI context
export function furnLabel(f) {
  const t = furnType(f.type);
  const { w, d, h } = furnSize(f);
  const out = radiatorOutput(f);
  if (out) return `${f.label || furnName(f)} ${Math.round(w * 100)}×${Math.round(h * 100)} cm (ca. ${out.nominal} W bei 75/65 °C, ${out.at55} W bei 55/45 °C)`;
  return `${f.label || t.name} ${Math.round(w * 100)}×${Math.round(d * 100)} cm`;
}
