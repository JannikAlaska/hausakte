// Self-hosted mode: Supabase for login, documents (table hausakte_docs), files (bucket "hausakte")
// and the AI proxy (edge function "ai"). Active when the page defines window.HAUSAKTE_CONFIG.

const BUCKET = 'hausakte';
let client = null;

export const supaConfig = () => (typeof window !== 'undefined' ? window.HAUSAKTE_CONFIG || null : null);
export const isSupabaseMode = () => !!(supaConfig()?.supabaseUrl && typeof window.supabase?.createClient === 'function');

export function supa() {
  if (!client && isSupabaseMode()) {
    const c = supaConfig();
    client = window.supabase.createClient(c.supabaseUrl, c.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return client;
}

// ---------- auth ----------
const AUTH_ERRORS = [
  [/HAUSAKTE_SIGNUP_NOT_ALLOWED|Database error saving new user/i, 'Registrierung nicht möglich: E-Mail-Adresse oder Einladungscode stimmt nicht.'],
  [/Invalid login credentials/i, 'E-Mail oder Passwort ist falsch.'],
  [/Email not confirmed/i, 'Die E-Mail-Adresse ist noch nicht bestätigt.'],
  [/Password should be at least|weak_password|too short/i, 'Das Passwort muss mindestens 8 Zeichen haben.'],
  [/User already registered|already been registered|already exists/i, 'Für diese E-Mail gibt es schon ein Konto – bitte anmelden.'],
  [/rate limit/i, 'Zu viele Versuche. Warte ein paar Minuten.'],
];
export const authErrorText = (e) => (AUTH_ERRORS.find(([re]) => re.test(e?.message || '')) || [null, e?.message || 'Anmeldung fehlgeschlagen.'])[1];

export async function getSession() {
  const { data } = await supa().auth.getSession();
  return data.session;
}
export function onAuth(fn) {
  const { data } = supa().auth.onAuthStateChange((ev, session) => fn(session, ev));
  return () => data.subscription.unsubscribe();
}
export async function signIn(email, password) {
  const { error } = await supa().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}
export const normalizeInvite = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Accounts are created by the edge function "signup" after it checked the invite code, so no
// confirmation e-mail is needed.
export async function signUp(email, password, invite) {
  const { data, error } = await supa().functions.invoke('signup', { body: { email: email.trim(), password, invite: normalizeInvite(invite) } });
  if (error) {
    let detail = null;
    try {
      detail = await error.context?.json?.();
    } catch {}
    throw { message: detail?.code === 'not_allowed' ? 'HAUSAKTE_SIGNUP_NOT_ALLOWED' : detail?.message || error.message };
  }
  if (!data?.ok) throw { message: 'HAUSAKTE_SIGNUP_NOT_ALLOWED' };
  await signIn(email, password);
}
export async function signOut() {
  await supa().auth.signOut();
}
export async function resetPassword(email) {
  const { error } = await supa().auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
  if (error) throw error;
}
export async function updatePassword(password) {
  const { error } = await supa().auth.updateUser({ password });
  if (error) throw error;
}

// ---------- document store with the same surface store.js uses from the artifact db ----------
// Every row carries updated_at (set by a trigger). It is used as a version stamp: writes only go through
// when the row still has the stamp this device last saw, otherwise store.js merges and retries.
function snapshotOf(changes, fromCache = false) {
  return { docChanges: () => changes, metadata: { fromCache, hasPendingWrites: false } };
}
const docSnap = (row) => ({ id: row.id, exists: true, data: () => row.data, stamp: row.updated_at || null });

const handlers = new Map(); // collection -> Set(fn)
const reconnectFns = new Set();
const rtFns = new Set();
let channel = null;
let rtStatus = 'connecting'; // 'connecting' | 'live' | 'down'
let everLive = false;
let rejoinTimer = null;
export const realtimeStatus = () => rtStatus;
export const onRealtime = (fn) => (rtFns.add(fn), () => rtFns.delete(fn));
function setRt(st) {
  if (rtStatus === st) return;
  rtStatus = st;
  for (const fn of rtFns) fn(st);
}
function ensureChannel(sb) {
  if (channel) return;
  const ch = sb.channel('hausakte-docs-' + Math.random().toString(36).slice(2, 8));
  channel = ch;
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'hausakte_docs' }, (p) => {
    const row = p.eventType === 'DELETE' ? p.old : p.new;
    const fns = handlers.get(row?.collection);
    if (!fns) return;
    const change = p.eventType === 'DELETE' ? { type: 'removed', doc: docSnap(row) } : { type: p.eventType === 'INSERT' ? 'added' : 'modified', doc: docSnap(row) };
    for (const fn of fns) fn(snapshotOf([change]));
  }).subscribe((status) => {
    if (channel !== ch) return;
    if (status === 'SUBSCRIBED') {
      const again = everLive;
      everLive = true;
      setRt('live');
      // events sent while the connection was gone are lost - fetch what changed
      if (again) for (const fn of reconnectFns) fn();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      setRt('down');
      clearTimeout(rejoinTimer);
      rejoinTimer = setTimeout(() => {
        if (channel !== ch || rtStatus === 'live') return;
        channel = null;
        sb.removeChannel(ch);
        ensureChannel(sb);
      }, 8000);
    }
  });
}
// a phone that slept for a while: start a fresh connection instead of waiting for the old one to time out
export function reconnectRealtime() {
  const sb = supa();
  if (!sb || !channel || rtStatus === 'live') return;
  const ch = channel;
  channel = null;
  sb.removeChannel(ch);
  ensureChannel(sb);
}

