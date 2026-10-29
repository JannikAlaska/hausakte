import { Icon } from './icons.jsx';
import { IconBtn, Seg, Btn, Pill } from './common.jsx';
import { useUI, setUI, openDrawer, go, showFloor } from './state.js';
import { portfolio, sortFloors, floorStats, componentWear, isDone, roomArea, buildingStats } from '../metrics.js';
import { projectKind, status as statusOf, roomType } from '../catalog.js';
import { ROOF_TYPES } from '../roof.js';
import { fmtEuro, fmtDayMonth, fmtFixed, todayISO, fmtNum } from '../util.js';
import { daysUntil } from '../metrics.js';
import { bearingName } from '../roof.js';

const { useMemo } = React;

export function KpiRow({ data }) {
  const projects = Object.values(data.projects);
  const pf = useMemo(() => portfolio(projects), [data.projects]);
  const comps = Object.values(data.components);
  const due = comps.filter((c) => componentWear(c).state === 'faellig');
  const next = pf.next[0];
  const dn = next ? daysUntil(next.date) : null;
  const late = pf.overdue;
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
      <button className="kpi" role="listitem" onClick={() => next && openDrawer({ type: 'project', id: next.project.id })} disabled={!next}>
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
    </div>
  );
}

export function SceneToolbar({ sceneRef }) {
  const ui = useUI();
  const s = () => sceneRef.current;
  return (
    <div className="toolbar3d" role="toolbar" aria-label="Ansicht">
      <IconBtn className="tb-opt" icon="plus" label="Hineinzoomen" onClick={() => s()?.zoom(0.78)} />
      <IconBtn className="tb-opt" icon="minus" label="Herauszoomen" onClick={() => s()?.zoom(1.28)} />
      <span className="tb-sep tb-opt" />
      <IconBtn className="tb-opt" icon="rotL" label="Nach links drehen" onClick={() => s()?.rotate(-45)} />
      <IconBtn className="tb-opt" icon="rotR" label="Nach rechts drehen" onClick={() => s()?.rotate(45)} />
      <IconBtn icon="home" label="Ansicht zurücksetzen" onClick={() => { setUI({ mode: 'all', floorId: null }); s()?.resetView(); }} />
      <span className="tb-sep tb-opt" />
      <IconBtn icon={ui.showRoof ? 'roof' : 'eyeOff'} label={ui.showRoof ? 'Dach ausblenden' : 'Dach einblenden'} active={!ui.showRoof} onClick={() => setUI({ showRoof: !ui.showRoof })} />
      <IconBtn icon="tag" label={ui.showLabels ? 'Beschriftung ausblenden' : 'Beschriftung einblenden'} active={!ui.showLabels} onClick={() => setUI({ showLabels: !ui.showLabels })} />
      <IconBtn icon="sun" label={ui.sunOn ? 'Sonnenstand ausblenden' : 'Sonnenstand und Schatten'} active={!!ui.sunOn} onClick={() => setUI({ sunOn: !ui.sunOn })} />
    </div>
  );
}

export function FloorPanel({ data, compact }) {
  const ui = useUI();
  const floors = sortFloors(Object.values(data.floors)).reverse();
  const lineCount = floors.reduce((n, f) => n + (f.lines || []).length, 0);
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
        <li>
          <button className={`fp-row ${ui.mode === 'all' && ui.showRoof ? '' : 'is-dim'}`} onClick={() => setUI({ showRoof: !ui.showRoof })}>
            <span className="fp-short">
              <Icon name="roof" size={15} />
            </span>
            <span className="fp-name">
              <b>Dach</b>
              <span>{ui.showRoof ? 'sichtbar' : 'ausgeblendet'}</span>
            </span>
            <span className="fp-aside">
              <Icon name={ui.showRoof ? 'eye' : 'eyeOff'} size={15} />
            </span>
          </button>
        </li>
        <li>
          <button className={`fp-row ${ui.showLines === true ? 'is-on' : 'is-dim'}`} aria-pressed={ui.showLines === true} onClick={() => setUI({ showLines: ui.showLines !== true })} title="Röntgenblick: Wände durchsichtig, Kabel und Rohre sichtbar">
            <span className="fp-short">
              <Icon name="pipe" size={15} />
            </span>
            <span className="fp-name">
              <b>Leitungen</b>
              <span>{lineCount ? (ui.showLines === true ? 'Röntgenblick an' : `${lineCount} eingezeichnet`) : 'im Grundriss einzeichnen'}</span>
            </span>
            <span className="fp-aside">
              <Icon name={ui.showLines === true ? 'eye' : 'eyeOff'} size={15} />
            </span>
          </button>
        </li>
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
  const today = todayISO();
  const projects = Object.values(data.projects).sort((a, b) => (a.start || '9999') < (b.start || '9999') ? -1 : 1);
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
        <button className="link" onClick={() => go('projekte')}>
          Zeitplan <Icon name="chevR" size={14} />
        </button>
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
