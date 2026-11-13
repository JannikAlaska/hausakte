// Photos with a place: a photo spot (floor.photoSpots: {id, x, y, label}) marks a place in the floor plan, e.g.
// "bathroom north wall"; photos are documents of type "foto" that point to it (doc.spot = {floorId, spotId}),
// with the date taken, a phase (vorher / waehrend / nachher), a caption (doc.notes) and an optional project.
// The series of one spot gives before/after comparisons; the photos of a project give its site diary.
import { getState, putDoc, updateDoc, deleteDoc, getAssets } from './store.js';
import { roomOfPoint } from './planops.js';
import { uid, todayISO } from './util.js';

export const PHASES = [
  { key: 'vorher', name: 'Vorher' },
  { key: 'waehrend', name: 'Während' },
  { key: 'nachher', name: 'Nachher' },
];
export const phaseName = (k) => PHASES.find((p) => p.key === k)?.name || '';

export const isPhoto = (d) => d?.type === 'foto' && (!d.contentType || String(d.contentType).startsWith('image/'));
const takenKey = (d) => d.takenAt || (d.date ? d.date + 'T12:00:00' : '') || '';
export const byTaken = (a, b) => takenKey(a).localeCompare(takenKey(b)) || String(a.id).localeCompare(String(b.id));

export const photoDocs = (data = getState()) => Object.values(data.documents || {}).filter(isPhoto);
export const spotPhotos = (data, floorId, spotId) => photoDocs(data).filter((d) => d.spot?.floorId === floorId && d.spot?.spotId === spotId).sort(byTaken);
export const projectPhotos = (data, projectId) => photoDocs(data).filter((d) => d.projectId === projectId).sort(byTaken);

export function findSpot(data, floorId, spotId) {
  const floor = data.floors?.[floorId];
  const spot = floor?.photoSpots?.find((s) => s.id === spotId);
  if (!spot) return null;
  const room = roomOfPoint(floor, { x: spot.x, y: spot.y });
  return { floor, spot, room };
}

export const spotTitle = (f) => (f ? f.spot.label || (f.room ? f.room.name : '') || 'Fotopunkt' : 'Fotopunkt');
export const spotPlace = (f) => (f ? [f.floor.short || f.floor.name, f.room?.name].filter(Boolean).join(' · ') : '');

// all spots of the house with their photos (for the 3D pins and pickers)
export function allSpots(data = getState()) {
  const photos = photoDocs(data);
  const out = [];
  for (const floor of Object.values(data.floors || {}))
    for (const s of floor.photoSpots || []) {
      const list = photos.filter((d) => d.spot?.floorId === floor.id && d.spot?.spotId === s.id).sort(byTaken);
      const room = roomOfPoint(floor, { x: s.x, y: s.y });
      out.push({ ...s, floorId: floor.id, floor, room, photos: list, title: s.label || room?.name || 'Fotopunkt' });
    }
  return out;
}

// the two photos to compare: first "vorher" (else the oldest) and last "nachher" (else the newest)
export function comparePair(list) {
  if (!list || list.length < 2) return null;
  const a = list.find((d) => d.phase === 'vorher') || list[0];
  const after = [...list].reverse().find((d) => d.phase === 'nachher' && d.id !== a.id);
  const b = after || [...list].reverse().find((d) => d.id !== a.id);
  return b ? [a, b] : null;
}

// ---------- spots ----------
export function addSpot(floorId, x, y, label = '') {
  const id = uid('ps');
  updateDoc('floors', floorId, (f) => ({ ...f, photoSpots: [...(f.photoSpots || []), { id, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, label, createdAt: Date.now() }] }), 50);
  return id;
}
export const setSpot = (floorId, spotId, patch) =>
  updateDoc('floors', floorId, (f) => ({ ...f, photoSpots: (f.photoSpots || []).map((s) => (s.id === spotId ? { ...s, ...patch } : s)) }), 300);
// the photos stay (in Dokumente and the project), they only lose their place
export function deleteSpot(floorId, spotId) {
  for (const d of spotPhotos(getState(), floorId, spotId)) updateDoc('documents', d.id, (x) => ({ ...x, spot: null }), 50);
  updateDoc('floors', floorId, (f) => ({ ...f, photoSpots: (f.photoSpots || []).filter((s) => s.id !== spotId) }), 50);
}

