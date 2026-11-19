// Writing by hand: a full-screen ruled page for the Apple Pencil (pressure, palm rejection: while a pen is
// in use, fingers scroll instead of drawing), with pen, highlighter, rubber, colours, widths and undo.
// After saving, the AI turns the handwriting into text (notesai.js).
import { Icon } from './icons.jsx';
import { Btn, IconBtn } from './common.jsx';
import { toast } from './state.js';
import { openViewer } from './photos.jsx';
import { storeFile } from './documents.jsx';
import { useAiAvailable } from './ai-ui.jsx';
import { PAGE_W, PAGE_H0, RULE, INK_COLORS, MARKER, WIDTHS, decodeInk, encodeInk, drawStroke, drawAll, hitStrokes } from '../ink.js';
import { saveInkDoc, transcribeNote, transcribeMeeting, deleteInkDoc } from '../notesai.js';
import { addNote, addMeeting, updateNote, patchProject } from '../actions.js';
import { getState } from '../store.js';
import { todayISO } from '../util.js';

const { useState, useEffect, useRef, useLayoutEffect, useCallback } = React;
const MAX_H = 8000;

export function InkEditor({ title = 'Handschriftliche Notiz', initial = null, onSave, onClose }) {
  const ai = useAiAvailable();
  const boxRef = useRef(null);
  const cvRef = useRef(null);
  const start = useRef(decodeInk(initial));
  const strokes = useRef(start.current.strokes.slice());
  const [h, setH] = useState(() => Math.max(start.current.h, PAGE_H0));
  const [view, setView] = useState({ scale: 1, dpr: 1, cssW: 0 });
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(INK_COLORS[0].key);
  const [width, setWidth] = useState(WIDTHS[1].key);
  const [finger, setFinger] = useState(true); // fingers write until a pen is used
  const [penSeen, setPenSeen] = useState(false);
  const [ask, setAsk] = useState(null); // 'close' | 'clear'
  const [saving, setSaving] = useState(false);
  const [, tick] = useState(0);
  const hist = useRef({ undo: [], redo: [] });
  const active = useRef(null);
  const live = useRef({});
  live.current = { tool, color, width, finger, penSeen, h, view };

  // ---------- canvas size and drawing ----------
  const redraw = useCallback(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const { scale, dpr } = live.current.view;
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    drawAll(ctx, strokes.current);
  }, []);
  const measure = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const cssW = Math.min(box.clientWidth - 24, 1100);
    const scale = cssW / PAGE_W;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    // stay below the canvas size limit of mobile Safari
    while (dpr > 1 && cssW * dpr * live.current.h * scale * dpr > 14e6) dpr -= 0.25;
    setView((v) => (v.cssW === cssW && v.dpr === dpr ? v : { scale, dpr, cssW }));
  }, []);
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const cv = cvRef.current;
    if (!cv || !view.cssW) return;
    cv.width = Math.round(view.cssW * view.dpr);
    cv.height = Math.round(h * view.scale * view.dpr);
    redraw();
  }, [view, h]);
  useEffect(() => measure(), [h]);

  // ---------- history ----------
  const commit = (prev) => {
    hist.current.undo.push(prev);
    if (hist.current.undo.length > 200) hist.current.undo.shift();
    hist.current.redo = [];
    tick((n) => n + 1);
  };
  const undo = () => {
    const H = hist.current;
    if (!H.undo.length) return;
    H.redo.push(strokes.current);
    strokes.current = H.undo.pop();
    redraw();
    tick((n) => n + 1);
  };
  const redo = () => {
    const H = hist.current;
    if (!H.redo.length) return;
    H.undo.push(strokes.current);
    strokes.current = H.redo.pop();
    redraw();
    tick((n) => n + 1);
  };
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // iPadOS may first treat a light pencil touch as a scroll, text selection or magnifier gesture and swallow the
  // start of the stroke; blocking the touch defaults for the pencil (and for fingers while they write) prevents that.
  // Pointer events keep coming, so drawing, palm rejection and scrolling with the finger work as before.
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const block = (e) => {
      const stylus = [...e.changedTouches].some((t) => t.touchType === 'stylus');
      if (stylus || (live.current.finger && e.touches.length === 1)) e.preventDefault();
    };
    cv.addEventListener('touchstart', block, { passive: false });
    cv.addEventListener('touchmove', block, { passive: false });
    return () => {
      cv.removeEventListener('touchstart', block);
      cv.removeEventListener('touchmove', block);
    };
  }, []);

  // ---------- pointer input ----------
  const toPage = (ev) => {
    const r = cvRef.current.getBoundingClientRect();
    const s = live.current.view.scale;
    // the first event of a pen stroke may carry no pressure yet; finger and mouse write at an even, medium width
    const pr = ev.pointerType === 'pen' ? (ev.pressure > 0 ? ev.pressure : 0.2) : 0.35;
    return [(ev.clientX - r.left) / s, (ev.clientY - r.top) / s, pr];
  };
  const grow = (y) => {
    if (y > live.current.h - 220 && live.current.h < MAX_H) setH((x) => Math.min(MAX_H, x + 700));
  };
  const erase = (p, prev) => {
    const hit = hitStrokes(strokes.current, p[0], p[1], 10);
    if (!hit.size) return;
    if (!active.current.erased) {
      active.current.erased = true;
      active.current.before = prev;
    }
    strokes.current = strokes.current.filter((_, i) => !hit.has(i));
    redraw();
  };
  const onDown = (e) => {
    const L = live.current;
    if (e.pointerType === 'pen' && !L.penSeen) {
      setPenSeen(true);
      setFinger(false);
      L.penSeen = true;
      L.finger = false;
    }
    // the pen always wins: a palm that touched first (scrolling or drawing) is dropped
    if (active.current && e.pointerType === 'pen' && active.current.type !== 'pen') {
      if (active.current.st) {
        strokes.current = active.current.before;
        redraw();
      }
      active.current = null;
    }
    if (active.current) return; // a second contact (e.g. the palm) while writing
    if (e.pointerType === 'touch' && !L.finger) {
      active.current = { id: e.pointerId, type: 'touch', scroll: e.clientY, top0: boxRef.current.scrollTop };
      return;
    }
    e.preventDefault();
    try {
      cvRef.current.setPointerCapture(e.pointerId);
    } catch {}
    const p = toPage(e);
    if (L.tool === 'erase') {
      active.current = { id: e.pointerId, type: e.pointerType, erase: true };
      erase(p, strokes.current);
      return;
    }
    const st = L.tool === 'marker' ? { k: 'marker', c: MARKER, w: 22, pts: [p] } : { k: 'pen', c: L.color, w: L.width, pts: [p] };
    const before = strokes.current;
    strokes.current = [...before, st];
    active.current = { id: e.pointerId, type: e.pointerType, st, before };
    const ctx = cvRef.current.getContext('2d');
    ctx.setTransform(L.view.scale * L.view.dpr, 0, 0, L.view.scale * L.view.dpr, 0, 0);
    drawStroke(ctx, st);
  };
  const onMove = (e) => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    if (a.scroll != null) {
      boxRef.current.scrollTop = a.top0 - (e.clientY - a.scroll);
      return;
    }
    e.preventDefault();
    const ne = e.nativeEvent || e;
    const evs = ne.getCoalescedEvents ? ne.getCoalescedEvents() : [ne];
    const list = evs.length ? evs : [ne];
    if (a.erase) {
      for (const ev of list) erase(toPage(ev), strokes.current);
      return;
    }
    const pts = a.st.pts;
    const from = pts.length;
    for (const ev of list) {
      const p = toPage(ev);
      const last = pts[pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.7) continue;
      pts.push(p);
    }
    if (pts.length > from) {
      const L = live.current;
      const ctx = cvRef.current.getContext('2d');
      ctx.setTransform(L.view.scale * L.view.dpr, 0, 0, L.view.scale * L.view.dpr, 0, 0);
      if (a.st.k === 'marker') redraw();
      else drawStroke(ctx, a.st, from);
      grow(pts[pts.length - 1][1]);
    }
  };
  const onUp = (e) => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    active.current = null;
    if (a.st) {
      commit(a.before);
      redraw();
    } else if (a.erased) commit(a.before);
  };

  // ---------- actions ----------
  const close = () => {
    if (saving) return;
    if (hist.current.undo.length && ask !== 'close') return setAsk('close');
    onClose();
  };
  const clear = () => {
    if (!strokes.current.length) return;
    commit(strokes.current);
    strokes.current = [];
    redraw();
    setAsk(null);
  };
  const save = async () => {
    if (!strokes.current.length) return toast('Schreib zuerst etwas auf die Seite.', 'warn');
    setSaving(true);
    try {
      await onSave({ ink: encodeInk({ h, strokes: strokes.current }), strokes: strokes.current });
    } finally {
      setSaving(false);
    }
  };
  const has = strokes.current.length > 0;
  const rule = RULE * view.scale;
  // rendered into the page body, so drawers and sheets (with transforms) cannot clip it
  return ReactDOM.createPortal(
    <div className="ink-ed" role="dialog" aria-label={title}>
      <header className="ink-top">
        <IconBtn icon="x" label="Schließen" onClick={close} />
        <b className="ink-title">{title}</b>
        <Btn kind="primary" icon={ai !== false ? 'sparkles' : 'check'} onClick={save} disabled={!has || saving}>
          {saving ? 'Speichert …' : ai !== false ? 'Fertig – in Text umwandeln' : 'Speichern'}
        </Btn>
      </header>
      <div className="ink-tools" role="toolbar" aria-label="Werkzeuge">
        <div className="seg">
          {[
            ['pen', 'pen', 'Stift'],
            ['marker', 'marker', 'Textmarker'],
            ['erase', 'eraser', 'Radierer'],
          ].map(([k, icon, label]) => (
            <button key={k} type="button" className={tool === k ? 'is-on' : ''} onClick={() => setTool(k)} aria-pressed={tool === k} title={label}>
              <Icon name={icon} size={16} />
              <span className="ink-tool-label">{label}</span>
            </button>
          ))}
        </div>
        <div className="ink-swatches" aria-label="Farbe">
          {INK_COLORS.map((c) => (
            <button key={c.key} type="button" className={`ink-dot ${color === c.key && tool === 'pen' ? 'is-on' : ''}`} style={{ '--c': c.key }} title={c.name} aria-label={c.name} onClick={() => { setColor(c.key); setTool('pen'); }} />
          ))}
        </div>
        <div className="ink-widths" aria-label="Strichstärke">
          {WIDTHS.map((w) => (
            <button key={w.key} type="button" className={`ink-w ${width === w.key ? 'is-on' : ''}`} title={w.name} aria-label={w.name} onClick={() => { setWidth(w.key); if (tool !== 'pen') setTool('pen'); }}>
              <i style={{ width: w.key * 2.2, height: w.key * 2.2 }} />
            </button>
          ))}
        </div>
        <div className="ink-actions">
          <IconBtn icon="undo" label="Rückgängig" onClick={undo} disabled={!hist.current.undo.length} />
          <IconBtn icon="redo" label="Wiederholen" onClick={redo} disabled={!hist.current.redo.length} />
          <IconBtn icon="hand" label={finger ? 'Finger schreibt – antippen, damit der Finger scrollt' : 'Finger scrollt – antippen, um mit dem Finger zu schreiben'} active={finger} onClick={() => setFinger(!finger)} />
          <IconBtn icon="trash" label="Seite leeren" onClick={() => has && setAsk('clear')} disabled={!has} />
        </div>
      </div>
      {ask ? (
        <div className="ink-ask" role="alert">
          <span>{ask === 'close' ? 'Ungespeicherte Notiz verwerfen?' : 'Alles auf der Seite löschen?'}</span>
          <Btn small kind="danger" onClick={() => (ask === 'close' ? onClose() : clear())}>
            {ask === 'close' ? 'Verwerfen' : 'Leeren'}
          </Btn>
          <Btn small kind="ghost" onClick={() => setAsk(null)}>
            Abbrechen
          </Btn>
        </div>
      ) : null}
      <div className="ink-scroll" ref={boxRef}>
        <div className="ink-page" style={{ width: view.cssW || '100%', height: h * view.scale, '--rule': `${rule}px`, '--margin': `${70 * view.scale}px` }}>
          <canvas
            ref={cvRef}
            className={`ink-canvas tool-${tool}`}
            style={{ width: view.cssW, height: h * view.scale }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onContextMenu={(e) => e.preventDefault()}
          />
          {!has && !penSeen ? <div className="ink-hint">Schreib mit dem Apple Pencil (oder Finger bzw. Maus) – zum Beispiel Notizen vom Termin, Maße oder eine kleine Skizze.</div> : null}
        </div>
        <button type="button" className="link small ink-more" onClick={() => setH((x) => Math.min(MAX_H, x + 700))} disabled={h >= MAX_H}>
          + Mehr Platz
        </button>
      </div>
      <div className="ink-status small muted">{penSeen ? 'Stift erkannt – mit dem Finger scrollst du, die Handfläche darf aufliegen.' : finger ? 'Finger und Maus schreiben. Mit dem Apple Pencil wird der Finger automatisch zum Scrollen.' : 'Der Finger scrollt.'}</div>
    </div>,
    document.body,
  );
}

