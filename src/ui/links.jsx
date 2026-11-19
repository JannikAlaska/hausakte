// "Verknüpft mit": the same section in every detail view (room, component, project, contact, invoice).
// It lists what belongs together – projects, rooms, components, contacts, invoices, documents, photos and dates –
// and every entry opens in its own drawer, so one can walk from thing to thing.
import { Icon } from './icons.jsx';
import { Section } from './common.jsx';
import { openDrawer, toast } from './state.js';
import { openViewer, photoSrc } from './photos.jsx';
import { fileUrl } from '../store.js';
import { findSpot } from '../photos.js';
import { contactLinks, contactTitle, projectContacts } from '../contacts.js';
import { invOf, invTotal } from '../invoices.js';
import { componentWear } from '../metrics.js';
import { projectKind, status as statusOf } from '../catalog.js';
import { fmtDate, fmtEuro, todayISO, isISO } from '../util.js';

const uniq = (list, key = (x) => x.id) => {
  const seen = new Set();
  return list.filter((x) => x && !seen.has(key(x)) && seen.add(key(x)));
};
const docs = (data) => Object.values(data.documents || {});
const roomOf = (data, floorId, roomId) => data.floors?.[floorId]?.rooms?.find((r) => r.id === roomId) || null;
const roomOfComp = (data, c) => (c?.floorId && c?.roomId ? { f: data.floors?.[c.floorId], r: roomOf(data, c.floorId, c.roomId) } : null);
const DOC_SKIP = new Set(['foto', 'rechnung', 'antrag', 'handschrift']);

// dates of a project still ahead (or recently passed)
function projectDates(p, today) {
  const out = [];
  if (p.start) out.push({ date: p.start, label: `${p.title}: Beginn` });
  if (p.end) out.push({ date: p.end, label: `${p.title}: Ende` });
  for (const m of p.milestones || []) if (m.date && !m.done) out.push({ date: m.date, label: `${p.title}: ${m.title || 'Meilenstein'}` });
  for (const m of p.meetings || []) if (m.date && m.date >= today) out.push({ date: m.date, label: `${p.title}: ${m.title || 'Besprechung'}` });
  for (const c of p.constraints || []) if (c.due && !c.done) out.push({ date: c.due, label: `To-do: ${c.text}` });
  for (const f of p.funding || []) if (f.deadline) out.push({ date: f.deadline, label: `Frist ${f.program || 'Förderung'}` });
  return out;
}

