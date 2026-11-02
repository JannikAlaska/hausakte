// Cockpit: the start page. What happens today, the next dates, what needs attention, schedule,
// money, energy and the house at a glance – with quick actions for the things done on site.
import { Icon } from './icons.jsx';
import { Btn, IconBtn, TextInput, Select, DateInput } from './common.jsx';
import { useUI, setUI, go, openDrawer, toast } from './state.js';
import { InvoiceCapture } from './invoices.jsx';
import { NoteComposer } from './notes.jsx';
import { SpeechRec } from './meetings.jsx';
import { greeting, headline, agenda, attention, roadmap, budget, invoicesSummary, energy, houseFloors, progress, longDate, wdm, dm, inDays, fmtCents } from '../cockpit.js';
import { liveProjects, isDone } from '../metrics.js';
import { ENERGY_CLASSES } from '../catalog.js';
import { invOf, invOpen, invTotal, invVendor, isOverdue } from '../invoices.js';
import { patchProject } from '../actions.js';
import { fmtEuro, fmtNum, todayISO, uid } from '../util.js';

const { useState, useMemo, useRef, useEffect } = React;

const KIND_ICON = { start: 'bolt', running: 'bolt', end: 'check', milestone: 'flag', funding: 'euro', todo: 'checkCircle', invoice: 'euro' };
const KIND_TONE = { start: 'accent', running: 'accent', end: 'neutral', milestone: 'warn', funding: 'warn', todo: 'neutral', invoice: 'info' };

const openItem = (it) => {
  if (it.docId) return openDrawer({ type: 'invoice', id: it.docId });
  if (it.project) return openDrawer({ type: 'project', id: it.project.id, tab: it.tab });
};
const runAction = (a) => {
  if (!a) return;
  if (a.drawer) openDrawer(a.drawer);
  else if (a.go) go(a.go);
};
const showInvoices = () => {
  setUI({ docTab: 'rechnungen' });
  go('dokumente');
};

export function CockpitPage({ data }) {
  const ui = useUI();
  const today = todayISO();
  const [panel, setPanel] = useState(null);
  const cam = useRef(null);
  const v = useMemo(
    () => ({
      head: headline(data, today),
      ag: agenda(data, today),
      att: attention(data, today),
      rm: roadmap(data, today),
      bud: budget(data),
      inv: invoicesSummary(data, today),
      en: energy(data),
      floors: houseFloors(data),
      pr: progress(data, today),
    }),
    [data.projects, data.documents, data.components, data.floors, data.readings, data.house, data.contacts, today],
  );
  const h = data.house || {};
  const takePhoto = (e) => {
    const files = [...e.target.files].filter((f) => f.type !== 'application/pdf');
    e.target.value = '';
    if (files.length) setPanel({ type: 'invoice', files });
  };
  const sub = [h.name, h.city, [h.construction, h.houseType].filter(Boolean).join('-') + (h.buildYear ? ` von ${h.buildYear}` : ''), v.en.cls ? `Energieklasse ${v.en.cls.c}` : null].filter((x) => x && x.trim()).join(' · ');
  return (
    <section className="cockpit" aria-label="Cockpit">
      <div className="ck-inner">
        <header className="ck-hero">
          <div className="ck-hello">
            <span className="ck-date">{longDate(today)}</span>
            <h1>
              {greeting()} – {v.head}
            </h1>
            {sub ? <span className="ck-addr">{sub}</span> : null}
          </div>
          <div className="ck-quick" role="group" aria-label="Schnellaktionen">
            <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={takePhoto} />
            <button type="button" className="ck-qa is-primary" onClick={() => cam.current?.click()}>
              <Icon name="camera" size={20} />
              <span>
                Rechnung <em>fotografieren</em>
              </span>
            </button>
            <button type="button" className={`ck-qa ${panel === 'note' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'note' ? null : 'note')}>
              <Icon name="mic" size={20} />
              <span>
                Notiz <em>{SpeechRec ? 'sprechen' : 'schreiben'}</em>
              </span>
            </button>
            <button type="button" className={`ck-qa ${panel === 'todo' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'todo' ? null : 'todo')}>
              <Icon name="tasks" size={20} />
              <span>
                To-do <em>anlegen</em>
              </span>
            </button>
          </div>
        </header>

        {panel ? (
          <div className="ck-panel">
            {panel === 'note' ? <NoteComposer autoStart onClose={() => setPanel(null)} /> : null}
            {panel === 'todo' ? <TodoComposer data={data} onClose={() => setPanel(null)} /> : null}
            {panel?.type === 'invoice' ? <InvoiceCapture initialPages={panel.files} onClose={() => setPanel(null)} /> : null}
          </div>
        ) : null}

        <Kpis v={v} />

        <div className="ck-grid">
          <div className="ck-main">
            <Agenda ag={v.ag} />
            <Roadmap rm={v.rm} />
            <Budget bud={v.bud} />
          </div>
          <aside className="ck-side">
            <Attention list={v.att} />
            <Invoices inv={v.inv} data={data} today={today} />
            <Energy en={v.en} />
            <House floors={v.floors} />
          </aside>
        </div>
      </div>
    </section>
  );
}

