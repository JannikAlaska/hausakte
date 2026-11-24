// One "+ Neu" for everything that is captured on the go: photo, note (typed, spoken, handwritten), invoice,
// to-do, application, contact, project. It opens the same forms as the old entry points, which stay as shortcuts.
import { Icon } from './icons.jsx';
import { IconBtn, Field, Select } from './common.jsx';
import { useUI, setUI, getUI, openDrawer, go } from './state.js';
import { NoteComposer } from './notes.jsx';
import { InkEditor, createInkNote } from './ink.jsx';
import { InvoiceCapture } from './invoices.jsx';
import { NewApplication } from './applications.jsx';
import { NewDecision } from './decisions.jsx';
import { TodoComposer } from './cockpit.jsx';
import { AddContactBar } from './contacts.jsx';
import { PhotoPicker, addPhotoFiles } from './photos.jsx';
import { SpeechRec } from './meetings.jsx';
import { createContact } from '../contacts.js';
import { liveProjects, isDone } from '../metrics.js';

const { useState, useEffect, useRef } = React;

const ITEMS = [
  { key: 'foto', icon: 'camera', label: 'Foto', sub: 'Zustand, Baufortschritt' },
  { key: 'notiz', icon: 'edit', label: 'Notiz', sub: 'tippen, sprechen oder mit dem Stift', more: true },
  { key: 'rechnung', icon: 'euro', label: 'Rechnung', sub: 'fotografieren oder PDF' },
  { key: 'aufgabe', icon: 'tasks', label: 'Aufgabe', sub: 'To-do in einem Projekt' },
  { key: 'antrag', icon: 'flag', label: 'Antrag', sub: 'Unterlagen hochladen, KI füllt aus' },
  { key: 'entscheidung', icon: 'scale', label: 'Entscheidung', sub: 'Matrix und Pre-Mortem, begründet festhalten' },
  { key: 'kontakt', icon: 'people', label: 'Kontakt', sub: 'Visitenkarte oder von Hand' },
  { key: 'projekt', icon: 'plus', label: 'Projekt', sub: 'Vorhaben am Haus' },
];
const NOTE_KINDS = [
  { key: 'notiz-text', icon: 'list', label: 'Tippen' },
  { key: 'notiz-sprache', icon: 'mic', label: 'Sprechen' },
  { key: 'notiz-stift', icon: 'pen', label: 'Stift' },
];

export const openQuick = (kind) => setUI({ quick: kind || null });
const close = () => setUI({ quick: null });

