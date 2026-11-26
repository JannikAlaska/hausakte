// Save a generated file (text, CSV, ASCII-only PDF, or a Blob such as a JPEG): artifact downloads, the Android
// app's Downloads folder, the share sheet on iPhone/iPad, or a normal browser download.
import { saveTextFile, saveBinaryFile, isAndroidApp } from './native.js';
import { toast } from './ui/state.js';

const nav = typeof navigator !== 'undefined' ? navigator : {};
// iPadOS reports itself as a Mac; the touch points give it away
export const isIOS = /iPad|iPhone|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
const standalone = () => nav.standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);

// iPhone/iPad: the share sheet ("Bild sichern", "In Dateien sichern", AirDrop, Mail …). A web app started from
// the home screen ignores downloads of generated files, so this goes first there.
// -> 'saved' | 'cancelled' | 'tap' (the tap that started it has expired) | null (sharing files not possible)
async function shareFiles(list) {
  if (!nav.canShare || typeof File === 'undefined') return null;
  let files;
  try {
    files = list.map((f) => new File([f.data], f.name, { type: f.mime }));
    if (!nav.canShare({ files })) return null;
  } catch {
    return null;
  }
  try {
    await nav.share({ files });
    return 'saved';
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
    if (e?.name === 'NotAllowedError') return 'tap';
    return null;
  }
}

// -> 'saved' | 'cancelled' | 'failed' | 'old-app' (Android app before 1.0.4, cannot save images) |
//    'tap' (iPhone/iPad: needs one more tap to open the share sheet). Shows its own messages.
export async function saveFileStatus(name, mime, data, { share = true, quiet = false } = {}) {
  const binary = typeof Blob !== 'undefined' && data instanceof Blob;
  const dl = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (dl) {
    try {
      await dl.save({ filename: name, data });
      toast(`„${name}“ gespeichert`);
      return 'saved';
    } catch (e) {
      if (e?.code === 'declined') return 'cancelled';
      toast('Speichern nicht möglich: ' + (e?.message || e?.code), 'err');
      return 'failed';
    }
  }
  if (binary) {
    if (await saveBinaryFile(name, mime, data)) return 'saved';
    if (isAndroidApp) {
      if (!quiet) toast('Bilder speichern kann erst die neue Android-App (ab Version 1.0.4) – lade sie unter hausakte-eight.vercel.app/hausakte.apk. Als PDF klappt es schon jetzt.', 'warn', 9000);
      return 'old-app';
    }
  } else if (saveTextFile(name, mime, data)) return 'saved';
  if (isIOS && share) {
    const r = await shareFiles([{ name, mime, data }]);
    if (r === 'saved' || r === 'cancelled') return r;
    if (r === 'tap' && standalone()) return 'tap';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(binary ? data : new Blob([data], { type: mime }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  toast(`„${name}“ heruntergeladen`);
  return 'saved';
}

// Several files ({ name, mime, data }): on iPhone/iPad all in one share sheet ("7 Bilder sichern"), elsewhere one
// after the other. -> { status (as above), saved: how many went through before it stopped }. quiet: the caller
// explains an outdated Android app itself.
export async function saveFilesStatus(files, { quiet = false } = {}) {
  if (files.length === 1) return { status: await saveFileStatus(files[0].name, files[0].mime, files[0].data, { quiet }), saved: 0 };
  let share = isIOS && !window.claude?.use && !isAndroidApp;
  if (share) {
    const r = await shareFiles(files);
    if (r === 'saved' || r === 'cancelled') return { status: r, saved: 0 };
    if (r === 'tap' && standalone()) return { status: 'tap', saved: 0 };
    share = false;
  }
  for (let i = 0; i < files.length; i++) {
    const status = await saveFileStatus(files[i].name, files[i].mime, files[i].data, { share, quiet });
    if (status !== 'saved') return { status, saved: i };
  }
  return { status: 'saved', saved: files.length };
}

export async function saveFile(name, mime, data) {
  const r = await saveFileStatus(name, mime, data);
  if (r === 'tap') toast('Noch einmal tippen – dann öffnet sich das Teilen-Menü zum Sichern.', 'warn', 6000);
  return r === 'saved';
}
