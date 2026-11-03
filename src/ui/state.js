// UI state shared across components (current view, 3D mode, selection, drawer, toasts).
import { getState, subscribe } from '../store.js';

const VIEWS = ['cockpit', 'modell', 'grundriss', 'gebaeude', 'projekte', 'verbrauch', 'dokumente'];

// short addresses for widgets and links: #rechnungen opens Dokumente > Rechnungen
const ALIAS = { rechnungen: { view: 'dokumente', docTab: 'rechnungen' }, notizen: { view: 'dokumente', docTab: 'notizen' }, kontakte: { view: 'dokumente', docTab: 'kontakte' } };
const routeOf = (h) => ALIAS[h] || { view: VIEWS.includes(h) ? h : 'cockpit' };

// walls hidden in the 3D model: a view setting of this device (not part of the house data)
const HW_KEY = 'hausakte-hidden-walls';
function loadHiddenWalls() {
  try {
    const v = JSON.parse(localStorage.getItem(HW_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// lines and connection points shown: 'alle' | 'bestand' | 'geplant' (also a setting of this device)
const IF_KEY = 'hausakte-install-filter';
function loadInstallFilter() {
  try {
    const v = localStorage.getItem(IF_KEY);
    return ['bestand', 'geplant'].includes(v) ? v : 'alle';
  } catch {
    return 'alle';
  }
}

let ui = {
  ...routeFromHash(),
  hiddenWalls: loadHiddenWalls(),
  installFilter: loadInstallFilter(),
  mode: 'all', // 'all' | 'floor' | 'explode'
  floorId: null,
  showRoof: true,
  showLabels: true,
  showLines: false, // x-ray view with installation lines
  sunOn: false, // sun study in the model view
  pvHeat: false, // PV shading colours on the roof
  selection: null, // {type:'room'|'project'|'component'|'floor'|'roof', ...}
  drawer: null, // {type, id, ...}
  highlight: null,
  toasts: [],
  wide: typeof window !== 'undefined' ? window.innerWidth >= 1100 : true,
  mobile: typeof window !== 'undefined' ? window.innerWidth <= 760 : false,
};
// the live 3D scene, for features that need its geometry (PV shading analysis)
export const sceneHandle = { current: null };
const subs = new Set();
export const getUI = () => ui;
export const subscribeUI = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};
export function setUI(patch) {
  ui = { ...ui, ...(typeof patch === 'function' ? patch(ui) : patch) };
  for (const f of subs) f();
}

function routeFromHash() {
  if (typeof location === 'undefined') return { view: 'cockpit' };
  return routeOf(location.hash.replace('#', ''));
}

export function go(target) {
  const r = routeOf(target);
  const view = r.view;
  setUI(r);
  try {
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  } catch {
    try {
      location.hash = view;
    } catch {}
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => setUI(routeFromHash()));
  window.addEventListener('resize', () => {
    const wide = window.innerWidth >= 1100;
    const mobile = window.innerWidth <= 760;
    if (wide !== ui.wide || mobile !== ui.mobile) setUI({ wide, mobile });
  });
}

export const openDrawer = (d) => setUI({ drawer: d });
export const closeDrawer = () => setUI({ drawer: null, highlight: null });

let toastId = 0;
export function toast(text, tone = 'ok', ms = 3200) {
  const id = ++toastId;
  setUI((u) => ({ toasts: [...u.toasts, { id, text, tone }] }));
  setTimeout(() => setUI((u) => ({ toasts: u.toasts.filter((t) => t.id !== id) })), ms);
}

export function useUI() {
  return React.useSyncExternalStore(subscribeUI, getUI);
}
export function useData() {
  return React.useSyncExternalStore(subscribe, getState);
}

export function showFloor(floorId) {
  setUI({ mode: 'floor', floorId });
}

export function setHiddenWalls(ids) {
  const list = [...new Set(ids)];
  try {
    localStorage.setItem(HW_KEY, JSON.stringify(list));
  } catch {}
  setUI({ hiddenWalls: list });
}
export const hideWall = (id) => setHiddenWalls([...getUI().hiddenWalls, id]);
export const showWall = (id) => setHiddenWalls(getUI().hiddenWalls.filter((x) => x !== id));

export function setInstallFilter(v) {
  const f = ['bestand', 'geplant'].includes(v) ? v : 'alle';
  try {
    localStorage.setItem(IF_KEY, f);
  } catch {}
  setUI({ installFilter: f });
}
