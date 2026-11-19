import { Icon } from './icons.jsx';
import { allSpots } from '../photos.js';
import { IconBtn, Seg, Btn, Pill, InstallFilter } from './common.jsx';
import { roomDims } from '../focus.js';
import { furnSize, furnName } from '../furniture.js';
import { roomOfPoint } from '../planops.js';
import { updateDoc } from '../store.js';
import { useUI, setUI, openDrawer, go, showFloor, hideWall, setHiddenWalls, toast, setShowPeople, setHudCompact } from './state.js';
import { portfolio, sortFloors, floorStats, componentWear, isDone, roomArea, buildingStats, liveProjects } from '../metrics.js';
import { projectKind, status as statusOf, roomType } from '../catalog.js';
import { ROOF_TYPES } from '../roof.js';
import { fmtEuro, fmtDayMonth, fmtFixed, todayISO, fmtNum } from '../util.js';
import { daysUntil } from '../metrics.js';
import { invoiceDeadlines } from '../invoices.js';
import { bearingName } from '../roof.js';

const { useMemo, useState, useEffect, useRef } = React;

export function KpiRow({ data }) {
  const ui = useUI();
  const projects = liveProjects(data.projects);
  const pf = useMemo(() => portfolio(projects), [data.projects]);
  const comps = Object.values(data.components);
  const due = comps.filter((c) => componentWear(c).state === 'faellig');
  const next = [...pf.next, ...invoiceDeadlines(data)].sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  const dn = next ? daysUntil(next.date) : null;
  const late = pf.overdue;
  const warnDate = dn != null && dn <= 21;
  if (ui.kpiCompact)
    return (
      <div className="kpis is-compact">
        <button type="button" className="kpi-line" onClick={() => setHudCompact('kpi', false)} aria-label="Kennzahlen aufklappen" title="Kennzahlen aufklappen">
          <span>
            <Icon name="tasks" size={14} /> {pf.done}/{pf.total}
          </span>
          <span>
            <Icon name="euro" size={14} /> {fmtEuro(pf.budget)}
          </span>
          <span className={warnDate ? 'is-warn' : ''}>
            <Icon name="calendar" size={14} /> {next ? fmtDayMonth(next.date) : '–'}
          </span>
          {late.length || due.length ? (
            <span className="is-warn">
              <Icon name={late.length ? 'clock' : 'alert'} size={14} /> {late.length ? `${late.length} im Verzug` : `${due.length} fällig`}
            </span>
          ) : null}
          <Icon name="chevD" size={14} />
        </button>
      </div>
    );
  return (
    <div className="kpis" role="list">
      <button className="kpi" role="listitem" onClick={() => go('projekte')}>
        <span className="kpi-ico tone-accent">
          <Icon name="tasks" />
        </span>
        <span className="kpi-txt">
          <span className="kpi-label">Modernisierung</span>
          <span className="kpi-val">
            {pf.done}
            <small>/{pf.total}</small>
          </span>
          <span className="kpi-sub">{pf.running.length ? `${pf.running.length} in Umsetzung` : `${pf.active.length} aktiv`}</span>
        </span>
      </button>
      <button className="kpi" role="listitem" onClick={() => go('projekte')}>
        <span className="kpi-ico tone-info">
          <Icon name="euro" />
        </span>
        <span className="kpi-txt">
          <span className="kpi-label">Budget geplant</span>
          <span className="kpi-val">{fmtEuro(pf.budget)}</span>
          <span className="kpi-sub">Förderung ca. {fmtEuro(pf.funding)}</span>
        </span>
      </button>
      <button className="kpi" role="listitem" onClick={() => next && (next.kind === 'invoice' ? openDrawer({ type: 'invoice', id: next.docId }) : openDrawer({ type: 'project', id: next.project.id }))} disabled={!next}>
        <span className={`kpi-ico ${dn != null && dn <= 21 ? 'tone-warn' : 'tone-neutral'}`}>
          <Icon name="calendar" />
        </span>
        <span className="kpi-txt">
          <span className="kpi-label">Nächste Frist</span>
          <span className={`kpi-val ${dn != null && dn <= 21 ? 'is-warn' : ''}`}>{next ? fmtDayMonth(next.date) : '–'}</span>
          <span className="kpi-sub">{next ? next.label : 'Keine offenen Termine'}</span>
        </span>
      </button>
      <button className="kpi" role="listitem" onClick={() => (late[0] ? openDrawer({ type: 'project', id: late[0].id }) : go('gebaeude'))}>
        <span className={`kpi-ico ${late.length ? 'tone-warn' : due.length ? 'tone-warn' : 'tone-accent'}`}>
          <Icon name={late.length ? 'clock' : 'alert'} />
        </span>
        <span className="kpi-txt">
          <span className="kpi-label">{late.length ? 'Terminlage' : 'Bauteile fällig'}</span>
          <span className={`kpi-val ${late.length || due.length ? 'is-warn' : ''}`}>{late.length ? `${late.length} im Verzug` : due.length}</span>
          <span className="kpi-sub">{late.length ? late.map((p) => p.title).join(', ') : due.length ? due.slice(0, 2).map((c) => c.name).join(', ') : 'Alles im Rahmen'}</span>
        </span>
      </button>
      <button type="button" className="kpi-fold" onClick={() => setHudCompact('kpi', true)} aria-label="Kennzahlen einklappen" title="Kennzahlen zu einer Zeile einklappen">
        <Icon name="chevU" size={15} />
      </button>
    </div>
  );
}