// ---------- preview of stored handwriting ----------
export function InkPreview({ doc, onEdit, onRead, reading }) {
  if (!doc) return null;
  return (
    <div className="ink-prev">
      <button type="button" className="ink-prev-img" onClick={() => openViewer([doc.id])} title="Handschrift groß anzeigen">
        {doc.thumb ? <img src={doc.thumb} alt="Handschrift" /> : <Icon name="pen" size={20} />}
      </button>
      <div className="ink-prev-acts">
        {onEdit ? (
          <Btn small icon="pen" onClick={onEdit}>
            Weiterschreiben
          </Btn>
        ) : null}
        {onRead ? (
          <Btn small kind="ai" icon="sparkles" onClick={onRead} disabled={reading}>
            {reading ? 'Liest …' : 'Neu erkennen'}
          </Btn>
        ) : null}
      </div>
    </div>
  );
}

// ---------- create / update ----------
const store = (f) => storeFile(f);

export async function createInkNote(page, { title = '', date = todayISO() } = {}) {
  const id = addNote({ title, text: '', date, source: 'handschrift' });
  const docId = await saveInkDoc({ ...page, meta: { noteId: id, date }, store });
  updateNote(id, { inkDoc: docId });
  transcribeNote(id);
  toast('Handschrift gespeichert – die KI wandelt sie in Text um …');
  return id;
}