function Kpis({ v }) {
  const { pr, bud, inv, ag, en } = v;
  const next = ag.next;
  const ring = pr.total ? Math.max(0.02, pr.done / pr.total) : 0;
  const C = 2 * Math.PI * 26;
  const prSub = [pr.running ? `${pr.running} in Umsetzung` : null, pr.startingToday ? `${pr.startingToday} startet heute` : null, pr.planning ? `${pr.planning} in Planung` : null].filter(Boolean).join(' · ') || 'noch nichts geplant';
  const warnNext = next && next.days <= 21;
  return (
    <section className="ck-kpis" aria-label="Kennzahlen">
      <button type="button" className="ck-kpi ck-kpi-progress" onClick={() => go('projekte')}>
        <span className="ck-ring">
          <svg role="img" aria-label={`${pr.done} von ${pr.total} Projekten abgeschlossen`} viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="26" className="ck-ring-bg" />
            <circle cx="32" cy="32" r="26" className="ck-ring-fg" strokeDasharray={`${ring * C} ${C}`} transform="rotate(-90 32 32)" />
          </svg>
          <b>
            {pr.done}/{pr.total}
          </b>
        </span>
        <span className="ck-kpi-txt">
          <span className="ck-label">Modernisierung</span>
          <b className="ck-kpi-main">
            {pr.done} von {pr.total} fertig
          </b>
          <span className="ck-kpi-sub">{prSub}</span>
        </span>
      </button>
      <button type="button" className="ck-kpi" onClick={() => go('projekte')}>
        <span className="ck-label">Budget</span>
        <b className="ck-big">{fmtEuro(bud.planned)}</b>
        <span className="ck-meter" aria-hidden="true">
          <span style={{ width: `${bud.planned ? Math.min(100, (bud.paid / bud.planned) * 100) : 0}%` }} />
        </span>
        <span className="ck-kpi-sub">
          {bud.paid ? `${fmtEuro(bud.paid)} ausgegeben` : 'noch nichts ausgegeben'} · Förderung {fmtEuro(bud.funding)}
        </span>
      </button>
      <button type="button" className={`ck-kpi ${inv.sums.overdueN ? 'is-danger' : ''}`} onClick={showInvoices}>
        <span className="ck-label">{inv.sums.overdueN ? 'Rechnungen überfällig' : 'Offene Rechnungen'}</span>
        <b className="ck-big">{fmtCents(inv.sums.overdueN ? inv.sums.overdue : inv.sums.open)}</b>
        <span className="ck-kpi-sub">
          {inv.sums.count
            ? [inv.sums.openN ? `${inv.sums.openN} offen` : 'alle bezahlt', inv.nextDue ? `fällig ${dm(invOf(inv.nextDue).due)}` : null, inv.sums.paid ? `bezahlt ${fmtCents(inv.sums.paid)}` : null].filter(Boolean).join(' · ')
            : 'noch keine erfasst'}
        </span>
      </button>
      <button type="button" className={`ck-kpi ck-kpi-next ${warnNext ? 'is-warn' : ''}`} onClick={() => next && openItem(next)} disabled={!next}>
        <span className="ck-next-ico" aria-hidden="true">
          <Icon name={next ? KIND_ICON[next.kind] || 'flag' : 'calendar'} size={20} />
        </span>
        <span className="ck-kpi-txt">
          <span className="ck-label">{next ? `Nächster Termin · ${inDays(next.days)}` : 'Nächster Termin'}</span>
          <b className="ck-big">{next ? wdm(next.date) : '–'}</b>
          <span className="ck-kpi-sub">{next ? next.title : 'Keine offenen Termine'}</span>
        </span>
      </button>
      <button type="button" className="ck-kpi" onClick={() => go('verbrauch')}>
        <span className="ck-label">Energie</span>
        <span className="ck-energy-val">
          <b className="ck-big">{en.value ? fmtNum(en.value, 1) : '–'}</b>
          <span className="ck-unit">kWh/m²a</span>
          {en.cls ? (
            <span className="ck-cls" style={{ background: en.cls.color }}>
              {en.cls.c}
            </span>
          ) : null}
        </span>
        <span className="ck-kpi-sub">{en.media.length ? `${en.lastYear}: ${en.media.slice(0, 2).map((m) => `${fmtNum(m.amount, 0)} ${m.unit} ${m.name}`).join(' · ')}` : en.source || 'Verbrauch erfassen'}</span>
      </button>
    </section>
  );
}