export function SceneToolbar({ sceneRef, data }) {
  const ui = useUI();
  const [menu, setMenu] = useState(false);
  const s = () => sceneRef.current;
  return (
    <>
      <div className="toolbar3d" role="toolbar" aria-label="Ansicht">
        <IconBtn className="tb-opt" icon="plus" label="Hineinzoomen" onClick={() => s()?.zoom(0.78)} />
        <IconBtn className="tb-opt" icon="minus" label="Herauszoomen" onClick={() => s()?.zoom(1.28)} />
        <span className="tb-sep tb-opt" />
        <IconBtn className="tb-opt" icon="rotL" label="Nach links drehen" onClick={() => s()?.rotate(-45)} />
        <IconBtn className="tb-opt" icon="rotR" label="Nach rechts drehen" onClick={() => s()?.rotate(45)} />
        <IconBtn icon="home" label="Ansicht zurücksetzen" onClick={() => { setUI({ mode: 'all', floorId: null }); s()?.resetView(); }} />
        <span className="tb-sep" />
        <IconBtn icon="eye" label="Ansicht: Dach, Möbel, Leitungen, Bewohner …" active={menu} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
      </div>
      {menu ? <ViewMenu data={data} onClose={() => setMenu(false)} /> : null}
    </>
  );
}

