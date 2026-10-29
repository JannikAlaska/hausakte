import { HouseScene } from './scene.js';
import { initStore, loadDataset, clearAll, exportData, getState } from './store.js';
import { createTemplate, createEmptyHouse } from './template.js';
import { useUI, useData, setUI, go, openDrawer, closeDrawer, toast, getUI, sceneHandle } from './ui/state.js';
import { SunPanel, solarResult } from './ui/solar.jsx';
import { localToUtc, doyOf } from './solar.js';
import { Icon } from './ui/icons.jsx';
import { Btn, IconBtn, ConfirmBtn } from './ui/common.jsx';
import { KpiRow, SceneToolbar, FloorPanel, Timeline, SelectionCard } from './ui/ModelHud.jsx';
import { ProjectsSheet, ProjectDrawer, RoadmapDrawer } from './ui/projects.jsx';
import { BuildingSheet, RoomDrawer, ComponentDrawer } from './ui/building.jsx';
import { PlanEditor } from './ui/plan.jsx';
import { ConsumptionSheet } from './ui/consumption.jsx';
import { DocumentsSheet } from './ui/documents.jsx';
import { AssistantDrawer } from './ui/assistant.jsx';
import { projectKind, gewerk, roomType } from './catalog.js';
import { fmtTime, fmtArea } from './util.js';
import { portfolio, buildingStats, roomArea } from './metrics.js';
import { isSupabaseMode, getSession, onAuth, signIn, signUp, resetPassword, updatePassword, authErrorText } from './supa.js';

const { useEffect, useRef, useMemo, useState, useLayoutEffect } = React;

const VIEWS = [
  { key: 'modell', label: 'Modell', icon: 'cube' },
  { key: 'grundriss', label: 'Grundriss', icon: 'plan' },
  { key: 'gebaeude', label: 'Gebäude', icon: 'building' },
  { key: 'projekte', label: 'Projekte', icon: 'tasks' },
  { key: 'verbrauch', label: 'Verbrauch', icon: 'chart' },
  { key: 'dokumente', label: 'Dokumente', icon: 'folder' },
];

