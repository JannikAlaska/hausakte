// Contacts (craftsmen, authorities, advisers): matching names in free text, collecting everything a contact is linked to
// (project, meetings, to-dos, costs, documents) and changing those links.
import { getState, putDoc, updateDoc, deleteDoc } from './store.js';
import { uid, fmtDayMonth } from './util.js';

// lower case without legal forms, titles and punctuation: "Elektro Müller GmbH & Co. KG" -> "elektro müller"
export function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-zäöüß0-9]+/g, ' ')
    .replace(/\b(gmbh|mbh|co|kg|ag|ug|ohg|gbr|ek|inh|inhaber|fa|firma|und|herr|frau|dr|dipl|ing)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// best contact for a free text like "Elektro Müller" or "Herr Müller (Elektriker)"; null when nothing is clear
export function matchContact(text, contacts = Object.values(getState().contacts || {})) {
  const t = ` ${normName(text)} `;
  if (t.trim().length < 3) return null;
  let best = null;
  for (const c of contacts) {
    let score = 0;
    const comp = normName(c.company);
    if (comp.length >= 4 && t.includes(` ${comp} `)) score += 3;
    for (const w of comp.split(' ')) if (w.length >= 4 && t.includes(` ${w} `)) score += 1;
    const last = normName(c.name).split(' ').pop();
    if (last && last.length >= 3 && t.includes(` ${last} `)) score += 2;
    if (score > (best?.score || 0)) best = { id: c.id, score };
  }
  return best && best.score >= 2 ? best.id : null;
}

export const contactTitle = (c) => c?.company || c?.name || 'Kontakt';

// website host for links and the logo fallback
export function hostOf(url) {
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
export function logoCandidates(c) {
  const host = hostOf(c?.website || '');
  return [c?.logoUrl, host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : null].filter((u) => typeof u === 'string' && /^https:\/\//.test(u));
}

// everything a contact is linked to
export function contactLinks(id, data) {
  const out = { projects: [], meetings: [], todos: [], costs: [], docs: [] };
  for (const p of Object.values(data.projects || {})) {
    if ((p.contactIds || []).includes(id)) out.projects.push(p);
    for (const m of p.meetings || []) if ((m.contactIds || []).includes(id)) out.meetings.push({ p, m });
    for (const c of p.constraints || []) if (c.contactId === id) out.todos.push({ p, c });
    for (const k of p.costs || []) if (k.contactId === id) out.costs.push({ p, k });
  }
  for (const d of Object.values(data.documents || {})) if (d.contactId === id) out.docs.push(d);
  return out;
}

// contacts involved in a project, each with the reasons (meeting, to-do, offer …)
export function projectContacts(p, data) {
  const map = new Map();
  const add = (cid, why) => {
    const c = data.contacts?.[cid];
    if (!c) return;
    if (!map.has(cid)) map.set(cid, { c, why: [], explicit: false });
    const e = map.get(cid);
    if (why === null) e.explicit = true;
    else if (!e.why.includes(why)) e.why.push(why);
  };
  for (const cid of p.contactIds || []) add(cid, null);
  for (const m of p.meetings || []) for (const cid of m.contactIds || []) add(cid, `Besprechung ${fmtDayMonth(m.date)}`);
  for (const c of p.constraints || []) if (c.contactId) add(c.contactId, `To-do: ${c.text}`);
  for (const k of p.costs || []) if (k.contactId) add(k.contactId, `Kosten: ${k.label}`);
  for (const d of Object.values(data.documents || {})) if (d.projectId === p.id && d.contactId) add(d.contactId, `${d.type === 'angebot' ? 'Angebot' : d.type === 'rechnung' ? 'Rechnung' : 'Dokument'}: ${d.name}`);
  return [...map.values()];
}

export function createContact(fields = {}) {
  const id = uid('ct-');
  const now = Date.now();
  putDoc('contacts', id, { id, name: '', company: '', role: '', trade: '', phone: '', mobile: '', email: '', website: '', address: '', notes: '', logoUrl: null, cardDocId: null, web: null, source: 'manuell', createdAt: now, ...fields, updatedAt: now }, 50);
  return id;
}
export const updateContact = (id, patch) => updateDoc('contacts', id, (c) => ({ ...c, ...patch, updatedAt: Date.now() }), 300);

// links: { projects: [pid], meetings: ['pid/mid'], todos: ['pid/tid'], costs: ['pid/kid'], docs: [docId] }; on = false removes them
export function setContactLinks(cid, links, on = true) {
  const byProject = new Map();
  const want = (pid) => byProject.get(pid) || byProject.set(pid, { project: false, meetings: new Set(), todos: new Set(), costs: new Set() }).get(pid);
  for (const pid of links.projects || []) want(pid).project = true;
  for (const key of ['meetings', 'todos', 'costs'])
    for (const ref of links[key] || []) {
      const [pid, iid] = String(ref).split('/');
      if (pid && iid) want(pid)[key].add(iid);
    }
  const state = getState();
  let n = 0;
  for (const [pid, w] of byProject) {
    if (!state.projects[pid]) continue;
    updateDoc('projects', pid, (p) => {
      const ids = new Set(p.contactIds || []);
      if (w.project) on ? ids.add(cid) : ids.delete(cid);
      const flip = (list, key, set) =>
        (list || []).map((x) => {
          if (!set.has(x.id)) return x;
          n++;
          if (key === 'contactIds') {
            const s = new Set(x.contactIds || []);
            on ? s.add(cid) : s.delete(cid);
            return { ...x, contactIds: [...s] };
          }
          return { ...x, contactId: on ? cid : x.contactId === cid ? null : x.contactId };
        });
      return { ...p, contactIds: [...ids], meetings: flip(p.meetings, 'contactIds', w.meetings), constraints: flip(p.constraints, 'contactId', w.todos), costs: flip(p.costs, 'contactId', w.costs) };
    }, 100);
    if (w.project) n++;
  }
  for (const did of links.docs || [])
    if (state.documents[did]) {
      updateDoc('documents', did, (d) => ({ ...d, contactId: on ? cid : d.contactId === cid ? null : d.contactId }), 100);
      n++;
    }
  return n;
}

// links found by name for a contact (used without AI and to double-check)
export function linksByName(c, data) {
  const contacts = [c];
  const hit = (txt) => matchContact(txt, contacts) === c.id;
  const out = { projects: [], meetings: [], todos: [], costs: [], docs: [] };
  for (const p of Object.values(data.projects || {})) {
    for (const m of p.meetings || []) if (hit(`${(m.participants || []).join(' ')} ${m.title} ${m.summary} ${m.transcript || ''}`)) out.meetings.push(`${p.id}/${m.id}`);
    for (const t of p.constraints || []) if (hit(`${t.who || ''} ${t.text}`)) out.todos.push(`${p.id}/${t.id}`);
    for (const k of p.costs || []) if (hit(`${k.vendor || ''} ${k.label}`)) out.costs.push(`${p.id}/${k.id}`);
  }
  for (const d of Object.values(data.documents || {})) if (hit(`${d.name} ${d.ai?.data?.vendor || ''}`)) out.docs.push(d.id);
  return out;
}

export function deleteContact(id) {
  const data = getState();
  const l = contactLinks(id, data);
  setContactLinks(id, { projects: l.projects.map((p) => p.id), meetings: l.meetings.map((x) => `${x.p.id}/${x.m.id}`), todos: l.todos.map((x) => `${x.p.id}/${x.c.id}`), costs: l.costs.map((x) => `${x.p.id}/${x.k.id}`), docs: l.docs.map((d) => d.id) }, false);
  deleteDoc('contacts', id);
}

// keeps what the user entered and fills the gaps with what the web search found
export function mergeWebInfo(c, w) {
  const fill = (k, v) => (c[k] ? {} : typeof v === 'string' && v.trim() ? { [k]: v.trim().slice(0, 300) } : {});
  return {
    ...fill('website', w.website),
    ...fill('phone', w.phone),
    ...fill('email', w.email),
    ...fill('address', w.address),
    ...(typeof w.logoUrl === 'string' && /^https:\/\//.test(w.logoUrl) ? { logoUrl: w.logoUrl } : {}),
    web: {
      found: w.found !== false,
      description: String(w.description || '').slice(0, 800),
      services: (Array.isArray(w.services) ? w.services : []).map(String).slice(0, 12),
      hours: String(w.hours || '').slice(0, 200),
      rating: w.rating && Number(w.rating.value) ? { value: Number(w.rating.value), count: Number(w.rating.count) || null, source: String(w.rating.source || '').slice(0, 60) } : null,
      certifications: (Array.isArray(w.certifications) ? w.certifications : []).map(String).slice(0, 8),
      sources: (Array.isArray(w.sources) ? w.sources : []).filter((s) => s && /^https?:\/\//.test(s.url || '')).slice(0, 6).map((s) => ({ title: String(s.title || hostOf(s.url) || s.url).slice(0, 120), url: s.url })),
      confidence: ['hoch', 'mittel', 'niedrig'].includes(w.confidence) ? w.confidence : null,
      note: String(w.note || '').slice(0, 300),
      at: Date.now(),
    },
  };
}