// everything that can be shown or hidden in the 3D model, in one place
function ViewMenu({ data, onClose }) {
  const ui = useUI();
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.toolbar3d')) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, []);
  const floors = sortFloors(Object.values(data.floors));
  const storeys = [...floors, ...(data.house?.model?.context || [])];
  const lineCount = storeys.reduce((n, f) => n + (f.lines || []).filter((l) => !l.auto).length, 0);
  const pointCount = storeys.reduce((n, f) => n + (f.points || []).length, 0);
  const furnCount = storeys.reduce((n, f) => n + (f.furniture || []).length, 0);
  const spotCount = allSpots(data).filter((q) => q.photos.length).length;
  const hidden = new Set(ui.hiddenWalls || []);
  const hiddenCount = floors.reduce((n, f) => n + (f.walls || []).filter((w) => hidden.has(w.id)).length, 0);
  const rows = [
    { key: 'roof', icon: 'roof', label: 'Dach', on: !!ui.showRoof, sub: ui.showRoof ? 'sichtbar' : 'ausgeblendet – Blick in die oberste Etage', set: (v) => setUI({ showRoof: v }) },
    { key: 'furn', icon: 'sofa', label: 'Möbel', on: ui.showFurniture !== false, sub: furnCount ? `${furnCount} ${furnCount === 1 ? 'Möbelstück' : 'Möbelstücke'}` : 'im Grundriss einrichten', set: (v) => setUI({ showFurniture: v }) },
    { key: 'lines', icon: 'pipe', label: 'Leitungen & Anschlüsse', on: ui.showLines === true, sub: lineCount + pointCount ? `Röntgenblick · ${[lineCount ? `${lineCount} Leitungen` : '', pointCount ? `${pointCount} Anschlüsse` : ''].filter(Boolean).join(' · ')}` : 'im Grundriss einzeichnen', set: (v) => setUI({ showLines: v }) },
    ...(spotCount ? [{ key: 'photos', icon: 'camera', label: 'Fotos', on: ui.showPhotos !== false, sub: `${spotCount} Fotopunkt${spotCount === 1 ? '' : 'e'} · in der Etagen-Ansicht`, set: (v) => setUI({ showPhotos: v }) }] : []),
    { key: 'people', icon: 'people', label: 'Bewohner', on: ui.showPeople !== false, sub: '2 laufen durchs Haus', set: (v) => setShowPeople(v) },
    { key: 'labels', icon: 'tag', label: 'Beschriftung', on: !!ui.showLabels, sub: 'Räume, Projekte, Nachbarn', set: (v) => setUI({ showLabels: v }) },
    { key: 'sun', icon: 'sun', label: 'Sonnenstand & Schatten', on: !!ui.sunOn, sub: 'Tag und Uhrzeit wählen', set: (v) => setUI({ sunOn: v }) },
  ];
  return (
    <div className="view-menu" role="menu" aria-label="Was im 3D-Modell zu sehen ist" ref={ref}>
      <div className="view-menu-head">
        <b>Ansicht</b>
        <IconBtn icon="x" size={15} label="Schließen" onClick={onClose} />
      </div>
      {rows.map((r) => (
        <div key={r.key}>
          <button type="button" role="menuitemcheckbox" aria-checked={r.on} className={`view-row ${r.on ? 'is-on' : ''}`} onClick={() => r.set(!r.on)}>
            <span className="view-row-ico">
              <Icon name={r.icon} size={16} />
            </span>
            <span className="view-row-txt">
              <b>{r.label}</b>
              <span>{r.sub}</span>
            </span>
            <span className={`view-switch ${r.on ? 'is-on' : ''}`} aria-hidden="true">
              <i />
            </span>
          </button>
          {r.key === 'lines' && r.on && lineCount + pointCount ? <InstallFilter className="fp-filter" /> : null}
        </div>
      ))}
      {hiddenCount ? (
        <button type="button" className="view-row is-on" onClick={() => setHiddenWalls([])}>
          <span className="view-row-ico">
            <Icon name="wall" size={16} />
          </span>
          <span className="view-row-txt">
            <b>Ausgeblendete Wände ({hiddenCount})</b>
            <span>antippen: alle wieder einblenden</span>
          </span>
        </button>
      ) : null}
    </div>
  );
}