export function NewButton() {
  const ui = useUI();
  const open = ui.quick === 'menu';
  return (
    <button type="button" className={`new-btn ${open ? 'is-on' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label="Neu anlegen" title="Neu anlegen: Foto, Notiz, Rechnung, Aufgabe, Antrag, Kontakt" onClick={() => openQuick(open ? null : 'menu')}>
      <Icon name="plus" size={18} stroke={2.2} />
      <span>Neu</span>
    </button>
  );
}

function QuickMenu() {
  const ref = useRef(null);
  const [notes, setNotes] = useState(false);
  // on wide screens the menu hangs below the button
  const btn = document.querySelector('.new-btn')?.getBoundingClientRect();
  const pos = btn && window.innerWidth > 760 ? { top: btn.bottom + 8, left: Math.max(8, Math.min(btn.left, window.innerWidth - 308)), right: 'auto' } : undefined;
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close();
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.new-btn')) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, []);
  const pick = (key) => {
    if (key === 'notiz') return setNotes(!notes);
    if (key === 'projekt') {
      close();
      return openDrawer({ type: 'project', id: null, create: true });
    }
    openQuick(key);
  };
  return (
    <div className="new-menu" role="menu" aria-label="Neu anlegen" ref={ref} style={pos}>
      {ITEMS.map((it) => (
        <div key={it.key}>
          <button type="button" role="menuitem" className={`new-item ${it.key === 'notiz' && notes ? 'is-open' : ''}`} onClick={() => pick(it.key)}>
            <span className="new-item-ico">
              <Icon name={it.icon} size={17} />
            </span>
            <span className="new-item-txt">
              <b>{it.label}</b>
              <span>{it.sub}</span>
            </span>
            {it.more ? <Icon name={notes ? 'chevU' : 'chevD'} size={14} /> : null}
          </button>
          {it.key === 'notiz' && notes ? (
            <div className="new-sub" role="group" aria-label="Notiz">
              {NOTE_KINDS.filter((k) => k.key !== 'notiz-sprache' || SpeechRec).map((k) => (
                <button key={k.key} type="button" role="menuitem" className="new-subitem" onClick={() => openQuick(k.key)}>
                  <Icon name={k.icon} size={16} />
                  <span>{k.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Modal({ title, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !document.querySelector('.ink-editor') && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return ReactDOM.createPortal(
    <div className="qn-overlay" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="qn-modal" role="dialog" aria-modal="true" aria-label={title}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function QuickPhoto({ data }) {
  const projects = liveProjects(data.projects).filter((p) => !isDone(p));
  const running = projects.find((p) => p.status === 'umsetzung');
  const [pid, setPid] = useState(running?.id || '');
  return (
    <div className="panel">
      <div className="spread">
        <h3>Foto</h3>
        <IconBtn icon="x" label="Schließen" onClick={close} />
      </div>
      <Field label="Zu welchem Projekt? (optional)">
        <Select value={pid} onChange={setPid} options={[{ value: '', label: 'Ohne Projekt' }, ...projects.map((p) => ({ value: p.id, label: p.title }))]} />
      </Field>
      <PhotoPicker
        onFiles={(files) => {
          addPhotoFiles(files, { projectId: pid || null });
          close();
        }}
      />
      <p className="small muted">Fotos mit festem Ort (für Vorher/Nachher an derselben Stelle) setzt du im Grundriss mit dem Kamera-Werkzeug unter „Messen &amp; Fotos“.</p>
    </div>
  );
}

function QuickContact() {
  return (
    <div className="panel">
      <div className="spread">
        <h3>Kontakt</h3>
        <IconBtn icon="x" label="Schließen" onClick={close} />
      </div>
      <p className="small muted">Foto einer Visitenkarte oder ein Screenshot – die KI liest den Kontakt aus und ergänzt ihn. Oder trag ihn von Hand ein.</p>
      <AddContactBar
        onPicked={() => {
          close();
          go('kontakte');
        }}
        onManual={() => {
          close();
          openDrawer({ type: 'contact', id: createContact({ source: 'manuell' }) });
        }}
      />
    </div>
  );
}

export function QuickHost({ data }) {
  const ui = useUI();
  const q = ui.quick;
  // a form that opens a drawer (e.g. "Von Hand") makes way for it
  const drawerKey = ui.drawer ? `${ui.drawer.type}:${ui.drawer.id || ''}` : '';
  const seen = useRef(drawerKey);
  useEffect(() => {
    if (q && q !== 'menu' && drawerKey && drawerKey !== seen.current) close();
    seen.current = drawerKey;
  }, [drawerKey]);
  // and the menu closes when the area changes
  useEffect(() => {
    if (getUI().quick === 'menu') close();
  }, [ui.view]);
  if (!q) return null;
  if (q === 'menu') return <QuickMenu />;
  if (q === 'notiz-stift')
    return (
      <InkEditor
        onClose={close}
        onSave={async (page) => {
          await createInkNote(page);
          close();
        }}
      />
    );
  const body =
    q === 'foto' ? (
      <QuickPhoto data={data} />
    ) : q === 'notiz-text' || q === 'notiz-sprache' ? (
      <NoteComposer autoStart={q === 'notiz-sprache'} onClose={close} />
    ) : q === 'rechnung' ? (
      <div className="panel">
        <div className="spread">
          <h3>Rechnung erfassen</h3>
          <IconBtn icon="x" label="Schließen" onClick={close} />
        </div>
        <InvoiceCapture compact />
      </div>
    ) : q === 'aufgabe' ? (
      <TodoComposer data={data} onClose={close} />
    ) : q === 'antrag' ? (
      <NewApplication data={data} onClose={close} />
    ) : q === 'entscheidung' ? (
      <NewDecision data={data} onClose={close} />
    ) : q === 'kontakt' ? (
      <QuickContact />
    ) : null;
  if (!body) return null;
  return <Modal title={ITEMS.find((i) => q.startsWith(i.key))?.label || 'Neu'}>{body}</Modal>;
}