export async function updateInkNote(n, page) {
  const docId = await saveInkDoc({ ...page, docId: n.inkDoc || null, meta: { noteId: n.id }, store });
  if (docId !== n.inkDoc) updateNote(n.id, { inkDoc: docId });
  transcribeNote(n.id);
  toast('Gespeichert – die KI liest die Handschrift neu …');
}

export async function createInkMeeting(p, page, { date = todayISO() } = {}) {
  const res = addMeeting(p.id, { title: 'Besprechung (handschriftlich)', summary: '', date }, { transcript: '', date, source: 'handschrift' });
  const docId = await saveInkDoc({ ...page, meta: { projectId: p.id, meetingId: res.id, date, name: 'Handschriftliche Besprechungsnotiz' }, store });
  patchProject(p.id, (x) => ({ ...x, meetings: (x.meetings || []).map((m) => (m.id === res.id ? { ...m, inkDoc: docId } : m)) }));
  transcribeMeeting(p.id, res.id, { derive: true });
  toast('Handschrift gespeichert – die KI wandelt sie in Text um …');
  return res.id;
}

export async function updateInkMeeting(p, m, page) {
  const docId = await saveInkDoc({ ...page, docId: m.inkDoc || null, meta: { projectId: p.id, meetingId: m.id }, store });
  if (docId !== m.inkDoc) {
      patchProject(p.id, (x) => ({ ...x, meetings: (x.meetings || []).map((y) => (y.id === m.id ? { ...y, inkDoc: docId } : y)) }));
  }
  // dates and to-dos were taken over the first time already
  transcribeMeeting(p.id, m.id, { derive: !m.ai });
  toast('Gespeichert – die KI liest die Handschrift neu …');
}

export { deleteInkDoc };
export const inkDocOf = (id) => (id ? getState().documents?.[id] || null : null);