export function FloorPanel({ data, compact }) {
  const ui = useUI();
  const floors = sortFloors(Object.values(data.floors)).reverse();
  return (
    <div className={`floorpanel ${compact ? 'is-compact' : ''}`}>
      <div className="fp-head">
        <span className="fp-title">
          <Icon name="layers" size={16} /> Etagen <b>{floors.length}</b>
        </span>
        <Seg
          small
          value={ui.mode === 'explode' ? 'explode' : 'all'}
          onChange={(v) => setUI({ mode: v, floorId: null })}
          options={[
            { value: 'all', label: 'Gesamt', icon: 'cube' },
            { value: 'explode', label: 'Schichten', icon: 'explode' },
          ]}
        />
      </div>
      <ul className="fp-list">
        {floors.map((f) => {
          const st = floorStats(f);
          const on = ui.mode === 'floor' && ui.floorId === f.id;
          return (
            <li key={f.id}>
              <button
                className={`fp-row ${on ? 'is-on' : ''}`}
                aria-pressed={on}
                onClick={() => (on ? setUI({ mode: 'all', floorId: null }) : showFloor(f.id))}
              >
                <span className="fp-short">{f.short || '–'}</span>
                <span className="fp-name">
                  <b>{f.name}</b>
                  <span>
                    {st.roomCount} Räume · {fmtFixed(st.usable, 1)} m²
                  </span>
                </span>
                <span className="fp-aside">
                  <Icon name="chevR" size={15} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const stepTone = (p, today) => {
  if (isDone(p)) return 'done';
  if (p.end && p.end < today && p.status !== 'pausiert') return 'late';
  if (p.status === 'umsetzung') return 'active';
  if (p.status === 'beauftragt') return 'booked';
  if (p.status === 'pausiert') return 'paused';
  return 'plan';
};

export function Timeline({ data }) {
  const ui = useUI();
  const today = todayISO();
  const projects = liveProjects(data.projects).sort((a, b) => (a.start || '9999') < (b.start || '9999') ? -1 : 1);
  if (ui.tlCompact && projects.length) {
    const tones = projects.map((p) => stepTone(p, today));
    const n = (t) => tones.filter((x) => x === t).length;
    return (
      <div className="timeline is-compact">
        <button type="button" className="tl-line" onClick={() => setHudCompact('tl', false)} aria-label="Modernisierungsablauf aufklappen" title="Modernisierungsablauf aufklappen">
          <Icon name="gantt" size={15} />
          <b>Ablauf</b>
          <span className="tl-line-txt">
            {n('done')}/{projects.length} fertig{n('active') ? ` · ${n('active')} in Umsetzung` : ''}
            {n('late') ? <em> · {n('late')} im Verzug</em> : null}
          </span>
          <span className="tl-mini" aria-hidden="true">
            {tones.map((t, i) => (
              <i key={i} className={`tone-${t}`} />
            ))}
          </span>
          <Icon name="chevU" size={14} />
        </button>
      </div>
    );
  }
  if (!projects.length)
    return (
      <div className="timeline">
        <div className="tl-head">
          <Icon name="gantt" size={16} /> Modernisierungsablauf
        </div>
        <button className="tl-empty" onClick={() => openDrawer({ type: 'project', id: null, create: true })}>
          <Icon name="plus" size={16} /> Erstes Projekt anlegen
        </button>
      </div>
    );
  return (
    <div className="timeline">
      <div className="tl-head">
        <span>
          <Icon name="gantt" size={16} /> Modernisierungsablauf
        </span>
        <span className="tl-head-side">
          <button className="link" onClick={() => go('projekte')}>
            Zeitplan <Icon name="chevR" size={14} />
          </button>
          <IconBtn icon="chevD" size={15} className="tl-fold" label="Ablauf zu einer Zeile einklappen" onClick={() => setHudCompact('tl', true)} />
        </span>
      </div>
      <ol className="tl-steps">
        {projects.map((p) => {
          const tone = stepTone(p, today);
          return (
            <li key={p.id}>
              <button className={`tl-step tone-${tone}`} onClick={() => openDrawer({ type: 'project', id: p.id })} title={p.title}>
                <span className="tl-dot">
                  <Icon name={tone === 'done' ? 'check' : projectKind(p.kind).icon} size={14} stroke={2} />
                </span>
                <span className="tl-label">{p.title}</span>
                <span className="tl-date">{tone === 'late' ? 'im Verzug' : p.start ? fmtDayMonth(p.start) : statusOf(p.status).name}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function SelectionCard({ data }) {
  const ui = useUI();
  const sel = ui.selection;
  if (!sel) return null;
  const floors = Object.values(data.floors);
  if (sel.type === 'room') {
    const f = data.floors[sel.floorId];
    const r = f?.rooms?.find((x) => x.id === sel.roomId);
    if (!r) return null;
    const comps = Object.values(data.components).filter((c) => c.roomId === r.id);
    const dims = roomDims(r, f);
    return (
      <div className="selcard">
        <div className="sel-crumb">
          {f.short} · {f.name}
        </div>
        <div className="sel-main">
          <span className="sel-swatch" data-type={r.type} />
          <div>
            <b>{r.name || roomType(r.type).name}</b>
            <div className="sel-meta">
              <Pill tone="accent">{fmtFixed(roomArea(r), 1)} m²</Pill>
              <span>{roomType(r.type).name}</span>
              {comps.length ? <span>{comps.length} Bauteile</span> : null}
            </div>
            {dims ? (
              <div className="sel-dims">
                {dims.rect ? '' : 'max. '}
                {fmtFixed(dims.width, 2)} × {fmtFixed(dims.depth, 2)} m · Umfang {fmtFixed(dims.perimeter, 2)} m{dims.height ? ` · Höhe ${fmtFixed(dims.height, 2)} m` : dims.underRoof ? ' · unter der Dachschräge' : ''}
              </div>
            ) : null}
          </div>
        </div>
        <div className="sel-actions">
          <Btn small icon="edit" onClick={() => openDrawer({ type: 'room', floorId: f.id, roomId: r.id })}>
            Details
          </Btn>
          <Btn small kind="ghost" icon="plan" onClick={() => { setUI({ floorId: f.id }); go('grundriss'); }}>
            Grundriss
          </Btn>
          <IconBtn icon="x" label="Auswahl aufheben" onClick={() => setUI({ selection: null })} />
        </div>
      </div>
    );
  }
  if (sel.type === 'roof') {
    const st = buildingStats(data.house, floors);
    const sec = data.house?.model?.roofSections?.find((s) => s.id === sel.sectionId) || data.house?.model?.roofSections?.[0];
    const best = [...st.pv].sort((a, b) => b.kwhYear - a.kwhYear)[0];
    return (
      <div className="selcard">
        <div className="sel-crumb">Dach</div>
        <div className="sel-main">
          <span className="sel-swatch roof" />
          <div>
            <b>{ROOF_TYPES.find((t) => t.key === sec?.type)?.name || 'Dach'} · {fmtNum(sec?.pitch, 0)}°</b>
            <div className="sel-meta">
              <span>{fmtFixed(st.roofArea, 0)} m² Dachfläche</span>
              {best ? (
                <Pill tone="accent" icon="sun">
                  {bearingName(best.azimuth ?? 180)}: ~{fmtFixed(st.pvKwp, 1)} kWp möglich
                </Pill>
              ) : null}
            </div>
          </div>
        </div>
        <div className="sel-actions">
          <Btn small icon="sun" onClick={() => openDrawer({ type: 'project', id: null, create: true, preset: { kind: 'pv', title: 'PV-Anlage' } })}>
            PV-Projekt
          </Btn>
          <Btn small kind="ghost" icon="plan" onClick={() => { setUI({ floorId: 'roof' }); go('grundriss'); }}>
            Dach bearbeiten
          </Btn>
          <IconBtn icon="x" label="Auswahl aufheben" onClick={() => setUI({ selection: null })} />
        </div>
      </div>
    );
  }
  if (sel.type === 'furn') {
    const f = data.floors[sel.floorId];
    const x = f?.furniture?.find((q) => q.id === sel.furnId);
    if (!x) return null;
    const { w, d, h } = furnSize(x);
    const room = roomOfPoint(f, { x: x.x, y: x.y });
    const setF = (patch) => updateDoc('floors', f.id, (fl) => ({ ...fl, furniture: (fl.furniture || []).map((q) => (q.id === x.id ? { ...q, ...patch } : q)) }), 200);
    const rot = Math.round((((x.rot || 0) % 360) + 360) % 360);
    return (
      <div className="selcard">
        <div className="sel-crumb">
          {f.short} · {f.name}
          {room ? ` · ${room.name}` : ''}
        </div>
        <div className="sel-main">
          <span className="sel-swatch wall" aria-hidden="true">
            <Icon name="sofa" size={16} />
          </span>
          <div>
            <b>{x.label || furnName(x)}</b>
            <div className="sel-meta">
              <Pill tone="accent">
                {Math.round(w * 100)} × {Math.round(d * 100)} × {Math.round(h * 100)} cm
              </Pill>
              <span>{rot}°</span>
              {x.mirror ? <span>gespiegelt</span> : null}
            </div>
          </div>
        </div>
        <div className="sel-actions">
          <Btn small kind={x.mirror ? 'soft' : 'primary'} icon="flip" onClick={() => setF({ mirror: !x.mirror })} aria-pressed={!!x.mirror}>
            {x.mirror ? 'Zurückspiegeln' : 'Spiegeln'}
          </Btn>
          <Btn small kind="ghost" icon="rotR" onClick={() => setF({ rot: (rot + 90) % 360 })}>
            Drehen
          </Btn>
          <Btn small kind="ghost" icon="plan" onClick={() => { setUI({ floorId: f.id }); go('grundriss'); }}>
            Grundriss
          </Btn>
          <IconBtn icon="x" label="Auswahl aufheben" onClick={() => setUI({ selection: sel.focus || null })} />
        </div>
      </div>
    );
  }
  if (sel.type === 'wall') {
    const f = data.floors[sel.floorId];
    const w = f?.walls?.find((x) => x.id === sel.wallId);
    if (!w) return null;
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const n = (w.openings || []).length;
    const back = () => setUI({ selection: sel.focus || null });
    return (
      <div className="selcard">
        <div className="sel-crumb">
          {f.short} · {f.name}
        </div>
        <div className="sel-main">
          <span className="sel-swatch wall" aria-hidden="true">
            <Icon name="wall" size={16} />
          </span>
          <div>
            <b>{w.ext ? 'Außenwand' : 'Innenwand'}</b>
            <div className="sel-meta">
              <Pill tone="accent">{fmtFixed(L, 2)} m</Pill>
              <span>{fmtFixed((w.t || 0) * 100, 1)} cm dick</span>
              {n ? <span>{n} {n === 1 ? 'Öffnung' : 'Öffnungen'}</span> : null}
            </div>
          </div>
        </div>
        <div className="sel-actions">
          <Btn
            small
            kind="primary"
            icon="eyeOff"
            onClick={() => {
              hideWall(w.id);
              back();
              toast('Wand ausgeblendet. Zurückholen: „Ausgeblendete Wände“ in der Etagen-Liste.', 'ok', 4500);
            }}
          >
            Ausblenden
          </Btn>
          <Btn small kind="ghost" icon="plan" onClick={() => { setUI({ floorId: f.id }); go('grundriss'); }}>
            Grundriss
          </Btn>
          <IconBtn icon="x" label="Auswahl aufheben" onClick={back} />
        </div>
      </div>
    );
  }
  if (sel.type === 'floor') {
    const f = data.floors[sel.floorId];
    if (!f) return null;
    const st = floorStats(f);
    return (
      <div className="selcard">
        <div className="sel-crumb">Etage</div>
        <div className="sel-main">
          <span className="sel-swatch floor">{f.short}</span>
          <div>
            <b>{f.name}</b>
            <div className="sel-meta">
              <span>{st.roomCount} Räume</span>
              <span>{fmtFixed(st.living, 1)} m² Wohnfläche</span>
              <span>{st.windows} Fenster</span>
            </div>
          </div>
        </div>
        <div className="sel-actions">
          <Btn small icon="layers" onClick={() => showFloor(f.id)}>
            Einzeln zeigen
          </Btn>
          <Btn small kind="ghost" icon="plan" onClick={() => { setUI({ floorId: f.id }); go('grundriss'); }}>
            Grundriss
          </Btn>
          <IconBtn icon="x" label="Auswahl aufheben" onClick={() => setUI({ selection: null })} />
        </div>
      </div>
    );
  }
  return null;
}