async function pages(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw { code: 'unavailable', message: error.message };
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

export function supaDb() {
  const sb = supa();
  return {
    stamps: true,
    onReconnect: (fn) => (reconnectFns.add(fn), () => reconnectFns.delete(fn)),
    // collection, id and version of every document (a few KB) - to find out cheaply what changed
    fetchStamps: () => pages(() => sb.from('hausakte_docs').select('collection,id,updated_at').order('collection').order('id')),
    async fetchDocs(col, ids) {
      const out = [];
      for (let i = 0; i < ids.length; i += 80) {
        const { data, error } = await sb.from('hausakte_docs').select('id,data,updated_at').eq('collection', col).in('id', ids.slice(i, i + 80));
        if (error) throw { code: 'unavailable', message: error.message };
        out.push(...data);
      }
      return out;
    },
    collection(col) {
      return {
        onSnapshot(next, onError) {
          let alive = true;
          const fn = (snap) => alive && next(snap);
          if (!handlers.has(col)) handlers.set(col, new Set());
          handlers.get(col).add(fn);
          ensureChannel(sb);
          (async () => {
            let rows;
            try {
              rows = await pages(() => sb.from('hausakte_docs').select('id,data,updated_at').eq('collection', col).order('id'));
            } catch (e) {
              return onError?.(e);
            }
            if (alive) next(snapshotOf(rows.map((r) => ({ type: 'added', doc: docSnap(r) }))));
          })();
          return () => {
            alive = false;
            handlers.get(col)?.delete(fn);
          };
        },
        doc(id) {
          const fail = (error) => ({ code: error.code === '42501' ? 'invalid_argument' : 'unavailable', message: error.message });
          return {
            // with opts.stamp the write only succeeds if nobody changed the row since; otherwise
            // it throws { code: 'conflict', current: { data, updated_at } | null }
            async set(data, opts = {}) {
              if (opts.stamp) {
                const { data: rows, error } = await sb.from('hausakte_docs').update({ data }).eq('collection', col).eq('id', id).eq('updated_at', opts.stamp).select('updated_at');
                if (error) throw fail(error);
                if (rows?.length) return { stamp: rows[0].updated_at };
                const { data: cur, error: e2 } = await sb.from('hausakte_docs').select('data,updated_at').eq('collection', col).eq('id', id).maybeSingle();
                if (e2) throw fail(e2);
                throw { code: 'conflict', current: cur || null };
              }
              const { data: rows, error } = await sb.from('hausakte_docs').upsert({ collection: col, id, data }).select('updated_at');
              if (error) throw fail(error);
              return { stamp: rows?.[0]?.updated_at || null };
            },
            async delete() {
              const { error } = await sb.from('hausakte_docs').delete().eq('collection', col).eq('id', id);
              if (error) throw { code: 'unavailable', message: error.message };
            },
          };
        },
      };
    },
  };
}

// ---------- members & invites ----------
export async function listMembers() {
  const { data, error } = await supa().from('hausakte_members').select('user_id,email,role,created_at').order('created_at');
  if (error) throw error;
  return data;
}
export async function listInvites() {
  const { data, error } = await supa().from('hausakte_invites').select('email,expires_at,created_at').order('created_at');
  if (error) throw error;
  return data;
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// The code is shown once; only its hash is stored.
export async function createInvite(email) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const raw = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => alphabet[b % alphabet.length]).join('');
  const { data: u } = await supa().auth.getUser();
  const { error } = await supa()
    .from('hausakte_invites')
    .upsert({ email: email.trim().toLowerCase(), code_hash: await sha256Hex(raw), created_by: u?.user?.id, expires_at: new Date(Date.now() + 14 * 864e5).toISOString() });
  if (error) throw error;
  return raw.match(/.{4}/g).join('-');
}
export async function deleteInvite(email) {
  const { error } = await supa().from('hausakte_invites').delete().eq('email', email);
  if (error) throw error;
}

