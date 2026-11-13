// Photo documentation: photo spots in the plan and the 3D model, the series of a spot with before/after
// comparison, a full-screen viewer and the site diary of a project (photos by day).
import { Icon } from './icons.jsx';
import { Btn, IconBtn, Field, TextInput, Select, DateInput, Seg, Drawer, Section, ConfirmBtn, Empty, Pill } from './common.jsx';
import { toast, openDrawer, closeDrawer, setUI, getUI, useUI, go } from './state.js';
import { storeFile } from './documents.jsx';
import { fileUrl } from '../store.js';
import { PHASES, phaseName, spotPhotos, projectPhotos, findSpot, spotTitle, spotPlace, allSpots, comparePair, setSpot, deleteSpot, addPhotos, setPhoto, deletePhoto, diaryDays, byTaken } from '../photos.js';
import { fmtDate } from '../util.js';

const { useState, useEffect, useRef } = React;

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const shortDate = (iso) => (/^\d{4}-\d\d-\d\d/.test(iso || '') ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : '');
const dayLabel = (iso) => {
  const d = new Date(iso + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? iso : `${WD[d.getDay()]}, ${fmtDate(iso)}`;
};
export const photoSrc = (d, full) => (full ? fileUrl(d) || d.thumb : d.thumb || fileUrl(d)) || null;

// ---------- adding photos (camera or gallery) ----------
let adding = 0;
const addSubs = new Set();
const setAdding = (n) => {
  adding = Math.max(0, adding + n);
  addSubs.forEach((f) => f());
};
function useAdding() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    addSubs.add(f);
    return () => addSubs.delete(f);
  }, []);
  return adding;
}

const busySpots = new Set();
export const spotBusy = (id) => busySpots.has(id);

export async function addPhotoFiles(files, meta) {
  const list = [...files].filter((f) => String(f.type).startsWith('image/'));
  if (!list.length) return [];
  setAdding(1);
  if (meta.spotId) busySpots.add(meta.spotId);
  try {
    const ids = await addPhotos(list, { ...meta, store: (f) => storeFile(f, { quiet: false }) });
    if (ids.length) toast(ids.length === 1 ? 'Foto gespeichert' : `${ids.length} Fotos gespeichert`);
    else toast('Das Foto konnte nicht gespeichert werden.', 'err');
    return ids;
  } finally {
    if (meta.spotId) busySpots.delete(meta.spotId);
    setAdding(-1);
  }
}

export function PhotoPicker({ onFiles, small }) {
  const cam = useRef(null);
  const gal = useRef(null);
  const busy = useAdding();
  const pick = (e) => {
    const f = [...e.target.files];
    e.target.value = '';
    if (f.length) onFiles(f);
  };
  return (
    <div className="ph-picker">
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={gal} type="file" accept="image/*" multiple hidden onChange={pick} />
      <Btn kind="primary" small={small} icon="camera" disabled={!!busy} onClick={() => cam.current?.click()}>
        {busy ? 'Speichert …' : 'Foto aufnehmen'}
      </Btn>
      <Btn small={small} icon="image" disabled={!!busy} onClick={() => gal.current?.click()}>
        Aus Galerie
      </Btn>
    </div>
  );
}