export function linksOf(data, ref) {
  const today = todayISO();
  const L = { projects: [], rooms: [], components: [], contacts: [], invoices: [], documents: [], photos: [], dates: [] };
  const projects = Object.values(data.projects || {});
  const comps = data.components || {};
  if (ref.type === 'room') {
    const cs = Object.values(comps).filter((c) => c.roomId === ref.roomId);
    const cids = new Set(cs.map((c) => c.id));
    L.components = cs;
    L.projects = projects.filter((p) => (p.components || []).some((id) => cids.has(id)));
    L.photos = docs(data).filter((d) => d.type === 'foto' && ((d.spot && d.spot.floorId === ref.floorId && findSpot(data, d.spot.floorId, d.spot.spotId)?.room?.id === ref.roomId) || cids.has(d.componentId)));
    L.documents = docs(data).filter((d) => !DOC_SKIP.has(d.type) && cids.has(d.componentId));
    for (const c of cs) {
      const w = componentWear(c);
      if (w.due && w.state !== 'ok') L.dates.push({ date: `${w.due}-12-31`, year: w.due, label: `${c.name}: Austausch fällig` });
    }
    for (const p of L.projects.filter((p) => !p.archived)) L.dates.push(...projectDates(p, today));
  } else if (ref.type === 'component') {
    const c = comps[ref.id];
    if (!c) return L;
    const rr = roomOfComp(data, c);
    if (rr?.r) L.rooms = [{ ...rr.r, floor: rr.f }];
    L.projects = projects.filter((p) => (p.components || []).includes(c.id));
    L.photos = docs(data).filter((d) => d.type === 'foto' && d.componentId === c.id);
    L.documents = docs(data).filter((d) => !DOC_SKIP.has(d.type) && d.componentId === c.id);
    L.invoices = docs(data).filter((d) => d.type === 'rechnung' && d.componentId === c.id);
    const w = componentWear(c);
    if (w.due) L.dates.push({ date: `${w.due}-12-31`, year: w.due, label: `Austausch laut Lebensdauer (${c.life} J.)` });
    for (const p of L.projects.filter((p) => !p.archived)) L.dates.push(...projectDates(p, today));
  } else if (ref.type === 'project') {
    const p = data.projects?.[ref.id];
    if (!p) return L;
    L.components = (p.components || []).map((id) => comps[id]).filter(Boolean);
    L.rooms = uniq(L.components.map((c) => roomOfComp(data, c)).filter((x) => x?.r).map((x) => ({ ...x.r, floor: x.f })));
    L.contacts = projectContacts(p, data).map((e) => e.c);
    const own = docs(data).filter((d) => d.projectId === p.id);
    L.invoices = own.filter((d) => d.type === 'rechnung');
    L.photos = own.filter((d) => d.type === 'foto');
    L.documents = own.filter((d) => !DOC_SKIP.has(d.type) || d.type === 'antrag');
    L.projects = uniq([...(p.dependsOn || []).map((r) => data.projects?.[String(r).split('#')[0]]), ...projects.filter((x) => (x.dependsOn || []).some((r) => String(r).split('#')[0] === p.id))]).filter((x) => x.id !== p.id);
    L.dates = projectDates(p, today);
    for (const d of L.invoices) if (invOf(d).due && invOf(d).status !== 'bezahlt') L.dates.push({ date: invOf(d).due, label: `Zahlung: ${d.name}` });
  } else if (ref.type === 'contact') {
    const k = contactLinks(ref.id, data);
    L.projects = uniq([...k.projects, ...k.meetings.map((x) => x.p), ...k.todos.map((x) => x.p), ...k.costs.map((x) => x.p)]);
    L.invoices = k.docs.filter((d) => d.type === 'rechnung');
    L.photos = k.docs.filter((d) => d.type === 'foto');
    L.documents = k.docs.filter((d) => !['rechnung', 'foto'].includes(d.type));
    for (const { p, m } of k.meetings) if (m.date) L.dates.push({ date: m.date, label: `${m.title || 'Besprechung'} (${p.title})` });
    for (const { p, c } of k.todos) if (c.due && !c.done) L.dates.push({ date: c.due, label: `To-do: ${c.text} (${p.title})` });
    for (const d of L.invoices) if (invOf(d).due && invOf(d).status !== 'bezahlt') L.dates.push({ date: invOf(d).due, label: `Zahlung: ${d.name}` });
  } else if (ref.type === 'invoice') {
    const d = data.documents?.[ref.id];
    if (!d) return L;
    const i = invOf(d);
    if (d.projectId && data.projects?.[d.projectId]) L.projects = [data.projects[d.projectId]];
    if (d.contactId && data.contacts?.[d.contactId]) L.contacts = [data.contacts[d.contactId]];
    if (d.componentId && comps[d.componentId]) L.components = [comps[d.componentId]];
    // the other invoices from the same sender
    if (d.contactId) L.invoices = docs(data).filter((x) => x.type === 'rechnung' && x.id !== d.id && x.contactId === d.contactId);
    if (isISO(i.date || d.date)) L.dates.push({ date: i.date || d.date, label: 'Rechnungsdatum' });
    if (isISO(i.due)) L.dates.push({ date: i.due, label: i.status === 'bezahlt' ? 'war fällig' : 'fällig' });
    if (isISO(i.paidAt)) L.dates.push({ date: i.paidAt, label: 'bezahlt' });
  }
  L.dates = uniq(L.dates.filter((x) => isISO(x.date)), (x) => x.date + x.label).sort((a, b) => (a.date < b.date ? -1 : 1));
  // past dates only for invoices; elsewhere the upcoming ones (and the last two passed) are enough
  if (ref.type !== 'invoice') {
    const past = L.dates.filter((x) => x.date < today && !x.year).slice(-2);
    L.dates = [...past, ...L.dates.filter((x) => x.date >= today || x.year)].slice(0, 8);
  }
  return L;
}

const openDoc = (d) => {
  if (d.type === 'rechnung') return openDrawer({ type: 'invoice', id: d.id });
  if (d.type === 'antrag') return openDrawer({ type: 'application', id: d.id });
  const u = fileUrl(d);
  if (u) window.open(u, '_blank', 'noopener');
  else toast('Die Datei wird geladen – gleich noch einmal tippen.');
};

function Chip({ icon, title, sub, onClick, tone }) {
  return (
    <button type="button" className={`link-chip ${tone ? 'tone-' + tone : ''}`} onClick={onClick}>
      <Icon name={icon} size={14} />
      <span className="link-chip-txt">
        <b>{title}</b>
        {sub ? <span>{sub}</span> : null}
      </span>
    </button>
  );
}

