import { Icon } from './icons.jsx';
import { HeatHint } from './energy.jsx';
import { PvHint } from './solar.jsx';
import { OfferCompare } from './offers.jsx';
import { AiVerdict } from './econ.jsx';
import { Btn, IconBtn, Field, TextInput, NumInput, Select, DateInput, Pill, Section, Drawer, Sheet, Empty, ConfirmBtn, Seg } from './common.jsx';
import { AiRunner, useAiAvailable, AiUnavailable } from './ai-ui.jsx';
import { useUI, setUI, openDrawer, closeDrawer, toast, go } from './state.js';
import { DocList, UploadButton } from './documents.jsx';
import { PROJECT_KINDS, projectKind, STATUS, status as statusOf, CONSTRAINT_KINDS, FUNDING_TYPES, FUNDING_STATUS, gewerk } from '../catalog.js';
import { projectCost, projectIssues, createsCycle, isDone, costValue } from '../metrics.js';
import { createProject, patchProject, deleteProject, addFunding, addCost, addConstraint, addMilestone, alignToDependencies } from '../actions.js';
import { aiFunding, aiTiming, aiCosts, aiRisks, aiRoadmap } from '../ai.js';
import { updateHouse } from '../store.js';
import { uid, fmtEuro, fmtDate, fmtDayMonth, fmtMonth, todayISO, addDays, diffDays, parseISO, toISO, isISO, MONTHS, fmtNum } from '../util.js';

const { useState, useEffect, useRef, useMemo } = React;

const CONSTRAINT_SUGGEST = {
  pv: ['Statik des Dachs prüfen', 'Anmeldung beim Netzbetreiber vor Inbetriebnahme', 'Eintrag ins Marktstammdatenregister (1 Monat)', 'Zählerplatz für Zweirichtungszähler'],
  heizung: ['Raumweise Heizlastberechnung', 'Hydraulischer Abgleich', 'Schallschutz Außengerät (TA Lärm)', 'Förderantrag vor Auftragsvergabe', 'Stromtarif / Zähler für Wärmepumpe'],
  dach: ['Gerüst und ggf. Straßensondernutzung', 'Asbest prüfen (Baujahr vor 1993)', 'Witterung / Jahreszeit', 'Nachrüstpflicht oberste Geschossdecke nach Kauf'],
  fassade: ['Grenzabstand / Überbau durch Dämmung', 'Gerüst', 'Frostfreie Witterung', 'Denkmalschutz / Gestaltungssatzung prüfen'],
  fenster: ['Lüftungskonzept nach DIN 1946-6', 'Anschluss an die Dämmebene', 'Lieferzeit 6–10 Wochen'],
  daemmung: ['Feuchteschutz / Taupunkt prüfen', 'Raumhöhe im Keller'],
  elektro: ['Termin Netzbetreiber für Zählerwechsel', 'Stromabschaltung einplanen', 'TAB des Netzbetreibers beachten'],
  sanitaer: ['Ersatzbad während des Umbaus', 'Verzinkte Leitungen prüfen', 'Abdichtung nach DIN 18534'],
  lueftung: ['Platz für das Lüftungsgerät', 'Leitungsführung und Brandschutz'],
  innen: ['Staubschutz', 'Reihenfolge der Gewerke'],
  aussen: ['Baugenehmigung prüfen (Carport/Garage)', 'Abstimmung mit Nachbarn'],
  sonstiges: [],
};

const tone = (p, today = todayISO()) => {
  if (isDone(p)) return 'done';
  if (p.end && p.end < today && p.status !== 'pausiert') return 'late';
  if (p.status === 'umsetzung') return 'active';
  if (p.status === 'beauftragt') return 'booked';
  return 'plan';
};
const statusTone = (p) => ({ done: 'accent', late: 'warn', active: 'solid', booked: 'info', plan: 'neutral' })[tone(p)];

// ================= Sheet =================
export function ProjectsSheet({ data }) {
  const [tab, setTab] = useState('zeitplan');
  const projects = Object.values(data.projects);
  return (
    <Sheet
      title="Modernisierungsprojekte"
      icon="tasks"
      eyebrow={`${projects.length} Projekte`}
      tabs={[
        { key: 'zeitplan', label: 'Zeitplan', icon: 'gantt' },
        { key: 'liste', label: 'Liste', icon: 'list', count: projects.length },
      ]}
      tab={tab}
      onTab={setTab}
      onClose={() => go('modell')}
      actions={
        <>
          <Btn small kind="ai" icon="sparkles" onClick={() => openDrawer({ type: 'roadmap' })}>
            Sanierungsfahrplan
          </Btn>
          <Btn small kind="primary" icon="plus" onClick={() => openDrawer({ type: 'project', id: createProject() })}>
            Projekt
          </Btn>
        </>
      }
    >
      {!projects.length ? (
        <Empty
          icon="tasks"
          title="Noch keine Projekte"
          action={
            <Btn kind="primary" icon="plus" onClick={() => openDrawer({ type: 'project', id: createProject() })}>
              Projekt anlegen
            </Btn>
          }
        >
          Lege Modernisierungen wie Dachsanierung, PV-Anlage oder Heizungstausch an – oder lass dir von der KI einen Sanierungsfahrplan vorschlagen.
        </Empty>
      ) : tab === 'liste' ? (
        <ProjectList data={data} />
      ) : (
        <Gantt data={data} />
      )}
    </Sheet>
  );
}