// ---------- before / after ----------
export function BeforeAfter({ a, b, small }) {
  const [pos, setPos] = useState(50);
  const ua = photoSrc(a, !small),
    ub = photoSrc(b, !small);
  return (
    <div className={`ba ${small ? 'is-small' : ''}`} style={{ aspectRatio: `${a.w || 4} / ${a.h || 3}` }}>
      {ua ? <img src={ua} alt={`${phaseName(a.phase) || 'Früher'} ${fmtDate(a.date)}`} draggable={false} /> : <span className="ba-wait" />}
      {ub ? <img src={ub} alt={`${phaseName(b.phase) || 'Später'} ${fmtDate(b.date)}`} draggable={false} style={{ clipPath: `inset(0 0 0 ${pos}%)` }} /> : null}
      <span className="ba-line" style={{ left: `${pos}%` }}>
        <span className="ba-knob">
          <Icon name="compare" size={small ? 12 : 15} />
        </span>
      </span>
      <span className="ba-tag ba-tag-a">
        {phaseName(a.phase) || 'Früher'} · {shortDate(a.date)}
      </span>
      <span className="ba-tag ba-tag-b">
        {phaseName(b.phase) || 'Später'} · {shortDate(b.date)}
      </span>
      {small ? null : <input className="ba-range" type="range" min={0} max={100} step={0.5} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Vergleich verschieben" />}
    </div>
  );
}

// ---------- fields of one photo ----------
function PhotoFields({ d, data, withSpot, onDeleted }) {
  const set = (patch) => setPhoto(d.id, patch);
  const projects = Object.values(data.projects || {}).filter((p) => !p.archived || p.id === d.projectId);
  const spots = withSpot ? allSpots(data) : [];
  return (
    <div className="ph-fields">
      <Seg small value={d.phase || ''} onChange={(v) => set({ phase: d.phase === v ? null : v || null })} options={PHASES.map((p) => ({ value: p.key, label: p.name }))} />
      <TextInput value={d.notes || ''} onChange={(v) => set({ notes: v })} placeholder="Was ist zu sehen? z. B. Leitungen vor dem Verputzen" />
      <div className="grid2">
        <Field label="Aufgenommen am">
          <DateInput value={d.date} onChange={(v) => v && set({ date: v, takenAt: v + (d.takenAt || 'T12:00:00').slice(10) })} />
        </Field>
        <Field label="Projekt">
          <Select value={d.projectId || ''} placeholder="– ohne Projekt –" onChange={(v) => set({ projectId: v || null })} options={projects.map((p) => ({ value: p.id, label: p.title }))} />
        </Field>
      </div>
      {withSpot ? (
        <Field label="Ort (Fotopunkt im Grundriss)">
          <Select
            value={d.spot ? `${d.spot.floorId}|${d.spot.spotId}` : ''}
            placeholder={spots.length ? '– ohne Ort –' : '– noch keine Fotopunkte im Grundriss –'}
            onChange={(v) => {
              const [floorId, spotId] = v ? v.split('|') : [];
              set({ spot: v ? { floorId, spotId } : null });
            }}
            options={spots.map((s) => ({ value: `${s.floorId}|${s.id}`, label: `${s.floor.short || s.floor.name} · ${s.title}` }))}
          />
        </Field>
      ) : null}
      <div className="ph-fields-foot">
        <span className="small muted">
          {d.w && d.h ? `${d.w} × ${d.h} px` : ''}
          {d.takenAt ? ` · ${d.takenAt.slice(11, 16)} Uhr` : ''}
        </span>
        <ConfirmBtn confirmText="Foto löschen?" onConfirm={async () => { await deletePhoto(d); toast('Foto gelöscht'); onDeleted?.(); }}>
          Löschen
        </ConfirmBtn>
      </div>
    </div>
  );
}

// ---------- full-screen viewer ----------
export const openViewer = (ids, i = 0) => ids.length && setUI({ viewer: { ids, i: Math.max(0, Math.min(ids.length - 1, i)) } });

export function PhotoViewer({ data }) {
  const ui = useUI();
  const v = ui.viewer;
  const [info, setInfo] = useState(false);
  const touch = useRef(null);
  const ids = (v?.ids || []).filter((id) => data.documents?.[id]);
  const i = Math.min(v?.i || 0, ids.length - 1);
  const d = ids.length ? data.documents[ids[i]] : null;
  const close = () => setUI({ viewer: null });
  const step = (k) => ids.length > 1 && setUI({ viewer: { ids, i: (i + k + ids.length) % ids.length } });
  useEffect(() => {
    if (!v) return;
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  if (!v) return null;
  if (!d) {
    if (v) setTimeout(close, 0);
    return null;
  }
  const place = d.spot ? findSpot(data, d.spot.floorId, d.spot.spotId) : null;
  const p = d.projectId ? data.projects?.[d.projectId] : null;
  const src = photoSrc(d, true);
  return (
    <div className="ph-viewer" role="dialog" aria-label="Foto" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="ph-viewer-top">
        <span className="ph-viewer-title">
          <b>{d.notes || (place ? spotTitle(place) : d.name)}</b>
          <span>
            {[dayLabel(d.date), phaseName(d.phase), place ? spotPlace(place) : null, p?.title].filter(Boolean).join(' · ')}
            {ids.length > 1 ? ` · ${i + 1}/${ids.length}` : ''}
          </span>
        </span>
        <IconBtn icon="info" label="Details" active={info} onClick={() => setInfo(!info)} />
        <IconBtn icon="x" label="Schließen" onClick={close} />
      </div>
      <div
        className="ph-viewer-img"
        onClick={(e) => e.target === e.currentTarget && close()}
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - (touch.current ?? e.changedTouches[0].clientX);
          if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
          touch.current = null;
        }}
      >
        {src ? <img src={src} alt={d.notes || d.name} /> : <span className="spin-dot" />}
        {ids.length > 1 ? (
          <>
            <button type="button" className="ph-nav ph-prev" aria-label="Vorheriges Foto" onClick={() => step(-1)}>
              <Icon name="chevL" size={22} />
            </button>
            <button type="button" className="ph-nav ph-next" aria-label="Nächstes Foto" onClick={() => step(1)}>
              <Icon name="chevR" size={22} />
            </button>
          </>
        ) : null}
      </div>
      {info ? (
        <div className="ph-viewer-info">
          <PhotoFields d={d} data={data} withSpot onDeleted={() => (ids.length <= 1 ? close() : setUI({ viewer: { ids: ids.filter((x) => x !== d.id), i: Math.min(i, ids.length - 2) } }))} />
          {place ? (
            <button className="link small" onClick={() => { close(); openDrawer({ type: 'photos', floorId: d.spot.floorId, spotId: d.spot.spotId }); }}>
              Alle Fotos an diesem Ort →
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------- thumbnails ----------
function Thumb({ d, onClick, place }) {
  const src = photoSrc(d);
  return (
    <button type="button" className="ph-thumb" onClick={onClick} title={d.notes || d.name}>
      {src ? <img src={src} alt={d.notes || d.name} loading="lazy" /> : <Icon name="image" size={18} />}
      {d.phase ? <span className={`ph-phase is-${d.phase}`}>{phaseName(d.phase)}</span> : null}
      {d.notes || place ? <span className="ph-cap">{d.notes || place}</span> : null}
    </button>
  );
}

// ---------- drawer of one photo spot ----------
export function PhotoSpotDrawer({ data, drawer }) {
  const f = findSpot(data, drawer.floorId, drawer.spotId);
  const list = f ? spotPhotos(data, drawer.floorId, drawer.spotId) : [];
  const last = list[list.length - 1];
  const [phase, setPhase] = useState(list.length ? 'nachher' : 'vorher');
  const [proj, setProj] = useState(last?.projectId || '');
  const [pair, setPair] = useState(null);
  if (!f)
    return (
      <Drawer title="Fotopunkt nicht gefunden" onClose={closeDrawer}>
        <Empty title="Dieser Fotopunkt existiert nicht mehr." />
      </Drawer>
    );
  const auto = comparePair(list);
  const A = (pair && list.find((x) => x.id === pair[0])) || auto?.[0];
  const B = (pair && list.find((x) => x.id === pair[1])) || auto?.[1];
  const ids = list.map((x) => x.id);
  const projects = Object.values(data.projects || {}).filter((p) => !p.archived);
  const opt = list.map((x) => ({ value: x.id, label: `${fmtDate(x.date)}${x.phase ? ' · ' + phaseName(x.phase) : ''}${x.notes ? ' · ' + x.notes.slice(0, 30) : ''}` }));
  const showInPlan = () => {
    closeDrawer();
    setUI({ planSpot: { floorId: f.floor.id, spotId: f.spot.id }, floorId: f.floor.id });
    go('grundriss');
  };
  return (
    <Drawer
      eyebrow={`Fotopunkt · ${spotPlace(f)}`}
      title={spotTitle(f)}
      icon="camera"
      onClose={closeDrawer}
      className="ph-drawer"
      footer={
        <>
          <ConfirmBtn confirmText="Fotopunkt löschen?" onConfirm={() => { deleteSpot(f.floor.id, f.spot.id); closeDrawer(); toast('Fotopunkt gelöscht – die Fotos bleiben unter Dokumente erhalten.'); }}>
            Fotopunkt löschen
          </ConfirmBtn>
          {getUI().view !== 'grundriss' ? (
            <Btn icon="plan" onClick={showInPlan}>
              Im Grundriss zeigen
            </Btn>
          ) : null}
        </>
      }
    >
      <Field label="Bezeichnung">
        <TextInput value={f.spot.label || ''} onChange={(v) => setSpot(f.floor.id, f.spot.id, { label: v })} placeholder={`z. B. ${f.room?.name || 'Bad'} Nordwand, Zählerschrank …`} />
      </Field>
      {A && B ? (
        <Section title="Vorher / Nachher">
          <BeforeAfter key={A.id + B.id} a={A} b={B} />
          {list.length > 2 ? (
            <div className="grid2 ba-pick">
              <Select value={A.id} onChange={(v) => setPair([v, B.id])} options={opt} aria-label="Linkes Foto" />
              <Select value={B.id} onChange={(v) => setPair([A.id, v])} options={opt} aria-label="Rechtes Foto" />
            </div>
          ) : null}
        </Section>
      ) : null}
      <Section title="Foto hinzufügen">
        <div className="ph-add">
          <div className="grid2">
            <Field label="Phase">
              <Select value={phase} onChange={setPhase} options={PHASES.map((p) => ({ value: p.key, label: p.name }))} />
            </Field>
            <Field label="Projekt">
              <Select value={proj} placeholder="– ohne Projekt –" onChange={setProj} options={projects.map((p) => ({ value: p.id, label: p.title }))} />
            </Field>
          </div>
          <PhotoPicker onFiles={(files) => addPhotoFiles(files, { floorId: f.floor.id, spotId: f.spot.id, projectId: proj || null, phase })} />
          {!list.length ? <p className="small muted">Tipp: Fotografiere vor dem Umbau und danach möglichst aus demselben Blickwinkel – dann lässt sich Vorher und Nachher direkt vergleichen.</p> : null}
        </div>
      </Section>
      <Section title={`Fotos (${list.length})`}>
        {list.length ? (
          <div className="ph-series">
            {[...list].reverse().map((d) => (
              <div key={d.id} className="ph-card">
                <Thumb d={d} onClick={() => openViewer(ids, ids.indexOf(d.id))} />
                <PhotoFields d={d} data={data} />
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">Noch keine Fotos an diesem Ort.</p>
        )}
      </Section>
    </Drawer>
  );
}

// ---------- project tab: site diary ----------
export function ProjectPhotos({ p, data }) {
  const list = projectPhotos(data, p.id);
  const ids = [...list].sort(byTaken).reverse().map((d) => d.id);
  const days = diaryDays(list);
  const spots = allSpots(data).filter((s) => s.photos.length >= 2 && s.photos.some((d) => d.projectId === p.id));
  const [phase, setPhase] = useState(list.length ? 'waehrend' : 'vorher');
  return (
    <div className="stack ph-project">
      <div className="ph-add">
        <div className="hstack ph-add-row">
          <Select value={phase} onChange={setPhase} options={PHASES.map((x) => ({ value: x.key, label: x.name }))} aria-label="Phase der neuen Fotos" />
          <PhotoPicker small onFiles={(files) => addPhotoFiles(files, { projectId: p.id, phase })} />
        </div>
        <p className="small muted">Fotos mit Ort: im Grundriss mit dem Kamera-Werkzeug einen Fotopunkt setzen – dann gibt es Vorher/Nachher an derselben Stelle. Den Ort kannst du auch später in den Details eines Fotos wählen.</p>
      </div>
      {spots.length ? (
        <Section title="Vorher / Nachher">
          <div className="ph-ba-grid">
            {spots.map((s) => {
              const pr = comparePair(s.photos);
              return pr ? (
                <button key={s.id} type="button" className="ph-ba-card" onClick={() => openDrawer({ type: 'photos', floorId: s.floorId, spotId: s.id })}>
                  <BeforeAfter a={pr[0]} b={pr[1]} small />
                  <span>
                    <b>{s.title}</b> · {s.floor.short || s.floor.name} · {s.photos.length} Fotos
                  </span>
                </button>
              ) : null;
            })}
          </div>
        </Section>
      ) : null}
      {days.length ? (
        <Section title={`Bautagebuch (${list.length} Foto${list.length === 1 ? '' : 's'})`}>
          <div className="ph-diary">
            {days.map((day) => (
              <div key={day.date} className="ph-day">
                <div className="ph-day-head">
                  <b>{dayLabel(day.date)}</b>
                  <span className="small muted">
                    {day.items.length} Foto{day.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="ph-grid">
                  {day.items.map((d) => {
                    const f = d.spot ? findSpot(data, d.spot.floorId, d.spot.spotId) : null;
                    return <Thumb key={d.id} d={d} place={f ? spotTitle(f) : ''} onClick={() => openViewer(ids, ids.indexOf(d.id))} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : (
        <Empty icon="camera" title="Noch keine Fotos">
          Halte den Baufortschritt fest – vorher, während der Arbeiten (z. B. Leitungen vor dem Verputzen) und nachher.
        </Empty>
      )}
    </div>
  );
}

// ---------- plan sidebar for a selected photo spot ----------
export function PlanSpotProps({ data, floor, spot, onDelete }) {
  const f = { floor, spot, room: findSpot(data, floor.id, spot.id)?.room || null };
  const list = spotPhotos(data, floor.id, spot.id);
  const ids = list.map((d) => d.id);
  const pr = comparePair(list);
  return (
    <div className="stack">
      <Field label="Bezeichnung">
        <TextInput value={spot.label || ''} onChange={(v) => setSpot(floor.id, spot.id, { label: v })} placeholder={`z. B. ${f.room?.name || 'Bad'} Nordwand`} />
      </Field>
      {f.room ? <p className="small muted">Raum: {f.room.name}</p> : null}
      <PhotoPicker small onFiles={(files) => addPhotoFiles(files, { floorId: floor.id, spotId: spot.id, projectId: list[list.length - 1]?.projectId || null, phase: list.length ? 'nachher' : 'vorher' })} />
      {pr ? <BeforeAfter a={pr[0]} b={pr[1]} /> : null}
      {list.length ? (
        <div className="ph-grid ph-grid-sm">
          {[...list].reverse().map((d) => (
            <Thumb key={d.id} d={d} onClick={() => openViewer(ids, ids.indexOf(d.id))} />
          ))}
        </div>
      ) : (
        <p className="small muted">Noch keine Fotos. Das erste Foto zählt als „Vorher“, weitere als „Nachher“ – änderbar in den Details.</p>
      )}
      <div className="spread">
        <ConfirmBtn confirmText="Fotopunkt löschen?" onConfirm={onDelete}>
          Löschen
        </ConfirmBtn>
        <Btn small icon="image" onClick={() => openDrawer({ type: 'photos', floorId: floor.id, spotId: spot.id })}>
          Alle Fotos & Details
        </Btn>
      </div>
    </div>
  );
}

// ---------- plan layer ----------
export function PlanPhotoSpots({ spots, counts, sel, px, faded }) {
  return (
    <g className="svg-photos">
      {spots.map((s) => {
        const n = counts.get(s.id) || 0;
        const on = sel?.kind === 'photo' && sel.id === s.id;
        const r = px(on ? 11 : 9.5);
        return (
          <g key={s.id} transform={`translate(${s.x},${s.y})`} className={`svg-photo ${on ? 'is-sel' : ''} ${n ? '' : 'is-empty'} ${faded?.(s) ? 'is-faded' : ''}`}>
            <title>{`${s.label || 'Fotopunkt'} · ${n} Foto${n === 1 ? '' : 's'}`}</title>
            <circle r={r} className="svg-photo-bg" strokeWidth={px(on ? 2.5 : 1.8)} />
            <g transform={`scale(${(r * 1.15) / 12}) translate(-12,-12)`}>
              <path d="M4 7.5h3.5L9 5h6l1.5 2.5H20V19H4zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" className="svg-photo-ico" strokeWidth={1.9} />
            </g>
            {n > 1 ? (
              <g transform={`translate(${r * 0.85},${-r * 0.85})`}>
                <circle r={px(6.5)} className="svg-photo-badge" />
                <text y={px(2.6)} textAnchor="middle" fontSize={px(8)} className="svg-photo-n">
                  {n > 99 ? '99' : n}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}