// ref: { type: 'room', floorId, roomId } | { type: 'component' | 'project' | 'contact' | 'invoice', id }
export function LinkedWith({ data, refTo, n, skip = [], children }) {
  const L = linksOf(data, refTo);
  const today = todayISO();
  const show = (k) => !skip.includes(k) && L[k].length;
  const groups = [
    show('projects') && {
      k: 'projects',
      label: 'Projekte',
      body: L.projects.map((p) => <Chip key={p.id} icon={projectKind(p.kind).icon} title={p.title} sub={p.archived ? 'deaktiviert' : statusOf(p.status).name} onClick={() => openDrawer({ type: 'project', id: p.id })} />),
    },
    show('rooms') && {
      k: 'rooms',
      label: 'Räume',
      body: L.rooms.map((r) => <Chip key={r.id} icon="room" title={r.name || 'Raum'} sub={r.floor?.short || r.floor?.name} onClick={() => openDrawer({ type: 'room', floorId: r.floor.id, roomId: r.id })} />),
    },
    show('components') && {
      k: 'components',
      label: 'Bauteile',
      body: L.components.map((c) => {
        const w = componentWear(c);
        return <Chip key={c.id} icon="wrench" title={c.name} sub={w.state === 'faellig' ? 'fällig' : w.state === 'bald' ? 'bald fällig' : c.year ? `Bj. ${c.year}` : ''} tone={w.state === 'faellig' ? 'warn' : null} onClick={() => openDrawer({ type: 'component', id: c.id })} />;
      }),
    },
    show('contacts') && {
      k: 'contacts',
      label: 'Kontakte',
      body: L.contacts.map((c) => <Chip key={c.id} icon="tag" title={contactTitle(c)} sub={c.company && c.name ? c.name : c.role} onClick={() => openDrawer({ type: 'contact', id: c.id })} />),
    },
    show('invoices') && {
      k: 'invoices',
      label: 'Rechnungen',
      body: L.invoices.map((d) => <Chip key={d.id} icon="euro" title={d.name} sub={[fmtEuro(invTotal(d)), invOf(d).status === 'bezahlt' ? 'bezahlt' : 'offen'].join(' · ')} onClick={() => openDrawer({ type: 'invoice', id: d.id })} />),
    },
    show('documents') && {
      k: 'documents',
      label: 'Dokumente',
      body: L.documents.slice(0, 12).map((d) => <Chip key={d.id} icon={d.type === 'antrag' ? 'flag' : 'file'} title={d.name} sub={d.date ? fmtDate(d.date) : ''} onClick={() => openDoc(d)} />),
    },
    show('photos') && {
      k: 'photos',
      label: 'Fotos',
      body: (
        <div className="link-photos">
          {L.photos.slice(0, 8).map((d, i) => {
            const src = photoSrc(d);
            return (
              <button key={d.id} type="button" className="link-photo" onClick={() => openViewer(L.photos.map((x) => x.id), i)} aria-label={`Foto ${d.name} öffnen`}>
                {src ? <img src={src} alt="" loading="lazy" /> : <Icon name="camera" size={16} />}
              </button>
            );
          })}
          {L.photos.length > 8 ? <span className="small muted">+{L.photos.length - 8}</span> : null}
        </div>
      ),
    },
    show('dates') && {
      k: 'dates',
      label: 'Termine',
      body: (
        <ul className="link-dates">
          {L.dates.map((x, i) => (
            <li key={i} className={x.date < today && !x.year ? 'is-past' : ''}>
              <span className="link-date">{x.year ? String(x.year) : fmtDate(x.date)}</span>
              <span>{x.label}</span>
            </li>
          ))}
        </ul>
      ),
    },
  ].filter(Boolean);
  const total = groups.length;
  return (
    <Section n={n} title="Verknüpft mit" aside={total ? null : <span className="small muted">noch nichts</span>}>
      {total ? (
        <div className="links">
          {groups.map((g) => (
            <div key={g.k} className="link-group">
              <span className="link-label">
                {g.label} <em>{L[g.k].length}</em>
              </span>
              <div className="link-items">{g.body}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="small muted">Noch keine Verknüpfungen. Sie entstehen von selbst, wenn du z. B. ein Bauteil einem Projekt zuordnest, ein Foto an dieser Stelle machst oder ein Dokument hochlädst.</p>
      )}
      {children}
    </Section>
  );
}