function Card({ id, title, link, onLink, children, className = '', extra }) {
  return (
    <section className={`ck-card ${className}`} aria-labelledby={id}>
      <div className="ck-card-head">
        <h2 id={id}>{title}</h2>
        {extra}
        {link ? (
          <button type="button" className="link" onClick={onLink}>
            {link}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function AgendaRow({ it, hot }) {
  const tone = KIND_TONE[it.kind] || 'neutral';
  return (
    <button type="button" className={`ck-ag ${hot ? 'is-hot' : ''}`} onClick={() => openItem(it)}>
      <span className="ck-ag-date">{hot ? 'Heute' : wdm(it.date)}</span>
      <span className={`ck-ag-ico tone-${hot ? 'solid' : tone}`}>
        <Icon name={KIND_ICON[it.kind] || 'calendar'} size={16} />
      </span>
      <span className="ck-ag-txt">
        <b>{it.title}</b>
        {it.sub ? <span>{it.sub}</span> : null}
      </span>
      <span className={`ck-ag-when ${hot ? 'is-accent' : it.days <= 21 && (it.kind === 'funding' || it.kind === 'milestone' || it.kind === 'invoice') ? 'is-warn' : ''}`}>{hot ? (it.project ? 'Projekt öffnen' : '') : inDays(it.days)}</span>
    </button>
  );
}

function Agenda({ ag }) {
  const [all, setAll] = useState(false);
  const soon = all ? ag.soon : ag.soon.slice(0, 6);
  const empty = !ag.today.length && !ag.soon.length && !ag.more.length && !ag.funding.length;
  return (
    <Card id="ck-next" title="Als Nächstes" className="ck-agenda" link={ag.soon.length > 6 ? (all ? 'Weniger' : `Alle ${ag.soon.length}`) : null} onLink={() => setAll(!all)}>
      {empty ? <p className="small muted">Keine Termine in den nächsten Wochen. Termine entstehen aus Projekten (Start, Ende, Meilensteine, To-dos mit Datum) und aus Rechnungen mit Fälligkeit.</p> : null}
      {ag.today.length ? (
        <>
          <span className="ck-sub">Heute</span>
          {ag.today.map((it, k) => (
            <AgendaRow key={'t' + k} it={it} hot />
          ))}
        </>
      ) : null}
      {soon.length ? (
        <>
          <span className="ck-sub">Nächste 6 Wochen</span>
          {soon.map((it, k) => (
            <AgendaRow key={'s' + k} it={it} />
          ))}
        </>
      ) : null}
      {ag.more.length ? (
        <>
          <span className="ck-sub">{soon.length ? 'Danach' : 'Demnächst'}</span>
          {ag.more.map((it, k) => (
            <AgendaRow key={'m' + k} it={it} />
          ))}
        </>
      ) : null}
      {ag.funding.length ? (
        <>
          <span className="ck-sub is-warn">Förderfristen</span>
          <div className="ck-fund">
            {ag.funding.slice(0, 4).map((it, k) => (
              <button type="button" key={'f' + k} className="ck-fund-card" onClick={() => openItem(it)}>
                <span className="ck-fund-when">
                  {wdm(it.date)}
                  {it.date.slice(0, 4)} · {inDays(it.days)}
                </span>
                <b>{it.title}</b>
                <span className="small muted">{it.sub}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </Card>
  );
}

function Attention({ list }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 5);
  return (
    <Card id="ck-attn" title="Braucht Aufmerksamkeit" className="ck-attn" link={list.length > 5 ? (all ? 'Weniger' : `Alle ${list.length}`) : null} onLink={() => setAll(!all)}>
      {!list.length ? (
        <p className="ck-allgood">
          <Icon name="checkCircle" size={18} /> Alles im grünen Bereich.
        </p>
      ) : (
        <div className="ck-attn-list">
          {shown.map((a, k) => (
            <button type="button" key={k} className={`ck-att is-${a.level}`} onClick={() => runAction(a.action)}>
              <Icon name={a.icon} size={18} />
              <span>
                <b>{a.title}</b>
                {a.sub ? <span>{a.sub}</span> : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function Roadmap({ rm }) {
  const year = (m) => (m.first ? String(m.year).slice(2) : '');
  return (
    <Card
      id="ck-plan"
      title={`Fahrplan ${rm.months[0].label} ${String(rm.months[0].year).slice(2)} – ${rm.months[rm.months.length - 1].label} ${String(rm.months[rm.months.length - 1].year).slice(2)}`}
      className="ck-roadmap"
      link="Zeitplan"
      onLink={() => go('projekte')}
    >
      {!rm.rows.length ? (
        <p className="small muted">In den nächsten zwölf Monaten ist kein Projekt mit Start- und Enddatum geplant.</p>
      ) : (
        <div className="ck-rm" style={{ '--today': `${rm.today}%` }}>
          <div className="ck-rm-row ck-rm-head" aria-hidden="true">
            <span />
            <span className="ck-rm-months">
              {rm.months.map((m) => (
                <span key={m.iso}>
                  {m.label}
                  {year(m) ? <small> {year(m)}</small> : null}
                </span>
              ))}
            </span>
          </div>
          {rm.rows.map((r) => (
            <button type="button" key={r.p.id} className="ck-rm-row" onClick={() => openDrawer({ type: 'project', id: r.p.id, tab: 'zeitplan' })} title={`${r.p.title}${r.range ? ': ' + r.range : ''}`}>
              <span className="ck-rm-name">{r.p.title}</span>
              <span className="ck-rm-track">
                {r.bar ? <span className={`ck-rm-bar tone-${r.tone}`} style={{ left: `${r.bar.left}%`, width: `${r.bar.width}%` }} /> : null}
                {r.marks.map((m, k) => (
                  <span key={k} className={`ck-rm-ms is-${m.kind}`} style={{ left: `${m.left}%` }} title={`${m.title} · ${dm(m.date)}${m.date.slice(0, 4)}`} />
                ))}
                <span className="ck-rm-today" />
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="ck-legend">
        <span>
          <i className="tone-active" />
          in Umsetzung
        </span>
        <span>
          <i className="tone-plan" />
          in Planung
        </span>
        <span>
          <i className="tone-idea" />
          Idee
        </span>
        <span>
          <i className="ck-lg-ms" />
          Meilenstein / Frist
        </span>
        <span>
          <i className="ck-lg-today" />
          heute
        </span>
        {rm.later ? <span>{rm.later} Projekt{rm.later > 1 ? 'e' : ''} später</span> : null}
      </div>
    </Card>
  );
}

function Budget({ bud }) {
  return (
    <Card id="ck-budget" title="Budget je Projekt" className="ck-budget" extra={<span className="ck-head-note">geplant {fmtEuro(bud.planned)} · Förderung {fmtEuro(bud.funding)} · Eigenanteil {fmtEuro(bud.own)}</span>}>
      {!bud.rows.length ? (
        <p className="small muted">Noch keine Kosten erfasst. Schätzungen und Angebote trägst du im Projekt unter „Kosten“ ein.</p>
      ) : (
        <div className="ck-bud">
          {bud.rows.map((r) => (
            <button type="button" key={r.p.id} className="ck-bud-row" onClick={() => openDrawer({ type: 'project', id: r.p.id, tab: 'kosten' })}>
              <span className="ck-bud-name">{r.p.title}</span>
              <span className="ck-bud-bar" aria-hidden="true">
                <span className="is-plan" style={{ width: `${(r.planned / bud.max) * 100}%` }} />
                {r.paid ? <span className="is-paid" style={{ width: `${(Math.min(r.paid, Math.max(r.planned, r.paid)) / bud.max) * 100}%` }} /> : null}
              </span>
              <span className="ck-bud-val">
                <b>{fmtEuro(r.planned)}</b>
                {r.paid ? <small>{fmtEuro(r.paid)} bezahlt</small> : null}
              </span>
            </button>
          ))}
        </div>
      )}
      {bud.missing.length ? <p className="small muted ck-foot">Ohne Kosten erfasst: {bud.missing.join(', ')}.</p> : null}
    </Card>
  );
}

function Invoices({ inv, data, today }) {
  const s = inv.sums;
  return (
    <Card id="ck-inv" title="Rechnungen" className="ck-inv" link={s.count ? `Alle ${s.count}` : 'Öffnen'} onLink={showInvoices}>
      <div className="ck-inv-sums">
        <span>
          <small>Offen</small>
          <b>{fmtCents(s.open)}</b>
        </span>
        <span className={s.overdue ? 'is-danger' : ''}>
          <small>Überfällig</small>
          <b>{fmtCents(s.overdue)}</b>
        </span>
        <span>
          <small>Bezahlt</small>
          <b>{fmtCents(s.paid)}</b>
        </span>
      </div>
      {inv.top.map((d) => {
        const i = invOf(d);
        const late = isOverdue(d, today);
        const st = i.status === 'bezahlt' ? 'Bezahlt' : late ? 'Überfällig' : i.status === 'teilbezahlt' ? 'Teilbezahlt' : 'Offen';
        const tone = i.status === 'bezahlt' ? 'accent' : late ? 'danger' : i.status === 'teilbezahlt' ? 'warn' : 'neutral';
        return (
          <button type="button" key={d.id} className="ck-inv-row" onClick={() => openDrawer({ type: 'invoice', id: d.id })}>
            <span className="ck-inv-txt">
              <b>{[invVendor(d, data) || d.name || 'Rechnung', i.number ? `Nr. ${i.number}` : null].filter(Boolean).join(' · ')}</b>
              <span>{i.status !== 'bezahlt' && i.due ? `fällig ${dm(i.due)} (${inDays(Math.round((new Date(i.due + 'T12:00') - new Date(today + 'T12:00')) / 864e5))})` : i.date ? `${dm(i.date)}${i.date.slice(0, 4)}` : ''}</span>
            </span>
            <span className="ck-inv-amt">
              <b>{fmtCents(i.status === 'bezahlt' ? invTotal(d) : invOpen(d))}</b>
              <span className={`pill pill-${tone}`}>{st}</span>
            </span>
          </button>
        );
      })}
      {!s.count ? <p className="small muted">Noch keine Rechnungen. Oben „Rechnung fotografieren“ – die KI liest Absender, Beträge und Fälligkeit aus.</p> : null}
    </Card>
  );
}

function Energy({ en }) {
  return (
    <Card id="ck-energy" title="Energie" className="ck-energy" link="Verbrauch" onLink={() => go('verbrauch')}>
      <div className="ck-ec" role="img" aria-label={en.cls ? `Effizienzklasse ${en.cls.c}` : 'Keine Effizienzklasse'}>
        {ENERGY_CLASSES.map((e) => (
          <span key={e.c} className={en.cls?.c === e.c ? 'is-on' : ''}>
            <i style={{ background: e.color }} />
            <small>{e.c}</small>
          </span>
        ))}
      </div>
      <div className="ck-en-rows">
        {en.value ? (
          <div>
            <span>{en.source || 'Kennwert'}</span>
            <b>{fmtNum(en.value, 1)} kWh/m²a</b>
          </div>
        ) : null}
        {en.measured && en.source !== `Verbrauch ${en.measured.year}` ? (
          <div>
            <span>Heizverbrauch {en.measured.year}</span>
            <b>{fmtNum(en.measured.perM2, 0)} kWh/m²</b>
          </div>
        ) : null}
        {en.media.map((m) => (
          <div key={m.key}>
            <span>
              {m.name} {en.lastYear}
            </span>
            <b>
              {fmtNum(m.amount, 0)} {m.unit}
            </b>
          </div>
        ))}
        {!en.value && !en.media.length ? <p className="small muted">Trage Zählerstände unter „Verbrauch“ oder den Energieausweis unter „Gebäude“ ein.</p> : null}
      </div>
    </Card>
  );
}

function House({ floors }) {
  const furn = floors.reduce((s, f) => s + f.furniture, 0);
  return (
    <Card
      id="ck-house"
      title="Haus"
      className="ck-house"
      extra={
        <button type="button" className="link ck-3d" onClick={() => go('modell')}>
          <Icon name="cube" size={15} /> 3D-Modell
        </button>
      }
    >
      <div className="ck-floors">
        {floors.map((x) => (
          <button
            type="button"
            key={x.f.id}
            className="ck-floor"
            onClick={() => {
              setUI({ floorId: x.f.id });
              go('grundriss');
            }}
            title={`Grundriss ${x.f.name} öffnen`}
          >
            <span className="ck-floor-short">{x.short}</span>
            <span className="ck-floor-name">
              {x.f.name} · {x.rooms} {x.rooms === 1 ? 'Raum' : 'Räume'}
              {x.furniture ? ` · ${x.furniture} Möbel` : ''}
            </span>
            <b>{fmtNum(x.area, 0)} m²</b>
          </button>
        ))}
      </div>
      <p className="small muted ck-foot">
        {furn ? `${furn} Möbel erfasst · ` : ''}Tippen öffnet den Grundriss der Etage.
      </p>
    </Card>
  );
}

// quick to-do: text, project and an optional date
function TodoComposer({ data, onClose }) {
  const today = todayISO();
  const projects = liveProjects(data.projects)
    .filter((p) => !isDone(p))
    .sort((a, b) => ((a.start || '9') < (b.start || '9') ? -1 : 1));
  const focus = projects.find((p) => p.start === today) || projects.find((p) => p.status === 'umsetzung') || projects.find((p) => (p.end || '') >= today) || projects[0];
  const [text, setText] = useState('');
  const [pid, setPid] = useState(focus?.id || '');
  const [due, setDue] = useState(null);
  const save = () => {
    const t = text.trim();
    if (!t || !pid) return;
    patchProject(pid, (p) => ({ ...p, constraints: [...(p.constraints || []), { id: uid('b'), text: t, kind: 'organisatorisch', done: false, due: due || null }] }));
    toast(`To-do in „${data.projects[pid]?.title || 'Projekt'}“ angelegt`);
    onClose();
  };
  if (!projects.length)
    return (
      <div className="panel ck-todo">
        <div className="spread">
          <h3>To-do anlegen</h3>
          <IconBtn icon="x" label="Schließen" onClick={onClose} />
        </div>
        <p className="small muted">To-dos gehören zu einem Projekt. Lege zuerst unter „Projekte“ ein Projekt an.</p>
      </div>
    );
  return (
    <form
      className="panel ck-todo"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="spread">
        <h3>To-do anlegen</h3>
        <IconBtn icon="x" label="Schließen" onClick={onClose} />
      </div>
      <TextInput id="ck-todo-text" value={text} onChange={setText} placeholder="Was ist zu tun?" autoFocus aria-label="To-do" />
      <div className="ck-todo-row">
        <label className="field">
          <span className="field-label">Projekt</span>
          <Select id="ck-todo-project" value={pid} onChange={setPid} options={projects.map((p) => ({ value: p.id, label: p.title }))} />
        </label>
        <label className="field">
          <span className="field-label">Fällig (optional)</span>
          <DateInput id="ck-todo-due" value={due} onChange={setDue} />
        </label>
      </div>
      <div className="hstack">
        <Btn kind="primary" icon="check" type="submit" disabled={!text.trim()}>
          Anlegen
        </Btn>
        <Btn kind="ghost" onClick={onClose}>
          Abbrechen
        </Btn>
      </div>
    </form>
  );
}