function ProjectList({ data }) {
  const all = Object.values(data.projects);
  const groups = [
    { key: 'laufend', title: 'Laufend', items: all.filter((p) => ['umsetzung', 'beauftragt'].includes(p.status)) },
    { key: 'geplant', title: 'In Planung', items: all.filter((p) => ['idee', 'planung', 'angebote'].includes(p.status)) },
    { key: 'pausiert', title: 'Pausiert', items: all.filter((p) => p.status === 'pausiert') },
    { key: 'fertig', title: 'Abgeschlossen', items: all.filter(isDone) },
  ];
  return (
    <div>
      {groups.map((g) =>
        g.items.length ? (
          <div key={g.key}>
            <div className="group-title">
              {g.title} <span className="tab-count">{g.items.length}</span>
            </div>
            <div className="plist">
              {g.items
                .sort((a, b) => ((a.start || '9') < (b.start || '9') ? -1 : 1))
                .map((p) => (
                  <ProjectRow key={p.id} p={p} data={data} />
                ))}
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

function ProjectRow({ p, data }) {
  const c = projectCost(p);
  const issues = projectIssues(p, Object.values(data.projects)).filter((i) => i.level === 'warn');
  return (
    <button className="prow" onClick={() => openDrawer({ type: 'project', id: p.id })}>
      <span className="prow-ico">
        <Icon name={projectKind(p.kind).icon} />
      </span>
      <span className="prow-main">
        <b>{p.title}</b>
        <span className="prow-meta">
          <Pill tone={statusTone(p)}>{statusOf(p.status).name}</Pill>
          <span>
            {p.start ? fmtDayMonth(p.start) : '–'} – {p.end ? fmtDayMonth(p.end) : '–'}
          </span>
          <span>{projectKind(p.kind).name}</span>
          {issues.length ? (
            <Pill tone="warn" icon="alert">
              {issues.length} Hinweis{issues.length > 1 ? 'e' : ''}
            </Pill>
          ) : null}
          {p.example ? <Pill className="pill-example">Beispiel</Pill> : null}
        </span>
      </span>
      <span className="prow-side">
        <b>{fmtEuro(c.best)}</b>
        {c.funding ? <span>− {fmtEuro(c.funding)} Förderung</span> : null}
      </span>
    </button>
  );
}

// ================= Gantt =================
const ZOOMS = { woche: 12, monat: 4, quartal: 1.6 };

function Gantt({ data }) {
  const [zoom, setZoom] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 760 ? 'quartal' : 'monat'));
  const [drag, setDrag] = useState(null);
  const wrapRef = useRef(null);
  const ppd = ZOOMS[zoom];
  const today = todayISO();
  const projects = Object.values(data.projects).sort((a, b) => ((a.start || '9') < (b.start || '9') ? -1 : 1));
  const dates = projects.flatMap((p) => [p.start, p.end, ...(p.milestones || []).map((m) => m.date), ...(p.funding || []).map((f) => f.deadline)]).filter(isISO);
  dates.push(today);
  dates.sort();
  const s0 = parseISO(addDays(dates[0], -20));
  s0.setDate(1);
  const minISO = toISO(s0);
  const e0 = parseISO(addDays(dates[dates.length - 1] > addDays(today, 240) ? dates[dates.length - 1] : addDays(today, 240), 30));
  e0.setMonth(e0.getMonth() + 1, 0);
  const maxISO = toISO(e0);
  const totalDays = diffDays(minISO, maxISO) + 1;
  const W = totalDays * ppd;
  const X = (iso) => diffDays(minISO, iso) * ppd;
  const months = [];
  const m = parseISO(minISO);
  while (toISO(m) <= maxISO) {
    months.push({ iso: toISO(m), label: MONTHS[m.getMonth()], year: m.getFullYear(), m: m.getMonth() });
    m.setMonth(m.getMonth() + 1);
  }
  const ROW = 46;
  const rowIndex = Object.fromEntries(projects.map((p, i) => [p.id, i]));
  const shifted = (p) => {
    if (!drag || drag.id !== p.id || !p.start || !p.end) return p;
    const d = drag.delta;
    if (drag.mode === 'move') return { ...p, start: addDays(p.start, d), end: addDays(p.end, d) };
    if (drag.mode === 'start') return { ...p, start: addDays(p.start, Math.min(d, diffDays(p.start, p.end))) };
    return { ...p, end: addDays(p.end, Math.max(d, -diffDays(p.start, p.end))) };
  };
  const view = projects.map(shifted);
  const byId = Object.fromEntries(view.map((p) => [p.id, p]));

  const onDown = (e, p, mode) => {
    if (!p.start || !p.end) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id: p.id, mode, x0: e.clientX, delta: 0, moved: false });
  };
  const onMove = (e) => {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.x0) / ppd);
    if (delta !== drag.delta) setDrag({ ...drag, delta, moved: true });
  };
  const onUp = () => {
    if (!drag) return;
    const p = data.projects[drag.id];
    if (drag.moved && drag.delta) {
      const n = shifted(p);
      patchProject(p.id, (x) => ({ ...x, start: n.start, end: n.end }), 0);
      toast(`„${p.title}“: ${fmtDate(n.start)} – ${fmtDate(n.end)}`);
    } else if (!drag.moved) openDrawer({ type: 'project', id: p.id });
    setDrag(null);
  };

  useEffect(() => {
    if (wrapRef.current) wrapRef.current.scrollLeft = Math.max(0, X(today) - 140);
  }, [zoom]);

  const arrows = [];
  view.forEach((p) => {
    for (const depId of p.dependsOn || []) {
      const d = byId[depId];
      if (!d || !d.end || !p.start) continue;
      const x1 = X(d.end) + ppd,
        y1 = rowIndex[d.id] * ROW + ROW / 2;
      const x2 = X(p.start),
        y2 = rowIndex[p.id] * ROW + ROW / 2;
      const bad = p.start < d.end && !isDone(d);
      const mx = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 14));
      arrows.push({ key: d.id + p.id, d: `M${x1},${y1} H${mx} V${y2} H${x2 - 4}`, bad });
    }
  });

  return (
    <div className="stack" style={{ height: '100%' }}>
      <div className="spread">
        <Seg
          small
          value={zoom}
          onChange={setZoom}
          options={[
            { value: 'woche', label: 'Wochen' },
            { value: 'monat', label: 'Monate' },
            { value: 'quartal', label: 'Quartale' },
          ]}
        />
        <span className="small muted">Balken ziehen verschiebt das Projekt, Ränder ändern Start und Ende.</span>
      </div>
      <div className="gantt-wrap" ref={wrapRef} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
        <div className="gantt" style={{ width: 190 + W }}>
          <div className="g-head">
            <div className="g-namecol">Projekt</div>
            <div className="g-months" style={{ width: W }}>
              {months.map((mo) => (
                <div key={mo.iso} className="g-month" style={{ left: X(mo.iso), width: diffDays(mo.iso, addDays(toISO(new Date(parseISO(mo.iso).getFullYear(), parseISO(mo.iso).getMonth() + 1, 1)), 0)) * ppd }}>
                  {zoom !== 'quartal' || mo.m % 3 === 0 ? (
                    <>
                      <b>{mo.m === 0 || mo === months[0] ? mo.year : ' '}</b>
                      {mo.label}
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            {view.map((p) => {
              const t = tone(p, today);
              const conflict = projectIssues(p, view).some((i) => i.kind === 'dependency' && i.level === 'warn');
              return (
                <div className="g-row" key={p.id}>
                  <button className="g-name" onClick={() => openDrawer({ type: 'project', id: p.id })}>
                    <Icon name={projectKind(p.kind).icon} size={16} />
                    <b>{p.title}</b>
                  </button>
                  <div className="g-track" style={{ width: W }}>
                    {months.map((mo) => (
                      <span key={mo.iso} className="g-grid" style={{ left: X(mo.iso) }} />
                    ))}
                    {p.start && p.end ? (
                      <div
                        className={`g-bar tone-${t} ${conflict ? 'has-conflict' : ''}`}
                        style={{ left: X(p.start), width: Math.max(ppd * 2, (diffDays(p.start, p.end) + 1) * ppd) }}
                        onPointerDown={(e) => onDown(e, p, 'move')}
                        title={`${p.title}: ${fmtDate(p.start)} – ${fmtDate(p.end)}`}
                      >
                        <span className="g-handle l" onPointerDown={(e) => onDown(e, p, 'start')} />
                        {(diffDays(p.start, p.end) + 1) * ppd > 70 ? statusOf(p.status).name : ''}
                        <span className="g-handle r" onPointerDown={(e) => onDown(e, p, 'end')} />
                      </div>
                    ) : null}
                    {(p.milestones || []).filter((mm) => isISO(mm.date)).map((mm) => (
                      <span key={mm.id} className={`g-ms ${mm.done ? 'done' : ''}`} style={{ left: X(mm.date) - 5 }} title={`${mm.title} · ${fmtDate(mm.date)}`} />
                    ))}
                    {(p.funding || []).filter((f) => isISO(f.deadline) && ['pruefen', 'geplant'].includes(f.status)).map((f) => (
                      <span key={f.id} className="g-flag" style={{ left: X(f.deadline) - 6 }} title={`Antrag ${f.program} bis ${fmtDate(f.deadline)}`}>
                        <Icon name="flag" size={13} stroke={2.2} />
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            <svg className="g-arrows" width={190 + W} height={view.length * ROW} style={{ left: 190 }}>
              <defs>
                <marker id="ah" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 z" fill="var(--ink-3)" />
                </marker>
                <marker id="ahw" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 z" fill="var(--warn)" />
                </marker>
              </defs>
              {arrows.map((a) => (
                <path key={a.key} d={a.d} fill="none" stroke={a.bad ? 'var(--warn)' : 'var(--ink-3)'} strokeWidth="1.5" strokeDasharray={a.bad ? '4 3' : 'none'} markerEnd={`url(#${a.bad ? 'ahw' : 'ah'})`} />
              ))}
            </svg>
            <div className="g-today" style={{ left: 190 + X(today) }}>
              <span>Heute</span>
            </div>
          </div>
        </div>
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--accent)' }} />In Umsetzung</span>
        <span><i style={{ background: 'var(--info-soft)', border: '1px solid var(--info)' }} />Beauftragt</span>
        <span><i style={{ background: 'var(--surface-2)', border: '1px dashed var(--line-2)' }} />Geplant</span>
        <span><i style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn)' }} />Im Verzug</span>
        <span><i style={{ background: 'var(--violet)', transform: 'rotate(45deg) scale(0.7)' }} />Meilenstein</span>
        <span style={{ color: 'var(--warn)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <Icon name="flag" size={12} /> Förderantrag
        </span>
      </div>
    </div>
  );
}

// ================= Drawer =================
export function ProjectDrawer({ data, drawer }) {
  const p = data.projects[drawer.id];
  const [autoRun, setAutoRun] = useState(0);
  const fundRef = useRef(null);
  if (!p)
    return (
      <Drawer title="Projekt nicht gefunden" onClose={closeDrawer}>
        <Empty title="Dieses Projekt existiert nicht mehr." />
      </Drawer>
    );
  const set = (patch) => patchProject(p.id, (x) => ({ ...x, ...patch }));
  const kind = projectKind(p.kind);
  const all = Object.values(data.projects);
  const issues = projectIssues(p, all);
  const cost = projectCost(p);
  const runFunding = () => {
    fundRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setAutoRun((n) => n + 1);
  };
  return (
    <Drawer
      eyebrow={`Projekt · ${kind.name}`}
      title={p.title || 'Ohne Titel'}
      icon={kind.icon}
      onClose={closeDrawer}
      subtitle={
        <>
          <Pill tone={statusTone(p)}>{statusOf(p.status).name}</Pill>
          <span>
            {p.start ? fmtDate(p.start) : '–'} – {p.end ? fmtDate(p.end) : '–'}
          </span>
          {p.example ? <Pill className="pill-example">Beispiel</Pill> : null}
        </>
      }
      footer={
        <>
          <ConfirmBtn onConfirm={() => { deleteProject(p.id); closeDrawer(); toast('Projekt gelöscht'); }} />
          <Btn kind="ai" icon="sparkles" onClick={runFunding}>
            Förderung & Zeitpunkt prüfen
          </Btn>
        </>
      }
    >
      {issues.filter((i) => i.level === 'warn').length ? (
        <div className="callout callout-warn" style={{ marginTop: 10 }}>
          <Icon name="alert" size={16} />
          <div>
            {issues
              .filter((i) => i.level === 'warn')
              .map((i, k) => (
                <div key={k}>{i.text}</div>
              ))}
          </div>
        </div>
      ) : null}

      {p.kind === 'heizung' ? <HeatHint data={data} /> : null}
      {p.kind === 'pv' ? <PvHint data={data} /> : null}

      <Section n={1} title="Grunddaten">
        <Field label="Titel">
          <TextInput id={'p-title-' + p.id} value={p.title} onChange={(v) => set({ title: v })} />
        </Field>
        <div className="grid2">
          <Field label="Art der Maßnahme">
            <Select id={'p-kind-' + p.id} value={p.kind} onChange={(v) => set({ kind: v })} options={PROJECT_KINDS.map((k) => ({ value: k.key, label: k.name }))} />
          </Field>
          <Field label="Priorität">
            <Seg small value={p.priority || 2} onChange={(v) => set({ priority: v })} options={[{ value: 1, label: 'Hoch' }, { value: 2, label: 'Mittel' }, { value: 3, label: 'Niedrig' }]} />
          </Field>
        </div>
        <Field label="Status">
          <div className="chips">
            {STATUS.map((s) => (
              <button key={s.key} type="button" className={`chip ${p.status === s.key ? 'is-on' : ''}`} onClick={() => set({ status: s.key })}>
                {s.name}
              </button>
            ))}
          </div>
        </Field>
        <ComponentLinks p={p} data={data} set={set} />
        <Field label="Notizen">
          <TextInput id={'p-notes-' + p.id} multiline value={p.notes} onChange={(v) => set({ notes: v })} placeholder="Ziele, Wünsche, Gespräche mit Handwerkern …" />
        </Field>
      </Section>

      <Section n={2} title="Zeitplan" aside={p.start && p.end ? `${Math.max(1, Math.round((diffDays(p.start, p.end) + 1) / 7))} Wochen` : null}>
        <div className="grid2">
          <Field label="Start">
            <DateInput id={'p-start-' + p.id} value={p.start} onChange={(v) => set({ start: v, end: p.end && v && p.end < v ? addDays(v, diffDays(p.start || v, p.end)) : p.end })} />
          </Field>
          <Field label="Ende">
            <DateInput id={'p-end-' + p.id} value={p.end} onChange={(v) => set({ end: v })} />
          </Field>
        </div>
        <Milestones p={p} set={set} />
        <AiRunner
          title="Zeitplan & Abhängigkeiten"
          icon="calendar"
          desc="Prüft Jahreszeit, Vorlaufzeiten, Reihenfolge der Gewerke und Abhängigkeiten zu deinen anderen Projekten."
          saved={p.ai?.timing}
          run={(signal) => aiTiming(p, data, { signal })}
          onSave={(rec) => set({ ai: { ...(p.ai || {}), timing: rec } })}
          render={(r) => <TimingResult r={r} p={p} data={data} set={set} />}
        />
      </Section>

      <Section n={3} title="Abhängigkeiten">
        <Dependencies p={p} data={data} set={set} />
      </Section>

      <Section n={4} title="Rahmenbedingungen" aside={`${(p.constraints || []).filter((c) => c.done).length}/${(p.constraints || []).length} erledigt`}>
        <Constraints p={p} set={set} />
        <AiRunner
          title="Rahmenbedingungen & Risiken"
          icon="shield"
          desc="Genehmigungen, gesetzliche Pflichten, Statik, Schadstoffe, Netzbetreiber, Witterung."
          saved={p.ai?.risks}
          run={(signal) => aiRisks(p, data, { signal })}
          onSave={(rec) => set({ ai: { ...(p.ai || {}), risks: rec } })}
          render={(r) => <RisksResult r={r} p={p} />}
        />
      </Section>

      <Section n={5} title="Kosten" aside={fmtEuro(cost.best)}>
        <Costs p={p} set={set} />
        <OfferCompare p={p} data={data} set={set} />
        <div className="grid2">
          <Field label="Davon Eigenleistung" hint="Wert deiner eigenen Arbeit (für Finanzierung)">
            <NumInput id={'p-own-' + p.id} value={p.ownWork} onChange={(v) => set({ ownWork: v })} unit="€" digits={0} />
          </Field>
        </div>
        <div className="sum-strip">
          <div>
            <span>Kosten</span>
            <b>{fmtEuro(cost.best)}</b>
          </div>
          <div>
            <span>Förderung</span>
            <b style={{ color: 'var(--accent-ink)' }}>− {fmtEuro(cost.funding)}</b>
          </div>
          <div>
            <span>Eigenanteil</span>
            <b>{fmtEuro(cost.net)}</b>
          </div>
        </div>
        <AiRunner
          title="Kostenschätzung"
          icon="euro"
          desc="Schätzt Positionen mit Preisspanne anhand der Maße aus deinem 3D-Modell."
          saved={p.ai?.costs}
          run={(signal) => aiCosts(p, data, { signal })}
          onSave={(rec) => set({ ai: { ...(p.ai || {}), costs: rec } })}
          render={(r) => <CostsResult r={r} p={p} />}
        />
      </Section>

      <div ref={fundRef} />
      <Section n={6} title="Förderung" aside={cost.funding ? fmtEuro(cost.funding) : null}>
        {statusOf(p.status).step < 3 ? (
          <div className="callout callout-info">
            <Icon name="info" size={16} />
            <span>
              <b>Antrag vor Auftrag:</b> KfW- und BAFA-Zuschüsse musst du in der Regel vor der Auftragsvergabe beantragen.
            </span>
          </div>
        ) : null}
        <FundingList p={p} set={set} />
        <AiRunner
          title="Fördermöglichkeiten & bester Antragszeitpunkt"
          icon="sparkles"
          desc="Sucht passende Zuschüsse, Kredite, Steuerboni und Vergütungen, schätzt Beträge und sagt dir, wann du was beantragen solltest."
          saved={p.ai?.funding}
          run={(signal) => aiFunding(p, data, { signal })}
          onSave={(rec) => set({ ai: { ...(p.ai || {}), funding: rec } })}
          render={(r) => <FundingResult r={r} p={p} />}
          cta="Förderung prüfen"
          autoRun={autoRun}
        />
      </Section>

      <Section n={7} title="Dokumente" aside={<UploadButton projectId={p.id} small />}>
        <DocList data={data} filter={(d) => d.projectId === p.id} projectId={p.id} compact />
      </Section>
    </Drawer>
  );
}

function ComponentLinks({ p, data, set }) {
  const comps = Object.values(data.components);
  const linked = (p.components || []).map((id) => data.components[id]).filter(Boolean);
  const gw = projectKind(p.kind).gewerk;
  const options = comps
    .filter((c) => !(p.components || []).includes(c.id))
    .sort((a, b) => (a.gewerk === gw ? -1 : 0) - (b.gewerk === gw ? -1 : 0))
    .map((c) => ({ value: c.id, label: `${gewerk(c.gewerk).name} · ${c.name}` }));
  return (
    <Field label="Betroffene Bauteile">
      <div className="chips">
        {linked.map((c) => (
          <span key={c.id} className="chip is-on">
            <Icon name={gewerk(c.gewerk).icon} size={13} />
            <button type="button" className="link" onClick={() => openDrawer({ type: 'component', id: c.id })}>
              {c.name}
            </button>
            <button type="button" className="link" aria-label={`${c.name} entfernen`} onClick={() => set({ components: p.components.filter((x) => x !== c.id) })}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        {options.length ? (
          <select className="input select" style={{ width: 'auto', minHeight: 30, padding: '3px 28px 3px 9px', fontSize: 12.5 }} value="" onChange={(e) => e.target.value && set({ components: [...(p.components || []), e.target.value] })} aria-label="Bauteil verknüpfen">
            <option value="">+ Bauteil verknüpfen</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </Field>
  );
}

function Milestones({ p, set }) {
  const ms = [...(p.milestones || [])].sort((a, b) => ((a.date || '9') < (b.date || '9') ? -1 : 1));
  const upd = (id, patch) => set({ milestones: p.milestones.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="field-label">Meilensteine</span>
      <div className="rows">
        {ms.map((m) => (
          <div key={m.id} className={`row row-check ${m.done ? 'is-done' : ''}`} style={{ gridTemplateColumns: '22px 1fr 140px 30px' }}>
            <input type="checkbox" checked={!!m.done} onChange={(e) => upd(m.id, { done: e.target.checked })} aria-label="Erledigt" />
            <input className="input" value={m.title} onChange={(e) => upd(m.id, { title: e.target.value })} aria-label="Meilenstein" />
            <input className="input" type="date" value={m.date || ''} onChange={(e) => upd(m.id, { date: e.target.value || null })} aria-label="Datum" />
            <IconBtn icon="trash" label="Meilenstein löschen" size={15} onClick={() => set({ milestones: p.milestones.filter((x) => x.id !== m.id) })} />
          </div>
        ))}
      </div>
      <div>
        <Btn small kind="ghost" icon="plus" onClick={() => set({ milestones: [...(p.milestones || []), { id: uid('m'), title: 'Neuer Meilenstein', date: p.start || null, done: false }] })}>
          Meilenstein
        </Btn>
      </div>
    </div>
  );
}

function Dependencies({ p, data, set }) {
  const all = Object.values(data.projects).filter((x) => x.id !== p.id);
  const dependents = all.filter((x) => (x.dependsOn || []).includes(p.id));
  const toggle = (id) => {
    const has = (p.dependsOn || []).includes(id);
    if (!has && createsCycle(Object.values(data.projects), p.id, id)) {
      toast('Das würde eine Schleife erzeugen – das andere Projekt hängt schon von diesem ab.', 'warn');
      return;
    }
    set({ dependsOn: has ? p.dependsOn.filter((x) => x !== id) : [...(p.dependsOn || []), id] });
  };
  if (!all.length) return <p className="small muted">Lege weitere Projekte an, um Abhängigkeiten festzulegen.</p>;
  return (
    <>
      <Field label="Startet erst nach Abschluss von">
        <div className="chips">
          {all.map((x) => {
            const on = (p.dependsOn || []).includes(x.id);
            const bad = on && x.end && p.start && p.start < x.end && !isDone(x);
            return (
              <button key={x.id} type="button" className={`chip ${on ? 'is-on' : ''} ${bad ? 'is-warn' : ''}`} onClick={() => toggle(x.id)} title={x.end ? `endet ${fmtDate(x.end)}` : ''}>
                <Icon name={on ? (bad ? 'alert' : 'link') : projectKind(x.kind).icon} size={13} />
                {x.title}
              </button>
            );
          })}
        </div>
      </Field>
      {(p.dependsOn || []).length ? (
        <div>
          <Btn small icon="calendar" onClick={() => alignToDependencies(p.id) && toast('Start auf das Ende der Vorgänger gelegt')}>
            Start nach Vorgängern ausrichten
          </Btn>
        </div>
      ) : null}
      {dependents.length ? (
        <p className="small muted">
          Wird benötigt von: {dependents.map((x) => x.title).join(', ')}
        </p>
      ) : null}
    </>
  );
}

function Constraints({ p, set }) {
  const list = p.constraints || [];
  const upd = (id, patch) => set({ constraints: list.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const sugg = (CONSTRAINT_SUGGEST[p.kind] || []).filter((s) => !list.some((c) => c.text === s));
  return (
    <>
      <div className="rows">
        {list.map((c) => (
          <div key={c.id} className={`row row-check ${c.done ? 'is-done' : ''}`}>
            <input type="checkbox" checked={!!c.done} onChange={(e) => upd(c.id, { done: e.target.checked })} aria-label="Erledigt" />
            <input className="input" value={c.text} onChange={(e) => upd(c.id, { text: e.target.value })} aria-label="Rahmenbedingung" />
            <select className="input select" style={{ width: 130 }} value={c.kind} onChange={(e) => upd(c.id, { kind: e.target.value })} aria-label="Art">
              {CONSTRAINT_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.name}
                </option>
              ))}
            </select>
            <IconBtn icon="trash" label="Löschen" size={15} onClick={() => set({ constraints: list.filter((x) => x.id !== c.id) })} />
          </div>
        ))}
      </div>
      <div className="chips">
        <button type="button" className="chip chip-add" onClick={() => set({ constraints: [...list, { id: uid('b'), text: '', kind: 'organisatorisch', done: false }] })}>
          <Icon name="plus" size={13} /> Eigene
        </button>
        {sugg.map((s) => (
          <button key={s} type="button" className="chip chip-add" onClick={() => set({ constraints: [...list, { id: uid('b'), text: s, kind: 'technisch', done: false }] })}>
            <Icon name="plus" size={13} /> {s}
          </button>
        ))}
      </div>
    </>
  );
}

function Costs({ p, set }) {
  const list = p.costs || [];
  const upd = (id, patch) => set({ costs: list.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const sumOf = (k) => list.reduce((s, c) => s + (Number(c[k]) || 0), 0);
  return (
    <div className="rows">
      <div className="cost-head">
        <span>Position</span>
        <span>Schätzung</span>
        <span>Angebot</span>
        <span>Ist</span>
        <span />
      </div>
      {list.map((c) => (
        <div key={c.id} className="row cost-row">
          <input className="input" value={c.label} onChange={(e) => upd(c.id, { label: e.target.value })} aria-label="Position" />
          <NumInput value={c.estimate} onChange={(v) => upd(c.id, { estimate: v })} digits={0} aria-label="Schätzung" />
          <NumInput value={c.offer} onChange={(v) => upd(c.id, { offer: v })} digits={0} aria-label="Angebot" />
          <NumInput value={c.actual} onChange={(v) => upd(c.id, { actual: v })} digits={0} aria-label="Ist" />
          <IconBtn icon="trash" label="Position löschen" size={15} onClick={() => set({ costs: list.filter((x) => x.id !== c.id) })} />
        </div>
      ))}
      {list.length ? (
        <div className="cost-total">
          <span>Summe</span>
          <span>{fmtEuro(sumOf('estimate'))}</span>
          <span>{fmtEuro(sumOf('offer'))}</span>
          <span>{fmtEuro(sumOf('actual'))}</span>
          <span />
        </div>
      ) : null}
      <div>
        <Btn small kind="ghost" icon="plus" onClick={() => set({ costs: [...list, { id: uid('k'), label: 'Neue Position', estimate: null, offer: null, actual: null, vendor: '' }] })}>
          Kostenposition
        </Btn>
      </div>
    </div>
  );
}

function FundingList({ p, set }) {
  const list = p.funding || [];
  const upd = (id, patch) => set({ funding: list.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  return (
    <div className="stack" style={{ gap: 8 }}>
      {list.map((f) => (
        <div key={f.id} className="fund-card">
          <div className="fund-card-head">
            <input className="input" value={f.program} onChange={(e) => upd(f.id, { program: e.target.value })} aria-label="Programm" />
            {f.source === 'ki' ? <Pill tone="info" icon="sparkles">KI</Pill> : null}
            <IconBtn icon="trash" label="Förderung löschen" size={15} onClick={() => set({ funding: list.filter((x) => x.id !== f.id) })} />
          </div>
          <div className="grid3">
            <Field label="Stelle">
              <input className="input" value={f.provider || ''} onChange={(e) => upd(f.id, { provider: e.target.value })} placeholder="KfW, BAFA …" />
            </Field>
            <Field label="Art">
              <Select value={f.type} onChange={(v) => upd(f.id, { type: v })} options={FUNDING_TYPES.map((t) => ({ value: t.key, label: t.name }))} />
            </Field>
            <Field label="Status">
              <Select value={f.status} onChange={(v) => upd(f.id, { status: v })} options={FUNDING_STATUS.map((t) => ({ value: t.key, label: t.name }))} />
            </Field>
            <Field label="Satz">
              <NumInput value={f.rate} onChange={(v) => upd(f.id, { rate: v })} unit="%" digits={1} />
            </Field>
            <Field label="Betrag">
              <NumInput value={f.amount} onChange={(v) => upd(f.id, { amount: v })} unit="€" digits={0} />
            </Field>
            <Field label="Antrag bis">
              <DateInput value={f.deadline} onChange={(v) => upd(f.id, { deadline: v })} />
            </Field>
          </div>
          {f.notes || f.url ? (
            <p className="small muted">
              {f.notes}
              {f.url ? (
                <>
                  {' '}
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="link">
                    Zur Förderstelle
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      ))}
      <div>
        <Btn small kind="ghost" icon="plus" onClick={() => addFunding(p.id, { program: 'Neue Förderung', status: 'pruefen' })}>
          Förderung erfassen
        </Btn>
      </div>
    </div>
  );
}

// ---------- AI result renderers ----------
const confTone = (c) => (c === 'hoch' ? 'accent' : c === 'mittel' ? 'info' : 'warn');
const safeDate = (d) => (isISO(d) ? d : null);

function FundingResult({ r, p }) {
  const have = new Set((p.funding || []).map((f) => (f.program || '').toLowerCase()));
  const haveMs = new Set((p.milestones || []).map((m) => (m.title || '').toLowerCase()));
  return (
    <div className="stack" style={{ gap: 9 }}>
      {r.summary ? <p className="ai-summary">{r.summary}</p> : null}
      {r.bestTiming?.recommendation ? (
        <div className="callout callout-accent">
          <Icon name="calendar" size={16} />
          <div>
            <b>Bester Zeitpunkt{safeDate(r.bestTiming.applyBy) ? `: Antrag bis ${fmtDate(r.bestTiming.applyBy)}` : ''}</b>
            <div>{r.bestTiming.recommendation}</div>
            {(r.bestTiming.reasons || []).length ? (
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {r.bestTiming.reasons.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
      <ul className="ai-list">
        {(r.programs || []).map((g, i) => {
          const adopted = have.has(String(g.name || '').toLowerCase());
          return (
            <li key={i} className="ai-item">
              <div className="ai-item-head">
                <b>{g.name}</b>
                {g.confidence ? <Pill tone={confTone(g.confidence)}>{g.confidence === 'hoch' ? 'sicher' : g.confidence === 'mittel' ? 'wahrscheinlich' : 'prüfen'}</Pill> : null}
              </div>
              <div className="ai-meta">
                {g.provider ? <Pill>{g.provider}</Pill> : null}
                {g.type ? <span>{FUNDING_TYPES.find((t) => t.key === g.type)?.name || g.type}</span> : null}
                {g.rate != null ? <b>{fmtNum(g.rate, 1)} %</b> : null}
                {g.amount != null ? <b>≈ {fmtEuro(g.amount)}</b> : null}
                {safeDate(g.applyBy) ? (
                  <Pill tone="warn" icon="flag">
                    bis {fmtDate(g.applyBy)}
                  </Pill>
                ) : null}
              </div>
              {g.timing ? <p>{g.timing}</p> : null}
              {(g.conditions || []).length ? (
                <ul>
                  {g.conditions.map((c, k) => (
                    <li key={k}>{c}</li>
                  ))}
                </ul>
              ) : null}
              {g.combinable ? <p>{g.combinable}</p> : null}
              <div className="ai-actions">
                {adopted ? (
                  <span className="adopted">
                    <Icon name="check" size={14} /> übernommen
                  </span>
                ) : (
                  <Btn
                    small
                    icon="plus"
                    onClick={() => {
                      addFunding(p.id, { ...g, program: g.name, deadline: safeDate(g.applyBy), source: 'ki', status: 'geplant' });
                      if (safeDate(g.applyBy)) addMilestone(p.id, `Antrag ${g.name}`, g.applyBy);
                      toast('Förderung übernommen');
                    }}
                  >
                    Übernehmen
                  </Btn>
                )}
                {g.url && /^https?:\/\//.test(g.url) ? (
                  <a className="link" href={g.url} target="_blank" rel="noopener noreferrer">
                    Programmseite <Icon name="chevR" size={13} />
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {(r.steps || []).length ? (
        <div className="ai-item">
          <div className="ai-item-head">
            <b>Ablauf</b>
            <Btn
              small
              kind="ghost"
              icon="plus"
              onClick={() => {
                let n = 0;
                for (const s of r.steps) if (!haveMs.has(String(s.title).toLowerCase())) { addMilestone(p.id, s.title, safeDate(s.date)); n++; }
                toast(n ? `${n} Meilensteine übernommen` : 'Schon übernommen');
              }}
            >
              Als Meilensteine
            </Btn>
          </div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {r.steps.map((s, i) => (
              <li key={i} className="small">
                {s.title}
                {safeDate(s.date) ? <span className="muted"> · {fmtDate(s.date)}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {(r.warnings || []).length ? (
        <div className="callout callout-warn">
          <Icon name="alert" size={16} />
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {r.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TimingResult({ r, p, data, set }) {
  const start = safeDate(r.start),
    end = safeDate(r.end);
  const same = start === p.start && end === p.end;
  return (
    <div className="stack" style={{ gap: 9 }}>
      {r.summary ? <p className="ai-summary">{r.summary}</p> : null}
      {start && end ? (
        <div className="callout callout-accent">
          <Icon name="calendar" size={16} />
          <div style={{ flex: 1 }}>
            <b>
              Vorschlag: {fmtDate(start)} – {fmtDate(end)}
            </b>
            {r.season ? <div>{r.season}</div> : null}
            {r.leadTimeWeeks ? <div>Vorlauf ca. {r.leadTimeWeeks} Wochen</div> : null}
          </div>
          {same ? (
            <span className="adopted">
              <Icon name="check" size={14} /> aktiv
            </span>
          ) : (
            <Btn small onClick={() => { set({ start, end }); toast('Zeitraum übernommen'); }}>
              Übernehmen
            </Btn>
          )}
        </div>
      ) : null}
      {(r.reasons || []).length ? (
        <ul className="small" style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-2)' }}>
          {r.reasons.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : null}
      {(r.dependencies || []).filter((d) => data.projects[d.projectId]).length ? (
        <ul className="ai-list">
          {r.dependencies
            .filter((d) => data.projects[d.projectId])
            .map((d, i) => {
              const other = data.projects[d.projectId];
              const before = d.type !== 'nachher' && d.type !== 'gleichzeitig';
              const on = before ? (p.dependsOn || []).includes(other.id) : (other.dependsOn || []).includes(p.id);
              return (
                <li key={i} className="ai-item">
                  <div className="ai-item-head">
                    <b>
                      {before ? 'Nach' : d.type === 'nachher' ? 'Vor' : 'Gleichzeitig mit'} „{other.title}“
                    </b>
                    {d.type !== 'gleichzeitig' ? (
                      on ? (
                        <span className="adopted">
                          <Icon name="check" size={14} /> verknüpft
                        </span>
                      ) : (
                        <Btn
                          small
                          icon="link"
                          onClick={() => {
                            const all = Object.values(data.projects);
                            if (before) {
                              if (createsCycle(all, p.id, other.id)) return toast('Würde eine Schleife erzeugen', 'warn');
                              set({ dependsOn: [...(p.dependsOn || []), other.id] });
                            } else {
                              if (createsCycle(all, other.id, p.id)) return toast('Würde eine Schleife erzeugen', 'warn');
                              patchProject(other.id, (x) => ({ ...x, dependsOn: [...(x.dependsOn || []), p.id] }));
                            }
                            toast('Abhängigkeit übernommen');
                          }}
                        >
                          Verknüpfen
                        </Btn>
                      )
                    ) : null}
                  </div>
                  <p>{d.reason}</p>
                </li>
              );
            })}
        </ul>
      ) : null}
      {(r.milestones || []).length ? (
        <div className="ai-item">
          <div className="ai-item-head">
            <b>Meilensteine</b>
            <Btn small kind="ghost" icon="plus" onClick={() => { r.milestones.forEach((m) => addMilestone(p.id, m.title, safeDate(m.date))); toast('Meilensteine übernommen'); }}>
              Übernehmen
            </Btn>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {r.milestones.map((m, i) => (
              <li key={i} className="small">
                {m.title}
                {safeDate(m.date) ? <span className="muted"> · {fmtDate(m.date)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {(r.warnings || []).length ? (
        <div className="callout callout-warn">
          <Icon name="alert" size={16} />
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {r.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CostsResult({ r, p }) {
  const items = r.items || [];
  return (
    <div className="stack" style={{ gap: 9 }}>
      {r.summary ? <p className="ai-summary">{r.summary}</p> : null}
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Position</th>
              <th className="r">von</th>
              <th className="r">bis</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td>
                  {it.label}
                  {it.note ? <div className="small muted">{it.note}</div> : null}
                </td>
                <td className="r">{fmtEuro(it.low)}</td>
                <td className="r">{fmtEuro(it.high)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <b>Gesamt</b>
              </td>
              <td className="r">
                <b>{fmtEuro(r.totalLow)}</b>
              </td>
              <td className="r">
                <b>{fmtEuro(r.totalHigh)}</b>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="ai-actions">
        <Btn
          small
          icon="plus"
          onClick={() => {
            for (const it of items) addCost(p.id, { label: it.label, estimate: Math.round(((Number(it.low) || 0) + (Number(it.high) || Number(it.low) || 0)) / 2 / 10) * 10, note: it.note });
            toast(`${items.length} Positionen als Schätzung übernommen`);
          }}
        >
          Als Schätzung übernehmen
        </Btn>
      </div>
      {(r.assumptions || []).length ? (
        <ul className="small" style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-2)' }}>
          {r.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RisksResult({ r, p }) {
  const have = new Set((p.constraints || []).map((c) => (c.text || '').toLowerCase()));
  const open = (r.constraints || []).filter((c) => !have.has(String(c.text).toLowerCase()));
  return (
    <div className="stack" style={{ gap: 9 }}>
      {r.summary ? <p className="ai-summary">{r.summary}</p> : null}
      {(r.constraints || []).length ? (
        <ul className="ai-list">
          {r.constraints.map((c, i) => {
            const done = have.has(String(c.text).toLowerCase());
            return (
              <li key={i} className="ai-item">
                <div className="ai-item-head">
                  <b>{c.text}</b>
                  {done ? (
                    <span className="adopted">
                      <Icon name="check" size={14} />
                    </span>
                  ) : (
                    <IconBtn icon="plus" label="Übernehmen" size={15} onClick={() => addConstraint(p.id, c.text, c.kind)} />
                  )}
                </div>
                <div className="ai-meta">
                  <Pill>{CONSTRAINT_KINDS.find((k) => k.key === c.kind)?.name || c.kind}</Pill>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {open.length > 1 ? (
        <div>
          <Btn small icon="plus" onClick={() => { open.forEach((c) => addConstraint(p.id, c.text, c.kind)); toast(`${open.length} Rahmenbedingungen übernommen`); }}>
            Alle übernehmen
          </Btn>
        </div>
      ) : null}
      {(r.risks || []).length ? (
        <div className="ai-item">
          <b className="small">Risiken</b>
          <ul>
            {r.risks.map((x, i) => (
              <li key={i}>
                <b>{x.text}</b>
                {x.mitigation ? ` – ${x.mitigation}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {(r.checks || []).length ? (
        <div className="ai-item">
          <b className="small">Vorab prüfen</b>
          <ul>
            {r.checks.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ================= Roadmap =================
export function RoadmapDrawer({ data }) {
  const saved = data.house?.ai?.roadmap;
  const [adopted, setAdopted] = useState({});
  const adopt = (measures, keys) => {
    const map = { ...adopted };
    const valid = measures.filter((m) => keys.includes(m.key) && !m.existingProjectId && !map[m.key]);
    for (const m of valid) {
      const id = createProject({
        title: m.title,
        kind: m.kind,
        priority: m.priority,
        start: safeDate(m.start) || undefined,
        end: safeDate(m.end) || undefined,
        notes: [m.reason, m.saving || m.payback ? `Wirtschaftlichkeit: ${[m.saving && 'Ersparnis ' + m.saving, m.payback && 'Amortisation ' + m.payback, m.verdict].filter(Boolean).join(', ')}` : '', m.fundingHint ? 'Förderung: ' + m.fundingHint : ''].filter(Boolean).join('\n\n'),
        costs: m.costLow || m.costHigh ? [{ id: uid('k'), label: 'Schätzung Sanierungsfahrplan', estimate: Math.round(((Number(m.costLow) || 0) + (Number(m.costHigh) || Number(m.costLow) || 0)) / 2 / 100) * 100, offer: null, actual: null, vendor: '' }] : [],
      });
      map[m.key] = id;
    }
    for (const m of measures) if (m.existingProjectId && data.projects[m.existingProjectId]) map[m.key] = map[m.key] || m.existingProjectId;
    // wire dependencies between adopted measures
    setTimeout(() => {
      for (const m of valid) {
        const deps = (m.dependsOn || []).map((k) => map[k]).filter(Boolean);
        if (deps.length) patchProject(map[m.key], (x) => ({ ...x, dependsOn: [...new Set([...(x.dependsOn || []), ...deps])] }), 200);
      }
    }, 120);
    setAdopted(map);
    if (valid.length) toast(`${valid.length} Projekt${valid.length > 1 ? 'e' : ''} angelegt`);
  };
  return (
    <Drawer eyebrow="KI · Gesamtes Haus" title="Sanierungsfahrplan" icon="sparkles" onClose={closeDrawer} subtitle="Reihenfolge, Zeitpunkte, Kosten und Förderung für dein Haus">
      <div style={{ paddingTop: 12 }}>
        <AiRunner
          title="Sanierungsfahrplan erstellen"
          desc="Die KI wertet Baujahr, Bauteile, Verbräuche und deine bestehenden Projekte aus und schlägt eine sinnvolle Reihenfolge der Maßnahmen vor – inklusive Förderung und Pflichten nach dem Hauskauf."
          saved={saved}
          cta="Fahrplan erstellen"
          run={(signal) => aiRoadmap(data, { signal })}
          onSave={(rec) => updateHouse((h) => ({ ...h, ai: { ...(h.ai || {}), roadmap: rec } }), 100)}
          render={(r) => {
            const measures = (r.measures || []).filter((m) => m && m.title).map((m, i) => ({ ...m, key: m.key || 'm' + i }));
            const open = measures.filter((m) => !m.existingProjectId && !adopted[m.key]);
            return (
              <div className="stack" style={{ gap: 9 }}>
                {r.summary ? <p className="ai-summary">{r.summary}</p> : null}
                <ol className="ai-list">
                  {measures.map((m, i) => (
                    <li key={m.key} className="ai-item">
                      <div className="ai-item-head">
                        <span className="dsec-n">{i + 1}</span>
                        <b>{m.title}</b>
                        {m.existingProjectId && data.projects[m.existingProjectId] ? (
                          <button className="link" onClick={() => openDrawer({ type: 'project', id: m.existingProjectId })}>
                            vorhanden
                          </button>
                        ) : adopted[m.key] ? (
                          <button className="link" onClick={() => openDrawer({ type: 'project', id: adopted[m.key] })}>
                            <Icon name="check" size={13} /> angelegt
                          </button>
                        ) : (
                          <Btn small icon="plus" onClick={() => adopt(measures, [m.key])}>
                            Anlegen
                          </Btn>
                        )}
                      </div>
                      <div className="ai-meta">
                        <Pill>{projectKind(m.kind).name}</Pill>
                        {safeDate(m.start) ? <span>{fmtMonth(m.start)}{safeDate(m.end) ? ' – ' + fmtMonth(m.end) : ''}</span> : null}
                        {m.costLow || m.costHigh ? <b>{fmtEuro(m.costLow)} – {fmtEuro(m.costHigh)}</b> : null}
                        {m.priority === 1 ? <Pill tone="warn">dringend</Pill> : null}
                      </div>
                      {m.reason ? <p>{m.reason}</p> : null}
                      {m.saving ? <p>Ersparnis: {m.saving}</p> : null}
                      <AiVerdict verdict={m.verdict} payback={m.payback} />
                      {m.fundingHint ? (
                        <p>
                          <b>Förderung:</b> {m.fundingHint}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
                {open.length > 1 ? (
                  <div>
                    <Btn kind="primary" icon="plus" onClick={() => adopt(measures, open.map((m) => m.key))}>
                      Alle {open.length} als Projekte anlegen
                    </Btn>
                  </div>
                ) : null}
              </div>
            );
          }}
        />
      </div>
    </Drawer>
  );
}
