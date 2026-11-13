// Save a generated file (text, CSV, ASCII-only PDF): artifact downloads, the Android app's Downloads folder,
// or a normal browser download.
import { saveTextFile } from './native.js';
import { toast } from './ui/state.js';

export async function saveFile(name, mime, text) {
  const dl = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (dl) {
    try {
      await dl.save({ filename: name, data: text });
      toast(`„${name}“ gespeichert`);
      return true;
    } catch (e) {
      if (e?.code !== 'declined') toast('Speichern nicht möglich: ' + (e?.message || e?.code), 'err');
      return false;
    }
  }
  if (saveTextFile(name, mime, text)) return true;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`„${name}“ heruntergeladen`);
  return true;
}