// ---------- files ----------
const urlCache = new Map(); // path -> {url, until}
const urlListeners = new Set();
export const onFileUrls = (fn) => (urlListeners.add(fn), () => urlListeners.delete(fn));

export function cachedFileUrl(path) {
  const hit = urlCache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  requestUrls([path]);
  return hit?.url || null;
}

let queue = new Set();
const asking = new Set();
let timer = null;
function requestUrls(paths) {
  for (const p of paths) if (!asking.has(p)) queue.add(p);
  if (timer || !queue.size) return;
  timer = setTimeout(async () => {
    const list = [...queue];
    queue = new Set();
    timer = null;
    list.forEach((p) => asking.add(p));
    const { data } = await supa().storage.from(BUCKET).createSignedUrls(list, 3600);
    const now = Date.now();
    const got = new Map((data || []).filter((r) => r.signedUrl).map((r) => [r.path, r.signedUrl]));
    // missing files are remembered for a minute so renders don't keep asking
    for (const p of list) urlCache.set(p, got.has(p) ? { url: got.get(p), until: now + 3300 * 1000 } : { url: null, until: now + 60 * 1000 });
    list.forEach((p) => asking.delete(p));
    for (const fn of urlListeners) fn();
  }, 30);
}

export function supaAssets() {
  const sb = supa();
  return {
    async upload(blob, opts = {}) {
      const name = (blob.name || 'datei').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
      const path = `${new Date().toISOString().slice(0, 10)}/${Math.random().toString(36).slice(2, 10)}-${name}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: opts.type || blob.type, upsert: false });
      if (error) throw { code: /size/i.test(error.message) ? 'too_large' : 'upstream_error', message: error.message };
      urlCache.delete(path);
      requestUrls([path]);
      return { id: path, url: null, sizeBytes: blob.size, contentType: opts.type || blob.type };
    },
    async delete(path) {
      await sb.storage.from(BUCKET).remove([path]);
      urlCache.delete(path);
      return { deleted: true };
    },
  };
}

// ---------- AI via edge function, same call shape as the artifact `sample` capability ----------
const readBase64 = (blob) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });

// PDFs go to the model as documents, everything else is re-encoded as a JPEG of at most 1568 px.
async function blobToImageBlock(blob) {
  if (blob.type === 'application/pdf') {
    if (blob.size > 6 * 1024 * 1024) throw { code: 'image_rejected', message: 'PDF too large' };
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await readBase64(blob) } };
  }
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s);
  cv.height = Math.round(bmp.height * s);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const dataUrl = cv.toDataURL('image/jpeg', 0.85);
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: dataUrl.split(',')[1] } };
}

async function callAi(body, signal) {
  const { data, error } = await supa().functions.invoke('ai', { body, signal });
  if (error) {
    let detail = null;
    try {
      detail = await error.context?.json?.();
    } catch {}
    const code = detail?.code || (signal?.aborted ? 'cancelled' : 'upstream_error');
    throw { code, message: detail?.message || error.message };
  }
  return data;
}

function extractJson(text) {
  const t = String(text || '').trim();
  try {
    return JSON.parse(t);
  } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {}
  }
  const i = Math.min(...['{', '['].map((c) => (t.indexOf(c) < 0 ? Infinity : t.indexOf(c))));
  const j = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (isFinite(i) && j > i) {
    try {
      return JSON.parse(t.slice(i, j + 1));
    } catch {}
  }
  throw { code: 'invalid_json', message: 'no JSON in reply', text: t };
}

export function makeSupaSample() {
  async function run(input, opts = {}) {
    const turns = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map((m) => ({ role: m.role, content: m.content }));
    // merge consecutive same-role turns (the API wants alternating roles)
    const messages = [];
    for (const m of turns) {
      const last = messages[messages.length - 1];
      if (last && last.role === m.role && typeof last.content === 'string') last.content += '\n\n' + m.content;
      else messages.push({ ...m });
    }
    if (opts.images) {
      const imgs = opts.images instanceof Blob ? [opts.images] : [...opts.images];
      const blocks = await Promise.all(imgs.slice(0, 5).map(blobToImageBlock));
      const last = messages[messages.length - 1];
      last.content = [...blocks, { type: 'text', text: last.content }];
    }
    const tools = opts.tools || [];
    const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } }));
    let text = '';
    for (let round = 0; round < 6; round++) {
      const res = await callAi({ messages, tools: toolDefs, tier: opts.modelTier || 'default', json: !!opts.json, web: !!opts.web }, opts.signal);
      if (res.stop_reason === 'refusal') throw { code: 'refused', message: 'refused' };
      const blocks = res.content || [];
      // with web search the answer is the text after the last search or fetch result
      const lastResult = blocks.map((b) => /_tool_result$/.test(b.type || '')).lastIndexOf(true);
      const t = blocks.slice(lastResult + 1).filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (t) {
        text = text ? text + '\n\n' + t : t;
        opts.onText?.({ text, delta: t });
      }
      const uses = blocks.filter((b) => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length || !tools.length) break;
      messages.push({ role: 'assistant', content: blocks });
      const results = await Promise.all(
        uses.map(async (u) => {
          const tool = tools.find((x) => x.name === u.name);
          try {
            const out = await tool.execute(u.input || {}, { signal: opts.signal });
            return { type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out ?? 'ok') };
          } catch (e) {
            return { type: 'tool_result', tool_use_id: u.id, content: 'Error: ' + (e?.message || e), is_error: true };
          }
        }),
      );
      messages.push({ role: 'user', content: results });
    }
    if (!text) throw { code: 'empty_completion', message: 'no text' };
    return { text, truncated: false, modelTierApplied: opts.modelTier || 'default' };
  }
  const sample = (input, opts) => run(input, opts);
  sample.json = async (input, opts = {}) => extractJson((await run(input, { ...opts, json: true })).text);
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20 * 1024 * 1024, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] }, tools: { maxCount: 16 }, web: true });
  return sample;
}
