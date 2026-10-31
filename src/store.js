// Data layer. Uses the artifact's shared `db` when the viewer provides it, otherwise the browser's
// localStorage. Local state is authoritative while a write for a document is queued or in flight.

import { deepClone } from './util.js';
import { isSupabaseMode, supaDb, supaAssets, cachedFileUrl, onFileUrls, reconnectRealtime } from './supa.js';

export const COLLECTIONS = ['house', 'floors', 'components', 'projects', 'readings', 'documents', 'underlays', 'notes', 'contacts'];
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
  notes: {},
  contacts: {},
  saving: 0,
  lastSaved: null,
  error: null,
  fileTick: 0, // bumps when signed file URLs arrive (Supabase mode)
  syncing: false,
  lastSync: null, // last successful check against the server (Supabase mode)
  syncNote: null, // { text, at } - e.g. changes from another device merged into a save
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
// Supabase mode: version stamp (updated_at) and content of each document as last seen on the server.
// They are the base for detecting and merging concurrent edits from another device.
const stamps = new Map();
const bases = new Map();

// JSON with sorted keys - the database returns object keys in its own order
export function stableStr(v) {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStr).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableStr(v[k])).join(',') + '}';
}
const same = (a, b) => stableStr(a) === stableStr(b);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isIdList = (v) => Array.isArray(v) && v.every((x) => isObj(x) && x.id != null);

// Three-way merge of a document: what changed only on this device or only on the other one is kept from
// that side; lists of items with ids (walls, rooms, furniture, milestones …) are merged item by item.
// Where both sides changed the same thing, this device wins.
export function merge3(base, local, remote, depth = 0) {
  if (same(local, base)) return remote;
  if (same(remote, base) || same(local, remote)) return local;
  if (depth < 3 && isObj(local) && isObj(remote)) {
    const out = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const v = merge3(isObj(base) ? base[k] : undefined, local[k], remote[k], depth + 1);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (depth < 3 && isIdList(local) && isIdList(remote)) {
    const byId = (list) => new Map((isIdList(list) ? list : []).map((x) => [String(x.id), x]));
    const b = byId(base),
      l = byId(local),
      r = byId(remote);
    const out = [];
    const take = (id) => {
      const v = merge3(b.get(id), l.get(id), r.get(id), depth + 1);
      if (v !== undefined) out.push(v);
    };
    for (const id of l.keys()) take(id);
    // added on the other device, or deleted here but changed there
    for (const id of r.keys()) if (!l.has(id) && (!b.has(id) || !same(b.get(id), r.get(id)))) take(id);
    return out;
  }
  return local;
}

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
    const write = async () => {
      if (entry.data == null) {
        await ref.delete();
        stamps.delete(path);
        bases.delete(path);
        return;
      }
      let data = entry.data;
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await ref.set(data, db.stamps ? { stamp: stamps.get(path) } : undefined);
          if (db.stamps) {
            if (res?.stamp) stamps.set(path, res.stamp);
            else stamps.delete(path);
            bases.set(path, data);
          }
          if (data !== entry.data) adoptMerged(entry, data);
          return;
        } catch (e) {
          if (e?.code !== 'conflict' || attempt >= 4) throw e;
          // another device saved this document in the meantime: merge both and try again on top of it
          const cur = e.current;
          data = cur ? merge3(bases.get(path), data, cur.data) : data;
          if (cur) {
            stamps.set(path, cur.updated_at);
            bases.set(path, cur.data);
          } else stamps.delete(path);
        }
      }
    };
    try {
      await write();
      setState({ lastSaved: Date.now(), error: null });
    } catch (e) {
      if (e?.code === 'unavailable') {
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 800));
        try {
          await write();
          setState({ lastSaved: Date.now(), error: null });
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

// a save was merged with changes from another device: show the merged version (and keep newer local edits)
function adoptMerged(entry, merged) {
  const path = pathOf(entry.col, entry.id);
  const later = pending.get(path);
  if (later && later.data != null) later.data = merge3(entry.data, later.data, merged);
  applyLocal(entry.col, entry.id, later ? later.data : merged);
  setState({ syncNote: { text: 'Änderungen von einem anderen Gerät wurden übernommen und mit deinen zusammengeführt.', at: Date.now() } });
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
          if (ch.type === 'removed') {
            applyLocal(col, id, null);
            stamps.delete(path);
            bases.delete(path);
          } else {
            const data = ch.doc.data();
            applyLocal(col, id, data);
            if (ch.doc.stamp) stamps.set(path, ch.doc.stamp);
            bases.set(path, data);
          }
          changed = true;
        }
        if (changed) emit();
        if (!snap.metadata?.fromCache) {
          markLoaded(col);
          if (db.stamps && !state.lastSync) state = { ...state, lastSync: Date.now() };
        }
        if (loaded.size === COLLECTIONS.length) clearTimeout(failSafe);
      },
      (err) => {
        markLoaded(col);
        if (err?.code === 'revoked') setState({ error: 'Der Zugriff auf diese Hausakte wurde beendet.', readOnly: true });
      },
    );
  }
}

