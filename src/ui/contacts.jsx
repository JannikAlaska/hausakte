// Contacts shown as business cards: read from a photo of a card or a screenshot, completed from the web by the AI,
// linked to meetings, to-dos, costs and documents, and collected per project as "Ansprechpartner".
import { Icon } from './icons.jsx';
import { Btn, IconBtn, Field, TextInput, Select, Pill, Drawer, Section, ConfirmBtn, Empty } from './common.jsx';
import { useAiAvailable } from './ai-ui.jsx';
import { toast, openDrawer, closeDrawer } from './state.js';
import { uploadFiles } from './documents.jsx';
import { aiReadImage, aiEnrichContact, aiLinkContact, aiErrorText, getLimits } from '../ai.js';
import { getState, updateDoc, fileUrl } from '../store.js';
import { GEWERKE, gewerk } from '../catalog.js';
import { createContact, updateContact, deleteContact, contactLinks, projectContacts, setContactLinks, linksByName, mergeWebInfo, logoCandidates, hostOf, contactTitle } from '../contacts.js';
import { patchProject } from '../actions.js';
import { fmtDate, fmtDayMonth } from '../util.js';

const { useState, useEffect, useRef } = React;

const TRADES = [...GEWERKE.map((g) => ({ value: g.key, label: g.name })), { value: 'beratung', label: 'Beratung / Planung' }, { value: 'behoerde', label: 'Behörde / Netzbetreiber' }, { value: 'sonstiges', label: 'Sonstiges' }];
const tradeName = (k) => TRADES.find((t) => t.value === k)?.label || '';
const tradeIcon = (k) => (k === 'beratung' ? 'info' : k === 'behoerde' ? 'building' : gewerk(k).icon || 'wrench');
const initials = (c) => (contactTitle(c).match(/\b[\wÄÖÜäöü]/g) || ['?']).slice(0, 2).join('').toUpperCase();
const hue = (s) => [...String(s || '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 17);
const telHref = (n) => `tel:${String(n).replace(/[^\d+]/g, '')}`;

// ---------- business card ----------
function Logo({ c, size = 44 }) {
  const urls = logoCandidates(c);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [urls.join('|')]);
  if (i < urls.length)
    return (
      <span className="bcard-logo" style={{ width: size, height: size }}>
        <img src={urls[i]} alt="" referrerPolicy="no-referrer" onError={() => setI(i + 1)} />
      </span>
    );
  return (
    <span className="bcard-logo is-initials" style={{ width: size, height: size, background: `hsl(${hue(contactTitle(c))} 45% 42%)` }}>
      {initials(c)}
    </span>
  );
}

export function ContactCard({ c, why, onClick, actions, busy }) {
  const tel = c.mobile || c.phone;
  return (
    <div className={`bcard ${onClick ? 'is-click' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={(e) => onClick && e.key === 'Enter' && onClick()}>
      <span className="bcard-stripe" style={{ background: `hsl(${hue(contactTitle(c))} 50% 45%)` }} />
      <div className="bcard-top">
        <Logo c={c} />
        <div className="bcard-co">
          <b>{c.company || c.name || 'Kontakt'}</b>
          {c.trade ? (
            <span>
              <Icon name={tradeIcon(c.trade)} size={12} /> {tradeName(c.trade)}
            </span>
          ) : null}
        </div>
        {c.web?.rating ? (
          <span className="bcard-rating" title={`${c.web.rating.source || 'Bewertung'}${c.web.rating.count ? ` · ${c.web.rating.count} Bewertungen` : ''}`}>
            ★ {String(c.web.rating.value).replace('.', ',')}
          </span>
        ) : null}
      </div>
      {c.company && c.name ? (
        <div className="bcard-person">
          <b>{c.name}</b>
          {c.role ? <span>{c.role}</span> : null}
        </div>
      ) : c.role ? (
        <div className="bcard-person">
          <span>{c.role}</span>
        </div>
      ) : null}
      <div className="bcard-lines">
        {tel ? (
          <a href={telHref(tel)} onClick={(e) => e.stopPropagation()}>
            <Icon name="send" size={12} /> {tel}
          </a>
        ) : null}
        {c.email ? (
          <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()}>
            <Icon name="file" size={12} /> {c.email}
          </a>
        ) : null}
        {c.website ? (
          <a href={/^https?:\/\//.test(c.website) ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            <Icon name="link" size={12} /> {hostOf(c.website) || c.website}
          </a>
        ) : null}
      </div>
      {busy ? (
        <div className="bcard-busy small">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>{' '}
          {busy}
        </div>
      ) : null}
      {why?.length ? (
        <div className="bcard-why">
          {why.slice(0, 3).map((w, i) => (
            <span key={i} className="pill">
              {w.length > 42 ? w.slice(0, 40) + '…' : w}
            </span>
          ))}
          {why.length > 3 ? <span className="pill">+{why.length - 3}</span> : null}
        </div>
      ) : null}
      {actions ? (
        <div className="bcard-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}

// ---------- AI steps ----------
const progress = new Map(); // contact id -> status text, shared by every view
const listeners = new Set();
const setProgress = (id, text) => {
  text ? progress.set(id, text) : progress.delete(id);
  listeners.forEach((fn) => fn());
};
function useProgress() {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return progress;
}

export async function linkContact(cid, { quiet } = {}) {
  const data = getState();
  const c = data.contacts[cid];
  if (!c) return 0;
  let links = linksByName(c, data);
  try {
    const r = await aiLinkContact(c, data);
    const valid = (key, ok) => (Array.isArray(r?.[key]) ? r[key].filter(ok) : []);
    const has = (pid, list, iid) => (data.projects[pid]?.[list] || []).some((x) => x.id === iid);
    const pair = (list) => (ref) => {
      const [pid, iid] = String(ref).split('/');
      return has(pid, list, iid);
    };
    links = {
      projects: valid('projects', (pid) => !!data.projects[pid]),
      meetings: [...new Set([...links.meetings, ...valid('meetings', pair('meetings'))])],
      todos: [...new Set([...links.todos, ...valid('todos', pair('constraints'))])],
      costs: [...new Set([...links.costs, ...valid('costs', pair('costs'))])],
      docs: [...new Set([...links.docs, ...valid('documents', (id) => !!data.documents[id])])],
    };
  } catch (e) {
    if (!quiet && e?.code !== 'not_granted') toast(`Verknüpfen per KI nicht möglich – nur nach Namen gesucht. ${aiErrorText(e)}`, 'warn', 5000);
  }
  return setContactLinks(cid, links);
}

export async function enrichContact(cid, { quiet } = {}) {
  const lim = await getLimits();
  if (!lim?.web) {
    if (!quiet) toast('Die Internet-Suche gibt es in der Online-Version der Hausakte (nicht in der Vorschau).', 'warn', 5000);
    return false;
  }
  const c = getState().contacts[cid];
  if (!c) return false;
  setProgress(cid, 'sucht im Internet …');
  try {
    const w = await aiEnrichContact(c, getState());
    updateContact(cid, mergeWebInfo(getState().contacts[cid] || c, w || {}));
    if (!quiet) toast(w?.found === false ? 'Im Internet nichts Eindeutiges gefunden' : 'Kontakt aus dem Internet ergänzt');
    return true;
  } catch (e) {
    if (!quiet) toast(aiErrorText(e), 'err');
    return false;
  } finally {
    setProgress(cid, null);
  }
}

// photo of a business card or a screenshot -> stored card document + contact, then linked and completed from the web
export async function importCards(files, { projectId } = {}) {
  const made = [];
  for (const file of [...files].filter((f) => f.type.startsWith('image/'))) {
    const tmp = `tmp-${Math.random().toString(36).slice(2)}`;
    setProgress(tmp, `liest „${file.name}“ …`);
    try {
      const r = await aiReadImage(file, 'contact');
      if (!r || (!r.name && !r.company)) {
        toast(`„${file.name}“: Keine Kontaktdaten erkannt.`, 'warn');
        continue;
      }
      const ids = [];
      await uploadFiles([file], { type: 'visitenkarte', projectId, ids, silent: true });
      const s = (v) => String(v || '').trim().slice(0, 200);
      const cid = createContact({
        name: s(r.name), company: s(r.company), role: s(r.role), trade: TRADES.some((t) => t.value === r.trade) ? r.trade : '',
        phone: s(r.phone), mobile: s(r.mobile), email: s(r.email), website: s(r.website), address: s(r.address), notes: String(r.notes || '').slice(0, 1000),
        cardDocId: ids[0] || null, source: 'karte',
      });
      if (ids[0]) updateDoc('documents', ids[0], (d) => ({ ...d, contactId: cid, name: `Visitenkarte ${s(r.company) || s(r.name)}` }), 50);
      if (projectId) setContactLinks(cid, { projects: [projectId] });
      made.push(cid);
      setProgress(tmp, null);
      setProgress(cid, 'verknüpft …');
      const n = await linkContact(cid, { quiet: true });
      setProgress(cid, null);
      toast(`Kontakt „${s(r.company) || s(r.name)}“ angelegt${n ? ` · ${n} Verknüpfung${n > 1 ? 'en' : ''}` : ''}`);
      enrichContact(cid, { quiet: true });
    } catch (e) {
      toast(`„${file.name}“: ${aiErrorText(e)}`, 'err', 5000);
    } finally {
      setProgress(tmp, null);
    }
  }
  return made;
}

function AddContactBar({ projectId, onManual }) {
  const avail = useAiAvailable();
  const input = useRef(null);
  return (
    <div className="contact-add">
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) importCards(f, { projectId }); }} />
      {avail !== false ? (
        <Btn kind="primary" icon="camera" onClick={() => input.current?.click()}>
          Visitenkarte oder Screenshot
        </Btn>
      ) : null}
      <Btn kind="ghost" icon="plus" onClick={onManual}>
        Von Hand
      </Btn>
    </div>
  );
}

function PendingCards() {
  const prog = useProgress();
  const pending = [...prog.entries()].filter(([id]) => id.startsWith('tmp-'));
  return pending.map(([id, text]) => (
    <div key={id} className="bcard is-pending">
      <div className="bcard-busy small">
        <span className="dots">
          <i />
          <i />
          <i />
        </span>{' '}
        KI {text}
      </div>
    </div>
  ));
}

// ---------- list (Dokumente › Kontakte) ----------
export function ContactsPanel({ data }) {
  const prog = useProgress();
  const [q, setQ] = useState('');
  const all = Object.values(data.contacts || {}).sort((a, b) => contactTitle(a).localeCompare(contactTitle(b), 'de'));
  const s = q.trim().toLowerCase();
  const list = s ? all.filter((c) => `${c.name} ${c.company} ${c.role} ${tradeName(c.trade)} ${c.email} ${c.phone} ${c.mobile}`.toLowerCase().includes(s)) : all;
  const manual = () => openDrawer({ type: 'contact', id: createContact({ source: 'manuell' }) });
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="meet-intro">
        <div>
          <b>Kontakte</b>
          <p className="small muted">Foto einer Visitenkarte oder Screenshot hochladen – die KI liest den Kontakt aus, verknüpft ihn mit Besprechungen, Angeboten und To-dos und ergänzt Logo, Webseite und Infos aus dem Internet.</p>
        </div>
        <AddContactBar onManual={manual} />
      </div>
      {all.length > 6 ? (
        <div className="search-inline">
          <Icon name="search" size={15} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kontakte durchsuchen" aria-label="Kontakte durchsuchen" />
        </div>
      ) : null}
      <div className="bcard-grid">
        <PendingCards />
        {list.map((c) => (
          <ContactCard key={c.id} c={c} busy={prog.get(c.id)} onClick={() => openDrawer({ type: 'contact', id: c.id })} />
        ))}
      </div>
      {!all.length ? <p className="small muted">Noch keine Kontakte.</p> : null}
    </div>
  );
}

// ---------- project tab ----------
export function ProjectContacts({ p, data }) {
  const prog = useProgress();
  const list = projectContacts(p, data);
  const others = Object.values(data.contacts || {}).filter((c) => !list.some((x) => x.c.id === c.id));
  const manual = () => {
    const id = createContact({ source: 'manuell' });
    setContactLinks(id, { projects: [p.id] });
    openDrawer({ type: 'contact', id });
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="meet-intro">
        <div>
          <b>Ansprechpartner</b>
          <p className="small muted">Alle Kontakte, die an diesem Projekt beteiligt sind – aus Besprechungen, Angeboten, Kosten und To-dos oder direkt zugeordnet.</p>
        </div>
        <AddContactBar projectId={p.id} onManual={manual} />
      </div>
      {others.length ? (
        <select className="input select dep-select" value="" onChange={(e) => { if (e.target.value) { setContactLinks(e.target.value, { projects: [p.id] }); toast('Kontakt zugeordnet'); } }} aria-label="Vorhandenen Kontakt zuordnen">
          <option value="">+ Vorhandenen Kontakt zuordnen</option>
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              {contactTitle(c)}
              {c.company && c.name ? ` – ${c.name}` : ''}
            </option>
          ))}
        </select>
      ) : null}
      <div className="bcard-grid">
        <PendingCards />
        {list.map(({ c, why, explicit }) => (
          <ContactCard
            key={c.id}
            c={c}
            why={why}
            busy={prog.get(c.id)}
            onClick={() => openDrawer({ type: 'contact', id: c.id })}
            actions={explicit ? <IconBtn icon="x" label="Vom Projekt lösen" size={14} onClick={() => setContactLinks(c.id, { projects: [p.id] }, false)} /> : null}
          />
        ))}
      </div>
      {!list.length ? <p className="small muted">Noch keine Ansprechpartner. Lade eine Visitenkarte hoch oder ordne einen vorhandenen Kontakt zu.</p> : null}
    </div>
  );
}

// ---------- detail drawer ----------
export function ContactDrawer({ data, drawer }) {
  const c = data.contacts?.[drawer.id];
  const prog = useProgress();
  const avail = useAiAvailable();
  const [web, setWeb] = useState(null);
  const [linking, setLinking] = useState(false);
  useEffect(() => {
    getLimits().then((l) => setWeb(!!l?.web));
  }, []);
  if (!c)
    return (
      <Drawer title="Kontakt nicht gefunden" onClose={closeDrawer}>
        <Empty title="Dieser Kontakt existiert nicht mehr." />
      </Drawer>
    );
  const set = (patch) => updateContact(c.id, patch);
  const l = contactLinks(c.id, data);
  const card = c.cardDocId ? data.documents?.[c.cardDocId] : null;
  const total = l.projects.length + l.meetings.length + l.todos.length + l.costs.length + l.docs.length;
  const unlink = (links) => setContactLinks(c.id, links, false);
  const busy = prog.get(c.id);
  return (
    <Drawer
      eyebrow={`Kontakt${c.trade ? ' · ' + tradeName(c.trade) : ''}`}
      title={contactTitle(c)}
      icon="tag"
      onClose={closeDrawer}
      className="contact-drawer"
      footer={
        <>
          <ConfirmBtn confirmText="Kontakt löschen?" onConfirm={() => { deleteContact(c.id); closeDrawer(); toast('Kontakt gelöscht'); }} />
          {avail !== false ? (
            <Btn kind="ai" icon="sparkles" disabled={!!busy || web === false} onClick={() => enrichContact(c.id)} title={web === false ? 'Nur in der Online-Version' : ''}>
              {busy || 'Im Internet ergänzen'}
            </Btn>
          ) : null}
        </>
      }
    >
      <ContactCard c={c} busy={busy} />

      {c.web ? (
        <Section title="Aus dem Internet" aside={c.web.at ? `Stand ${fmtDate(new Date(c.web.at).toISOString().slice(0, 10))}` : null}>
          {c.web.found === false ? <p className="small muted">Nichts Eindeutiges gefunden.{c.web.note ? ` ${c.web.note}` : ''}</p> : null}
          {c.web.description ? <p className="meet-summary">{c.web.description}</p> : null}
          {c.web.services?.length ? (
            <div className="chips">
              {c.web.services.map((x, i) => (
                <span key={i} className="pill">
                  {x}
                </span>
              ))}
            </div>
          ) : null}
          <div>
            {c.web.hours ? <div className="kv"><span>Öffnungszeiten</span><b>{c.web.hours}</b></div> : null}
            {c.web.rating ? <div className="kv"><span>Bewertung</span><b>★ {String(c.web.rating.value).replace('.', ',')}{c.web.rating.count ? ` (${c.web.rating.count})` : ''}{c.web.rating.source ? ` · ${c.web.rating.source}` : ''}</b></div> : null}
            {c.web.certifications?.length ? <div className="kv"><span>Qualifikationen</span><b>{c.web.certifications.join(', ')}</b></div> : null}
            {c.web.confidence ? <div className="kv"><span>Treffer</span><b>{c.web.confidence === 'hoch' ? 'sicher' : c.web.confidence === 'mittel' ? 'wahrscheinlich' : 'unsicher'}</b></div> : null}
          </div>
          {c.web.note && c.web.found !== false ? <p className="small muted">{c.web.note}</p> : null}
          {c.web.sources?.length ? (
            <p className="small muted">
              Quellen:{' '}
              {c.web.sources.map((s, i) => (
                <span key={i}>
                  {i ? ' · ' : ''}
                  <a className="link" href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>
                </span>
              ))}
            </p>
          ) : null}
        </Section>
      ) : null}

      <Section title="Verknüpft" aside={total ? `${total}` : null}>
        {l.projects.length ? (
          <div className="chips">
            {l.projects.map((p) => (
              <span key={p.id} className="chip is-on">
                <button type="button" className="link" onClick={() => openDrawer({ type: 'project', id: p.id, tab: 'ansprechpartner' })}>
                  {p.title}
                </button>
                <button type="button" className="link" aria-label="Lösen" onClick={() => unlink({ projects: [p.id] })}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <ul className="meet-derived link-list">
          {l.meetings.map(({ p, m }) => (
            <li key={m.id}>
              <Icon name="mic" size={13} />
              <button type="button" className="link" onClick={() => openDrawer({ type: 'project', id: p.id, tab: 'besprechungen' })}>
                {m.title} · {fmtDayMonth(m.date)} <span className="muted">({p.title})</span>
              </button>
              <IconBtn icon="x" label="Lösen" size={13} onClick={() => unlink({ meetings: [`${p.id}/${m.id}`] })} />
            </li>
          ))}
          {l.todos.map(({ p, c: t }) => (
            <li key={t.id} className={t.done ? 'is-done' : ''}>
              <Icon name="checkCircle" size={13} />
              <button type="button" className="link" onClick={() => openDrawer({ type: 'project', id: p.id, tab: 'aufgaben' })}>
                {t.text}
                {t.due ? ` · bis ${fmtDayMonth(t.due)}` : ''} <span className="muted">({p.title})</span>
              </button>
              <IconBtn icon="x" label="Lösen" size={13} onClick={() => unlink({ todos: [`${p.id}/${t.id}`] })} />
            </li>
          ))}
          {l.costs.map(({ p, k }) => (
            <li key={k.id}>
              <Icon name="euro" size={13} />
              <button type="button" className="link" onClick={() => openDrawer({ type: 'project', id: p.id, tab: 'kosten' })}>
                {k.label} <span className="muted">({p.title})</span>
              </button>
              <IconBtn icon="x" label="Lösen" size={13} onClick={() => unlink({ costs: [`${p.id}/${k.id}`] })} />
            </li>
          ))}
          {l.docs.map((d) => (
            <li key={d.id}>
              <Icon name="file" size={13} />
              <a className="link" href={fileUrl(d) || undefined} target="_blank" rel="noopener noreferrer">
                {d.name}
              </a>
              <IconBtn icon="x" label="Lösen" size={13} onClick={() => unlink({ docs: [d.id] })} />
            </li>
          ))}
        </ul>
        {!total ? <p className="small muted">Noch nichts verknüpft.</p> : null}
        <div className="hstack" style={{ flexWrap: 'wrap' }}>
          {avail !== false ? (
            <Btn small kind="ghost" icon="sparkles" disabled={linking} onClick={async () => { setLinking(true); const n = await linkContact(c.id); setLinking(false); toast(n ? `${n} Verknüpfung${n > 1 ? 'en' : ''} gesetzt` : 'Keine neuen Verknüpfungen gefunden'); }}>
              {linking ? 'Sucht …' : 'Verknüpfungen suchen'}
            </Btn>
          ) : null}
          <select className="input select dep-select" value="" onChange={(e) => e.target.value && setContactLinks(c.id, { projects: [e.target.value] })} aria-label="Projekt zuordnen">
            <option value="">+ Projekt zuordnen</option>
            {Object.values(data.projects || {})
              .filter((p) => !p.archived && !(p.contactIds || []).includes(c.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
          </select>
        </div>
      </Section>

      <Section title="Kontaktdaten">
        <div className="grid2">
          <Field label="Firma">
            <TextInput id={'ct-company-' + c.id} value={c.company} onChange={(v) => set({ company: v })} />
          </Field>
          <Field label="Name">
            <TextInput id={'ct-name-' + c.id} value={c.name} onChange={(v) => set({ name: v })} />
          </Field>
          <Field label="Funktion">
            <TextInput id={'ct-role-' + c.id} value={c.role} onChange={(v) => set({ role: v })} placeholder="z. B. Elektromeister" />
          </Field>
          <Field label="Gewerk">
            <Select value={c.trade || ''} onChange={(v) => set({ trade: v })} options={[{ value: '', label: '–' }, ...TRADES]} />
          </Field>
          <Field label="Telefon">
            <TextInput id={'ct-phone-' + c.id} value={c.phone} onChange={(v) => set({ phone: v })} />
          </Field>
          <Field label="Mobil">
            <TextInput id={'ct-mobile-' + c.id} value={c.mobile} onChange={(v) => set({ mobile: v })} />
          </Field>
          <Field label="E-Mail">
            <TextInput id={'ct-email-' + c.id} value={c.email} onChange={(v) => set({ email: v })} />
          </Field>
          <Field label="Webseite">
            <TextInput id={'ct-web-' + c.id} value={c.website} onChange={(v) => set({ website: v })} />
          </Field>
        </div>
        <Field label="Adresse">
          <TextInput id={'ct-addr-' + c.id} value={c.address} onChange={(v) => set({ address: v })} />
        </Field>
        <Field label="Notizen">
          <TextInput id={'ct-notes-' + c.id} multiline rows={3} value={c.notes} onChange={(v) => set({ notes: v })} />
        </Field>
      </Section>

      {card && fileUrl(card) ? (
        <Section title="Visitenkarte">
          <img className="card-photo" src={fileUrl(card)} alt={`Visitenkarte ${contactTitle(c)}`} />
        </Section>
      ) : null}
    </Drawer>
  );
}
