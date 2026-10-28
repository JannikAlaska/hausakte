// UI state shared across components (current view, 3D mode, selection, drawer, toasts).
import { getState, subscribe } from '../store.js';

const VIEWS = ['modell', 'grundriss', 'gebaeude', 'projekte', 'verbrauch', 'dokumente'];

let ui = {
  view: viewFromHash(),
  mode: 'all', // 'all' | 'floor' | 'explode'
  floorId: null,
  showRoof: true,
  showLabels: true,
  selection: null, // {type:'room'|'project'|'component'|'floor'|'roof', ...}
  drawer: null, // {type, id, ...}
  highlight: null,
  toasts: [],
  wide: typeof window !== 'undefined' ? window.innerWidth >= 1100 : true,
  mobile: typeof window !== 'undefined' ? window.innerWidth <= 760 : false,
};
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

function viewFromHash() {
  if (typeof location === 'undefined') return 'modell';
  const h = location.hash.replace('#', '');
  return VIEWS.includes(h) ? h : 'modell';
}

export function go(view) {
  if (!VIEWS.includes(view)) view = 'modell';
  setUI({ view });
  try {
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  } catch {
    try {
      location.hash = view;
    } catch {}
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => setUI({ view: viewFromHash() }));
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