function SceneView({ data, sceneRef }) {
  const host = useRef(null);
  const ui = useUI();
  useEffect(() => {
    const scene = new HouseScene(host.current, {
      onPick: (hit) => {
        const u = getUI();
        if (!hit) {
          if (u.selection) setUI({ selection: null });
          return;
        }
        if (hit.type === 'project') return openDrawer({ type: 'project', id: hit.projectId });
        if (hit.type === 'room') return setUI({ selection: hit });
        if (hit.type === 'floor') return setUI({ selection: hit });
        if (hit.type === 'roof') return setUI({ selection: hit });
      },
    });
    sceneRef.current = scene;
    sceneHandle.current = scene;
    const mo = new MutationObserver(() => scene.setTheme());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => scene.setTheme();
    mq.addEventListener?.('change', onMq);
    return () => {
      mo.disconnect();
      mq.removeEventListener?.('change', onMq);
      scene.dispose();
      sceneRef.current = null;
      sceneHandle.current = null;
    };
  }, []);

  // geometry: rebuild when house, floors, projects or components change
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !data.house) return;
    const id = requestAnimationFrame(() =>
      s.setData({ house: data.house, floors: Object.values(data.floors), projects: Object.values(data.projects), components: data.components }),
    );
    return () => cancelAnimationFrame(id);
  }, [data.house, data.floors, data.projects, data.components]);

  // view mode; the plan editor shows its floor in isolation
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    if (ui.view === 'grundriss') {
      const fid = ui.floorId && ui.floorId !== 'roof' ? ui.floorId : null;
      const showLines = ui.planLines !== false;
      if (fid) s.setView({ mode: 'floor', floorId: fid, showRoof: ui.showRoof, showLabels: ui.showLabels, showLines });
      else s.setView({ mode: 'all', floorId: null, showRoof: true, showLabels: ui.showLabels, showLines });
    } else s.setView({ mode: ui.mode, floorId: ui.floorId, showRoof: ui.showRoof, showLabels: ui.showLabels, showLines: ui.showLines === true });
  }, [ui.view, ui.mode, ui.floorId, ui.showRoof, ui.showLabels, ui.showLines, ui.planLines, data.house]);

  useEffect(() => {
    sceneRef.current?.setSelection(ui.selection);
  }, [ui.selection, data.floors]);

  // real sun position for the sun study
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const year = new Date().getFullYear();
    s.setSun(ui.sunOn && ui.view === 'modell' ? { date: localToUtc(year, ui.sunDoy ?? doyOf(new Date()), ui.sunMin ?? 780) } : null);
  }, [ui.sunOn, ui.sunDoy, ui.sunMin, ui.view, data.house]);

  // PV shading colours on the roof
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const id = requestAnimationFrame(() => s.setPvHeat(ui.pvHeat ? solarResult(data) : null));
    return () => cancelAnimationFrame(id);
  }, [ui.pvHeat, data.house, data.floors]);

  useEffect(() => {
    sceneRef.current?.setCompact(ui.mobile);
  }, [ui.mobile]);

  // highlight what the open drawer is about
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const d = ui.drawer;
    let h = null;
    if (d?.type === 'project' && data.projects[d.id]) {
      const p = data.projects[d.id];
      const comp = (p.components || []).map((c) => data.components[c]).find((c) => c?.roomId);
      h = s.highlightFor(projectKind(p.kind).target, { roomId: comp?.roomId });
    } else if (d?.type === 'component' && data.components[d.id]) {
      const c = data.components[d.id];
      h = s.highlightFor(gewerk(c.gewerk).target, { roomId: c.roomId, floorId: c.floorId });
    } else if (d?.type === 'room') h = { target: 'room', roomId: d.roomId };
    else if (ui.selection?.type === 'roof') h = { target: 'roof' };
    s.setHighlight(h);
  }, [ui.drawer, ui.selection, data.projects, data.components]);

  // keep the model centered in the area not covered by sheets/drawers
  useLayoutEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const measure = () => {
      const W = window.innerWidth;
      const sheet = document.querySelector('.sheet');
      const drawer = document.querySelector('.drawer');
      let left = 0,
        right = 0;
      if (sheet && ui.wide) left = sheet.getBoundingClientRect().right;
      if (drawer && ui.wide) right = W - drawer.getBoundingClientRect().left;
      if (ui.mobile) s.setInsets({ left: 0, right: 0, top: ui.view === 'modell' ? 120 : 56, bottom: ui.view === 'modell' ? 120 : 60 });
      else s.setInsets({ left, right, top: ui.view === 'modell' ? 170 : 70, bottom: ui.view === 'modell' ? 110 : 0 });
    };
    measure();
    const t = setTimeout(measure, 260);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
    };
  }, [ui.view, ui.drawer?.type, ui.wide, ui.mobile, data.loaded, !!data.house]);

  return <div className="scene-host" ref={host} />;
}

