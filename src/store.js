// Data layer. Uses the artifact's shared `db` when the viewer provides it, otherwise the browser's
// localStorage. Local state is authoritative while a write for a document is queued or in flight.

import { deepClone } from './util.js';
import { isSupabaseMode, supaDb, supaAssets, cachedFileUrl, onFileUrls } from './supa.js';

export const COLLECTIONS = ['house', 'floors', 'components', 'projects', 'readings', 'documents', 'underlays'];
const LS_KEY = 'hausakte-v1';

let state = {
  loaded: false,
  mode: null, // 'db' | 'local'
  readOnly: false,
  house: null,
  floors: {},
  components: {},
  projects: {},
  readings: {},
  documents: {},
  underlays: {},
  saving: 0,
  lastSaved: null,
  error: null,
  fileTick: 0, // bumps when signed file URLs arrive (Supabase mode)
};
const listeners = new Set();
export const getState = () => state;
export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
function emit() {
  for (const fn of listeners) fn();
}
function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

let db = null;
let assetsApi;
const pending = new Map(); // path -> {col, id, data|null, timer}
const inflight = new Set();
const chains = new Map();

const pathOf = (col, id) => `${col}/${id}`;

function applyLocal(col, id, data) {
  if (col === 'house') {
    state = { ...state, house: data };
  } else {
    const next = { ...state[col] };
    if (data == null) delete next[id];
    else next[id] = data;
    state = { ...state, [col]: next };
  }
}

// ---------- persistence ----------
let lsTimer = null;
function saveLocalSoon() {
  clearTimeout(lsTimer);
  setState({ saving: 1 });
  lsTimer = setTimeout(() => {
    try {
      const snapshot = {};
      for (const c of COLLECTIONS) snapshot[c] = c === 'house' ? state.house : state[c];
      localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
      setState({ saving: 0, lastSaved: Date.now(), error: null });
    } catch (e) {
      setState({ saving: 0, error: 'Speichern im Browser fehlgeschlagen (Speicher voll?).' });
    }
  }, 350);
}

function schedule(col, id, data, delay) {
  const path = pathOf(col, id);
  const prev = pending.get(path);
  if (prev) clearTimeout(prev.timer);
  const entry = { col, id, data, timer: null };
  entry.timer = setTimeout(() => flush(path), delay);
  pending.set(path, entry);
  setState({ saving: pending.size + inflight.size });
}

function flush(path) {
  const entry = pending.get(path);
  if (!entry) return;
  pending.delete(path);
  inflight.add(path);
  const prevChain = chains.get(path) || Promise.resolve();
  const run = prevChain.then(async () => {
    const ref = db.collection(entry.col).doc(entry.id);
    try {
      if (entry.data == null) await ref.delete();
      else await ref.set(entry.data);
      setState({ lastSaved: Date.now(), error: null });
    } catch (e) {
      if (e?.code === 'unavailable') {
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 800));
        try {
          if (entry.data == null) await ref.delete();
          else await ref.set(entry.data);
          return;
        } catch (e2) {
          e = e2;
        }
      }
      const msg =
        e?.code === 'invalid_argument'
          ? 'Du hast für diese Hausakte nur Leserechte – Änderungen werden nicht gespeichert.'
          : e?.code === 'quota_exceeded'
            ? 'Der Speicher dieser Hausakte ist voll. Lösche alte Dokumente oder Einträge.'
            : 'Speichern fehlgeschlagen: ' + (e?.message || e?.code || 'unbekannter Fehler');
      setState({ error: msg, readOnly: e?.code === 'invalid_argument' ? true : state.readOnly });
    }
  });
  chains.set(path, run);
  run.finally(() => {
    inflight.delete(path);
    if (chains.get(path) === run) chains.delete(path);
    setState({ saving: pending.size + inflight.size });
  });
}

export function flushAll() {
  for (const path of [...pending.keys()]) {
    clearTimeout(pending.get(path).timer);
    flush(path);
  }
}

// ---------- public mutations ----------
export function putDoc(col, id, data, delay = 450) {
  const body = data == null ? null : { ...data, id: col === 'house' ? 'main' : id };
  applyLocal(col, id, body);
  emit();
  if (state.mode === 'db') schedule(col, id, body, delay);
  else saveLocalSoon();
}