// ---------- catching up with other devices (Supabase mode) ----------
// Compare version stamps of all documents with the server (a few KB) and load only what changed.
// Runs when the app comes back to the foreground, goes online again, after a lost live connection,
// every minute as a safety net and when the sync button is pressed.
const stampKey = (s) => {
  if (!s) return null;
  const m = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(String(s).trim());
  if (!m) return String(s);
  let tz = m[4] || 'Z';
  if (/^[+-]\d\d$/.test(tz)) tz += ':00';
  return Date.parse(`${m[1]}T${m[2]}${tz}`) * 1000 + Number((m[3] || '').padEnd(6, '0').slice(0, 6));
};
let syncRun = null;
export function canResync() {
  return state.mode === 'db' && !!db?.fetchStamps;
}
export function resync({ manual = false } = {}) {
  if (!canResync()) return Promise.resolve({ changed: 0, supported: false });
  if (syncRun) return syncRun;
  syncRun = (async () => {
    setState({ syncing: true });
    try {
      if (manual) {
        flushAll();
        await Promise.allSettled([...chains.values()]);
      }
      const rows = await db.fetchStamps();
      const server = new Map(rows.map((r) => [pathOf(r.collection, r.id), r]));
      const busy = (path) => pending.has(path) || inflight.has(path);
      const want = new Map(); // collection -> ids to load
      for (const [path, r] of server) {
        if (!COLLECTIONS.includes(r.collection) || busy(path)) continue;
        const known = stamps.get(path);
        const local = r.collection === 'house' ? state.house : state[r.collection]?.[r.id];
        if (known && stampKey(known) === stampKey(r.updated_at) && local) continue;
        if (!want.has(r.collection)) want.set(r.collection, []);
        want.get(r.collection).push(r.id);
      }
      let changed = 0;
      for (const [col, ids] of want) {
        for (const r of await db.fetchDocs(col, ids)) {
          const path = pathOf(col, r.id);
          if (busy(path)) continue;
          const local = col === 'house' ? state.house : state[col][r.id];
          if (!same(local, r.data)) {
            applyLocal(col, r.id, r.data);
            changed++;
          }
          stamps.set(path, r.updated_at);
          bases.set(path, r.data);
        }
      }
      // deleted on another device
      for (const col of COLLECTIONS) {
        const ids = col === 'house' ? (state.house ? ['main'] : []) : Object.keys(state[col] || {});
        for (const id of ids) {
          const path = pathOf(col, id);
          if (server.has(path) || busy(path)) continue;
          applyLocal(col, id, null);
          stamps.delete(path);
          bases.delete(path);
          changed++;
        }
      }
      setState({ syncing: false, lastSync: Date.now() });
      return { changed, supported: true };
    } catch (e) {
      setState({ syncing: false });
      throw e;
    } finally {
      syncRun = null;
    }
  })();
  return syncRun;
}

let hiddenAt = 0;
let lastAuto = 0;
function autoSync(reason) {
  if (!canResync() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  if (reason === 'focus' && Date.now() - lastAuto < 15000) return;
  lastAuto = Date.now();
  resync().catch(() => {});
}
function startAutoSync() {
  db.onReconnect?.(() => autoSync('reconnect'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (Date.now() - hiddenAt > 1500) {
      reconnectRealtime();
      autoSync('visible');
    }
  });
  window.addEventListener('online', () => {
    reconnectRealtime();
    autoSync('online');
  });
  window.addEventListener('focus', () => autoSync('focus'));
  window.addEventListener('pageshow', (e) => e.persisted && autoSync('visible'));
  setInterval(() => document.visibilityState === 'visible' && autoSync('interval'), 60000);
}

let started = false;
export async function initStore() {
  if (started) return;
  started = true;
  if (isSupabaseMode()) {
    onFileUrls(() => setState({ fileTick: state.fileTick + 1 }));
    startDb(supaDb());
    return startAutoSync();
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