// ---------- photo files ----------
// date taken from the JPEG's EXIF data (DateTimeOriginal), else null
export async function exifDate(file) {
  try {
    if (!/jpe?g/i.test(file.type || file.name || '')) return null;
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null;
    let o = 2;
    while (o + 4 < v.byteLength) {
      const marker = v.getUint16(o);
      const len = v.getUint16(o + 2);
      if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10;
        const le = v.getUint16(t) === 0x4949;
        const u16 = (p) => v.getUint16(t + p, le);
        const u32 = (p) => v.getUint32(t + p, le);
        const str = (p, n) => {
          let s = '';
          for (let i = 0; i < n - 1 && t + p + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(t + p + i));
          return s;
        };
        const tags = (ifd) => {
          const n = u16(ifd);
          const out = {};
          for (let i = 0; i < n; i++) {
            const e = ifd + 2 + i * 12;
            out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), val: u32(e + 8) };
          }
          return out;
        };
        const ifd0 = tags(u32(4));
        let raw = null;
        if (ifd0[0x8769]) {
          const ex = tags(ifd0[0x8769].val);
          if (ex[0x9003]) raw = str(ex[0x9003].val, ex[0x9003].count);
        }
        if (!raw && ifd0[0x0132]) raw = str(ifd0[0x0132].val, ifd0[0x0132].count);
        const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(raw || '');
        return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
      }
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      o += 2 + len;
    }
  } catch {}
  return null;
}

const localIso = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, done: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bild konnte nicht gelesen werden'));
    };
    img.src = url;
  });
}

function scaled(img, max, quality, asDataUrl) {
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.width * s));
  cv.height = Math.max(1, Math.round(img.height * s));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  if (asDataUrl) return cv.toDataURL('image/jpeg', quality);
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', quality));
}

// photo -> stored file (at most 2000 px) + small preview kept in the document (for lists, pins and offline)
export async function preparePhoto(file) {
  const { img, done } = await loadImage(file);
  try {
    const big = Math.max(img.width, img.height) > 2000 || file.size > 1.5 * 1024 * 1024 || !/jpe?g/i.test(file.type);
    const blob = big ? await scaled(img, 2000, 0.84) : file;
    const thumb = scaled(img, 320, 0.7, true);
    return { blob, thumb, w: img.width, h: img.height };
  } finally {
    done();
  }
}

// store: (blob, name) -> {assetId|dataUrl, contentType, size} (documents.jsx storeFile)
export async function addPhotos(files, { floorId = null, spotId = null, projectId = null, phase = null, store }) {
  const ids = [];
  for (const file of files) {
    if (!String(file.type).startsWith('image/')) continue;
    try {
      const taken = (await exifDate(file)) || (file.lastModified ? localIso(file.lastModified) : localIso(Date.now()));
      const { blob, thumb, w, h } = await preparePhoto(file);
      const named = blob instanceof File ? blob : new File([blob], (file.name || 'foto').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
      const stored = await store(named);
      if (!stored) continue;
      const id = uid('d-');
      putDoc('documents', id, { id, type: 'foto', name: file.name || 'Foto', date: taken.slice(0, 10), takenAt: taken, notes: '', projectId, spot: floorId && spotId ? { floorId, spotId } : null, phase, thumb, w, h, size: stored.size, contentType: stored.contentType, ...stored, addedAt: Date.now() }, 50);
      ids.push(id);
    } catch {}
  }
  return ids;
}

export const setPhoto = (id, patch, delay = 300) => updateDoc('documents', id, (d) => ({ ...d, ...patch }), delay);

export async function deletePhoto(d) {
  if (d.assetId) {
    try {
      await (await getAssets())?.delete(d.assetId);
    } catch {}
  }
  deleteDoc('documents', d.id);
}

// photos of a project grouped by day (newest first) – the site diary
export function diaryDays(list) {
  const days = new Map();
  for (const d of [...list].sort(byTaken).reverse()) {
    const k = (d.takenAt || d.date || todayISO()).slice(0, 10);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(d);
  }
  return [...days].map(([date, items]) => ({ date, items: items.sort(byTaken) }));
}