export function updateDoc(col, id, fn, delay) {
  const cur = col === 'house' ? state.house : state[col][id];
  if (!cur && col !== 'house') return;
  const next = fn(deepClone(cur || {}));
  putDoc(col, id, next, delay);
}

export const deleteDoc = (col, id) => putDoc(col, id, null, 0);
export const updateHouse = (fn, delay) => updateDoc('house', 'main', fn, delay);

export function loadDataset(ds) {
  const all = [];
  if (ds.house) all.push(['house', 'main', ds.house]);
  for (const c of COLLECTIONS) {
    if (c === 'house') continue;
    const arr = Array.isArray(ds[c]) ? ds[c] : Object.values(ds[c] || {});
    for (const d of arr) if (d && d.id) all.push([c, d.id, d]);
  }
  all.forEach(([c, id, d], i) => putDoc(c, id, d, 60 + i * 40));
}

export function clearAll() {
  const docs = [];
  if (state.house) docs.push(['house', 'main']);
  for (const c of COLLECTIONS) if (c !== 'house') for (const id of Object.keys(state[c])) docs.push([c, id]);
  docs.forEach(([c, id], i) => putDoc(c, id, null, 30 + i * 30));
}

export function exportData() {
  const out = { app: 'Hausakte', version: 1, exportedAt: new Date().toISOString(), house: state.house };
  for (const c of COLLECTIONS) if (c !== 'house') out[c] = Object.values(state[c]);
  return out;
}

// ---------- assets ----------
export async function getAssets() {
  if (assetsApi !== undefined) return assetsApi;
  if (isSupabaseMode()) return (assetsApi = supaAssets());
  try {
    assetsApi = window.claude?.use ? await window.claude.use('assets') : null;
  } catch {
    assetsApi = null;
  }
  return assetsApi;
}

// Artifact assets are served under /_blob/<id>; in Supabase mode the id is a storage path that
// needs a signed URL, which arrives asynchronously (null until then).
export const blobUrl = (assetId) => (isSupabaseMode() ? cachedFileUrl(assetId) : '/_blob/' + assetId);

export function fileUrl(doc) {
  if (!doc) return null;
  if (doc.assetId) return blobUrl(doc.assetId);
  if (doc.dataUrl) return doc.dataUrl;
  return null;
}

// ---------- startup ----------
function startLocal() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  } catch {}
  const patch = { mode: 'local', loaded: true };
  if (saved) for (const c of COLLECTIONS) patch[c] = saved[c] ?? (c === 'house' ? null : {});
  setState(patch);
}

function startDb(d) {
  db = d;
  setState({ mode: 'db' });
  const loaded = new Set();
  const markLoaded = (c) => {
    loaded.add(c);
    if (loaded.size === COLLECTIONS.length && !state.loaded) setState({ loaded: true });
  };
  const failSafe = setTimeout(() => {
    if (!state.loaded) setState({ loaded: true });
  }, 12000);
  for (const col of COLLECTIONS) {
    db.collection(col).onSnapshot(
      (snap) => {
        let changed = false;
        for (const ch of snap.docChanges()) {
          const id = ch.doc.id;
          const path = pathOf(col, id);
          if (pending.has(path) || inflight.has(path)) continue;
          if (ch.type === 'removed') applyLocal(col, id, null);
          else applyLocal(col, id, ch.doc.data());
          changed = true;
        }
        if (changed) emit();
        if (!snap.metadata?.fromCache) markLoaded(col);
        if (loaded.size === COLLECTIONS.length) clearTimeout(failSafe);
      },
      (err) => {
        markLoaded(col);
        if (err?.code === 'revoked') setState({ error: 'Der Zugriff auf diese Hausakte wurde beendet.', readOnly: true });
      },
    );
  }
}

let started = false;
export async function initStore() {
  if (started) return;
  started = true;
  if (isSupabaseMode()) {
    onFileUrls(() => setState({ fileTick: state.fileTick + 1 }));
    return startDb(supaDb());
  }
  const hasClaude = typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function';
  if (!hasClaude) return startLocal();
  let d = null;
  try {
    d = await window.claude.use('db');
  } catch {
    d = null;
  }
  if (!d) return startLocal();
  startDb(d);
  try {
    const user = await window.claude.use('user');
    const can = user ? await user.can('data.write') : null;
    if (can === false) setState({ readOnly: true });
  } catch {}
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => flushAll());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
}

// ---------- selectors ----------
export const list = (col) => Object.values(state[col] || {});