function SearchBox({ data }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const out = [];
    for (const f of Object.values(data.floors))
      for (const r of f.rooms || [])
        if ((r.name || '').toLowerCase().includes(s)) out.push({ icon: 'room', title: r.name, sub: `${f.name} · ${fmtArea(roomArea(r))}`, go: () => { setUI({ mode: 'floor', floorId: f.id, selection: { type: 'room', floorId: f.id, roomId: r.id } }); go('modell'); } });
    for (const p of Object.values(data.projects))
      if (p.title.toLowerCase().includes(s)) out.push({ icon: projectKind(p.kind).icon, title: p.title, sub: 'Projekt', go: () => openDrawer({ type: 'project', id: p.id }) });
    for (const c of Object.values(data.components))
      if (`${c.name} ${c.material}`.toLowerCase().includes(s)) out.push({ icon: gewerk(c.gewerk).icon, title: c.name, sub: `${gewerk(c.gewerk).name} · ${c.material || ''}`, go: () => openDrawer({ type: 'component', id: c.id }) });
    for (const d of Object.values(data.documents))
      if ((d.name || '').toLowerCase().includes(s)) out.push({ icon: 'file', title: d.name, sub: 'Dokument', go: () => go('dokumente') });
    return out.slice(0, 12);
  }, [q, data]);
  return (
    <div className="search">
      <Icon name="search" size={16} />
      <input
        id="global-search"
        type="search"
        placeholder="Räume, Bauteile, Projekte suchen"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { results[0].go(); setOpen(false); } }}
        aria-label="Suchen"
      />
      {open && results.length ? (
        <div className="search-results">
          {results.map((r, i) => (
            <button key={i} onMouseDown={(e) => e.preventDefault()} onClick={() => { r.go(); setOpen(false); setQ(''); }}>
              <Icon name={r.icon} size={16} />
              <span>
                {r.title}
                <small>{r.sub}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TopBar({ data }) {
  const ui = useUI();
  const h = data.house;
  const pf = portfolio(Object.values(data.projects));
  const pct = pf.total ? Math.round((pf.done / pf.total) * 100) : 0;
  const code = h?.zip || (h?.name || 'Haus').split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  const busy = data.saving > 0;
  return (
    <header className="topbar float">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="home" size={18} stroke={2} />
        </span>
        <span className="brand-name">Hausakte</span>
      </div>
      {h ? (
        <button className="house-chip" onClick={() => go('gebaeude')} title="Gebäudedaten öffnen">
          <span className="house-code">{code}</span>
          <span className="house-txt">
            <b>{h.name || 'Mein Haus'}{h.city ? ' · ' + h.city : ''}</b>
            <span>
              {pct} % modernisiert · Baujahr {h.buildYear || '?'}
            </span>
          </span>
        </button>
      ) : null}
      <nav className="views" aria-label="Bereiche">
        {VIEWS.map((v) => (
          <button key={v.key} className={`view-btn ${ui.view === v.key ? 'is-on' : ''}`} aria-current={ui.view === v.key ? 'page' : undefined} onClick={() => go(v.key)} title={v.label}>
            <Icon name={v.icon} size={16} />
            <span>{v.label}</span>
          </button>
        ))}
      </nav>
      <span className="top-spacer" />
      <SearchBox data={data} />
      <span className="sync" title={data.mode === 'local' ? 'Daten liegen nur in diesem Browser' : data.lastSaved ? 'Zuletzt gespeichert ' + fmtTime(data.lastSaved) : 'Gespeichert in der Hausakte'}>
        <span className={`sync-dot ${busy ? 'is-busy' : data.mode === 'local' ? 'is-local' : ''}`} />
        <span>{busy ? 'Speichert …' : data.mode === 'local' ? 'Nur lokal' : data.lastSaved ? 'Gespeichert' : 'Synchron'}</span>
      </span>
      <button className={`ai-btn ${ui.drawer?.type === 'assistant' ? 'is-on' : ''}`} onClick={() => (ui.drawer?.type === 'assistant' ? closeDrawer() : openDrawer({ type: 'assistant' }))}>
        <Icon name="sparkles" size={17} />
        <span>Assistent</span>
      </button>
    </header>
  );
}

function BottomNav() {
  const ui = useUI();
  return (
    <nav className="bottomnav" aria-label="Bereiche">
      {VIEWS.map((v) => (
        <button key={v.key} className={ui.view === v.key ? 'is-on' : ''} aria-current={ui.view === v.key ? 'page' : undefined} onClick={() => go(v.key)}>
          <Icon name={v.icon} size={20} />
          <span>{v.label}</span>
        </button>
      ))}
    </nav>
  );
}

function Welcome({ onDone }) {
  const fileRef = useRef(null);
  const importFile = async (file) => {
    try {
      const obj = JSON.parse(await file.text());
      if (!obj.house) throw new Error('Keine Hausakte-Sicherung');
      clearAll();
      setTimeout(() => loadDataset(obj), 400);
      toast('Sicherung importiert');
      onDone?.();
    } catch (e) {
      toast('Die Datei ist keine gültige Hausakte-Sicherung (JSON).', 'err');
    }
  };
  return (
    <div className="welcome" role="dialog" aria-label="Hausakte einrichten">
      <span className="brand-mark" style={{ width: 44, height: 44, borderRadius: 13 }}>
        <Icon name="home" size={24} stroke={2} />
      </span>
      <h1>Deine Hausakte</h1>
      <p>Erfasse dein Haus als 3D-Modell mit Grundrissen, Bauteilen, Verbräuchen und Dokumenten – und plane die Modernisierung mit KI-Hinweisen zu Förderung, Zeitplan und Kosten.</p>
      <div className="welcome-opts">
        <button className="welcome-opt" onClick={() => { loadDataset(createTemplate()); onDone?.(); }}>
          <Icon name="cube" size={22} />
          <span>
            <b>Mit Beispielhaus starten</b>
            <span>Einfamilienhaus von 1978 mit Keller, zwei Geschossen und Beispielprojekten. Ideal zum Ausprobieren.</span>
          </span>
        </button>
        <button className="welcome-opt" onClick={() => { loadDataset(createEmptyHouse()); go('grundriss'); onDone?.(); }}>
          <Icon name="plan" size={22} />
          <span>
            <b>Eigenes Haus zeichnen</b>
            <span>Startet mit einem leeren Erdgeschoss (10 × 8 m). Wände, Räume und Etagen legst du im Grundriss an.</span>
          </span>
        </button>
        <button className="welcome-opt" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={22} />
          <span>
            <b>Sicherung importieren</b>
            <span>Eine zuvor exportierte Hausakte (.json) laden.</span>
          </span>
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files[0] && importFile(e.target.files[0])} />
      </div>
    </div>
  );
}

function Banners({ data }) {
  const ui = useUI();
  const [hideEx, setHideEx] = useState(false);
  const [reset, setReset] = useState(false);
  if (data.error)
    return (
      <div className="banner" role="status">
        <Icon name="alert" size={16} />
        <span>{data.error}</span>
      </div>
    );
  if (reset) return <ResetDialog onClose={() => setReset(false)} />;
  if (data.house?.example && !hideEx && ui.view === 'modell' && !ui.drawer)
    return (
      <div className="banner" role="status">
        <Icon name="info" size={16} />
        <span>
          <b>Beispielhaus.</b> Ersetze die Werte durch dein Haus oder schick mir deine Grundrisse.
        </span>
        <Btn small kind="primary" onClick={() => setReset(true)}>
          Eigenes Haus
        </Btn>
        <IconBtn icon="x" label="Hinweis ausblenden" onClick={() => setHideEx(true)} />
      </div>
    );
  return null;
}

function ResetDialog({ onClose }) {
  return (
    <div className="welcome" role="dialog" aria-label="Neu beginnen">
      <h1>Neu beginnen</h1>
      <p>Das Beispielhaus und alle Beispielprojekte werden gelöscht. Danach startest du mit einem leeren Erdgeschoss und zeichnest deinen Grundriss.</p>
      <div className="hstack">
        <ConfirmBtn
          small={false}
          icon="trash"
          confirmText="Ja, alles löschen"
          onConfirm={() => {
            clearAll();
            setTimeout(() => {
              loadDataset(createEmptyHouse());
              go('grundriss');
            }, 600);
            onClose();
          }}
        >
          Beispiel löschen und neu starten
        </ConfirmBtn>
        <Btn onClick={onClose}>Abbrechen</Btn>
      </div>
    </div>
  );
}

function Toasts() {
  const ui = useUI();
  return (
    <div className="toasts" aria-live="polite">
      {ui.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <Icon name={t.tone === 'err' ? 'alert' : t.tone === 'warn' ? 'info' : 'checkCircle'} size={16} />
          {t.text}
        </div>
      ))}
    </div>
  );
}

function DrawerHost({ data, sceneRef }) {
  const ui = useUI();
  const d = ui.drawer;
  if (!d) return null;
  if (d.type === 'project') return <ProjectDrawer key={d.id || 'new'} data={data} drawer={d} />;
  if (d.type === 'room') return <RoomDrawer key={d.roomId} data={data} drawer={d} />;
  if (d.type === 'component') return <ComponentDrawer key={d.id} data={data} drawer={d} />;
  if (d.type === 'roadmap') return <RoadmapDrawer data={data} />;
  if (d.type === 'assistant') return <AssistantDrawer data={data} sceneRef={sceneRef} />;
  return null;
}


// ---------- login (only when the page runs with Supabase) ----------
function useAuth() {
  const [auth, setAuth] = useState(() => (isSupabaseMode() ? { status: 'checking' } : { status: 'none' }));
  useEffect(() => {
    if (!isSupabaseMode()) return;
    let alive = true;
    const off = onAuth((session, ev) => {
      if (ev === 'PASSWORD_RECOVERY') return setAuth({ status: 'recovery' });
      if (ev === 'SIGNED_OUT') return setAuth({ status: 'out' });
      if (session) setAuth((a) => (a.status === 'recovery' ? a : { status: 'in' }));
    });
    getSession()
      .then((s) => alive && setAuth((a) => (a.status === 'recovery' || a.status === 'in' ? a : { status: s ? 'in' : 'out' })))
      .catch(() => alive && setAuth({ status: 'out' }));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return [auth, setAuth];
}

function Login({ auth, setAuth }) {
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState(auth.status === 'recovery' ? 'recovery' : params.get('einladung') ? 'signup' : 'login');
  const [email, setEmail] = useState(params.get('email') || '');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState(params.get('einladung') || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (auth.status === 'recovery') setMode('recovery');
  }, [auth.status]);
  const submit = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (mode !== 'reset' && pw.length < (mode === 'login' ? 1 : 8)) return setMsg({ err: true, text: 'Das Passwort muss mindestens 8 Zeichen haben.' });
    setBusy(true);
    try {
      if (mode === 'login') await signIn(email, pw);
      else if (mode === 'signup') await signUp(email, pw, code);
      else if (mode === 'reset') {
        await resetPassword(email);
        setMsg({ text: 'Wenn es ein Konto zu dieser Adresse gibt, kommt gleich eine E-Mail mit einem Link zum Zurücksetzen.' });
      } else if (mode === 'recovery') {
        await updatePassword(pw);
        history.replaceState(null, '', location.pathname);
        setAuth({ status: 'in' });
      }
    } catch (err) {
      setMsg({ err: true, text: authErrorText(err) });
    }
    setBusy(false);
  };
  const T = {
    login: ['Anmelden', 'Melde dich an, um deine Hausakte zu öffnen.', 'Anmelden'],
    signup: ['Konto anlegen', 'Du brauchst einen Einladungscode. Den bekommst du von der Person, die die Hausakte angelegt hat.', 'Konto anlegen'],
    reset: ['Passwort vergessen', 'Wir schicken dir einen Link, mit dem du ein neues Passwort setzt.', 'Link senden'],
    recovery: ['Neues Passwort', 'Lege ein neues Passwort fest.', 'Speichern'],
  }[mode];
  if (auth.status === 'checking')
    return (
      <div className="banner" role="status">
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
        Anmeldung wird geprüft …
      </div>
    );
  return (
    <form className="welcome login" onSubmit={submit} aria-label={T[0]}>
      <span className="brand-mark" style={{ width: 44, height: 44, borderRadius: 13 }}>
        <Icon name="home" size={24} stroke={2} />
      </span>
      <div>
        <h1>{mode === 'login' ? 'Hausakte' : T[0]}</h1>
        <p>{T[1]}</p>
      </div>
      {mode !== 'recovery' ? (
        <label className="field">
          <span className="field-label">E-Mail</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      ) : null}
      {mode !== 'reset' ? (
        <label className="field">
          <span className="field-label">{mode === 'login' ? 'Passwort' : 'Neues Passwort (mind. 8 Zeichen)'}</span>
          <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
      ) : null}
      {mode === 'signup' ? (
        <label className="field">
          <span className="field-label">Einladungscode</span>
          <input className="input" required autoComplete="off" placeholder="XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} style={{ fontFamily: 'var(--font-mono)', letterSpacing: 1 }} />
        </label>
      ) : null}
      {msg ? (
        <div className={`callout ${msg.err ? 'callout-warn' : ''}`} role={msg.err ? 'alert' : 'status'}>
          <Icon name={msg.err ? 'alert' : 'info'} size={16} />
          <span>{msg.text}</span>
        </div>
      ) : null}
      <Btn kind="primary" type="submit" disabled={busy}>
        {busy ? 'Einen Moment …' : T[2]}
      </Btn>
      <div className="login-links">
        {mode === 'login' ? (
          <>
            <button type="button" className="link" onClick={() => (setMode('signup'), setMsg(null))}>
              Ich habe einen Einladungscode
            </button>
            <button type="button" className="link" onClick={() => (setMode('reset'), setMsg(null))}>
              Passwort vergessen?
            </button>
          </>
        ) : mode !== 'recovery' ? (
          <button type="button" className="link" onClick={() => (setMode('login'), setMsg(null))}>
            Zurück zur Anmeldung
          </button>
        ) : null}
      </div>
    </form>
  );
}

function App() {
  const data = useData();
  const ui = useUI();
  const sceneRef = useRef(null);
  const [auth, setAuth] = useAuth();
  const authed = auth.status === 'none' || auth.status === 'in';
  useEffect(() => {
    if (authed) initStore();
  }, [authed]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        if (getUI().drawer) closeDrawer();
        else if (getUI().selection) setUI({ selection: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ready = data.loaded;
  const hasHouse = !!data.house;
  const sheetOpen = ui.view !== 'modell';
  if (!authed)
    return (
      <div className="app" style={{ position: 'absolute', inset: 0 }}>
        <SceneView data={data} sceneRef={sceneRef} />
        <Login auth={auth} setAuth={setAuth} />
        <Toasts />
      </div>
    );
  return (
    <div className={`app ${ui.view === 'modell' ? 'has-timeline' : ''}`} style={{ position: 'absolute', inset: 0 }}>
      <SceneView data={data} sceneRef={sceneRef} />
      <TopBar data={data} />
      {ready && hasHouse ? (
        <>
          {ui.view === 'modell' ? (
            <>
              <KpiRow data={data} />
              <SceneToolbar sceneRef={sceneRef} />
              <FloorPanel data={data} />
              {ui.sunOn ? <SunPanel data={data} /> : <Timeline data={data} />}
              <SelectionCard data={data} />
            </>
          ) : null}
          {ui.view === 'grundriss' ? <PlanEditor data={data} sceneRef={sceneRef} /> : null}
          {ui.view === 'gebaeude' ? <BuildingSheet data={data} /> : null}
          {ui.view === 'projekte' ? <ProjectsSheet data={data} /> : null}
          {ui.view === 'verbrauch' ? <ConsumptionSheet data={data} /> : null}
          {ui.view === 'dokumente' ? <DocumentsSheet data={data} /> : null}
          {sheetOpen && ui.wide ? null : null}
          <DrawerHost data={data} sceneRef={sceneRef} />
          <Banners data={data} />
        </>
      ) : null}
      {ready && !hasHouse ? <Welcome /> : null}
      {!ready ? (
        <div className="banner" role="status">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          Hausakte wird geladen …
        </div>
      ) : null}
      {ready && hasHouse ? <BottomNav /> : null}
      <Toasts />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('app')).render(<App />);
