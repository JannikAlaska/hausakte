import { Icon } from './icons.jsx';
import { Btn, IconBtn, Select, Sheet, Empty, ConfirmBtn, Pill, Field, TextInput } from './common.jsx';
import { AiRunner } from './ai-ui.jsx';
import { toast, go, openDrawer } from './state.js';
import { DOC_TYPES } from '../catalog.js';
import { putDoc, updateDoc, deleteDoc, getAssets, fileUrl, getState, exportData, clearAll, loadDataset } from '../store.js';
import { aiReadImage } from '../ai.js';
import { isSupabaseMode, supa, signOut, updatePassword, listMembers, listInvites, createInvite, deleteInvite, authErrorText } from '../supa.js';
import { addCost, addMilestone } from '../actions.js';
import { uid, todayISO, fmtDate, fmtEuro, isISO } from '../util.js';

const { useState, useRef, useEffect } = React;

const ASSET_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'application/pdf', 'video/mp4', 'video/webm', 'text/plain', 'text/csv', 'text/markdown', 'application/json'];

function guessType(file) {
  const n = file.name.toLowerCase();
  if (/angebot|offer|kostenvoranschlag/.test(n)) return 'angebot';
  if (/rechnung|invoice/.test(n)) return 'rechnung';
  if (/grundriss|plan|schnitt|ansicht/.test(n)) return 'plan';
  if (/bescheid|antrag|kfw|bafa|förder|foerder/.test(n)) return 'foerderung';
  if (/vertrag/.test(n)) return 'vertrag';
  if (/ausweis|gutachten/.test(n)) return 'gutachten';
  if (file.type.startsWith('image/')) return 'foto';
  return 'sonstiges';
}

export function downscaleImage(file, max = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s);
      cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bild konnte nicht gelesen werden'));
    };
    img.src = url;
  });
}

const readDataUrl = (blob) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });

// Stores files as artifact assets when possible, otherwise as compressed data URLs.
export async function uploadFiles(files, meta = {}) {
  const assets = await getAssets();
  const mode = getState().mode;
  let ok = 0;
  for (const file of files) {
    const id = uid('d-');
    const base = { id, name: file.name, type: meta.type || guessType(file), size: file.size, contentType: file.type, projectId: meta.projectId || null, componentId: meta.componentId || null, date: todayISO(), notes: '' };
    try {
      if (assets) {
        if (!ASSET_TYPES.includes(file.type)) {
          toast(`„${file.name}“: Dieser Dateityp wird nicht unterstützt. Lade PDF oder Bilder hoch.`, 'warn', 5000);
          continue;
        }
        const res = await assets.upload(file, { type: file.type });
        putDoc('documents', id, { ...base, assetId: res.id, contentType: res.contentType, size: res.sizeBytes }, 50);
      } else {
        let blob = file;
        if (file.type.startsWith('image/')) blob = await downscaleImage(file, mode === 'db' ? 1100 : 1600, 0.78);
        const dataUrl = await readDataUrl(blob);
        const limit = mode === 'db' ? 230000 : 2500000;
        if (dataUrl.length > limit) {
          toast(`„${file.name}“ ist zu groß für diesen Speicher. Öffne die Hausakte in claude.ai als Besitzer, um größere Dateien abzulegen.`, 'warn', 6000);
          continue;
        }
        putDoc('documents', id, { ...base, dataUrl, contentType: blob.type || file.type }, 50);
      }
      ok++;
    } catch (e) {
      const msg = e?.code === 'too_large' ? 'Datei ist zu groß (max. 20 MB).' : e?.code === 'quota_or_state' ? 'Der Dateispeicher ist voll.' : e?.code === 'unsupported_type' ? 'Dateityp wird nicht unterstützt.' : 'Hochladen fehlgeschlagen.';
      toast(`„${file.name}“: ${msg}`, 'err', 5000);
    }
  }
  if (ok) toast(ok === 1 ? 'Dokument abgelegt' : `${ok} Dokumente abgelegt`);
  return ok;
}

export async function attachFile(doc, file) {
  const assets = await getAssets();
  if (!assets) return toast('Dateien kannst du hier nicht ablegen.', 'warn');
  if (!ASSET_TYPES.includes(file.type)) return toast('Dieser Dateityp wird nicht unterstützt. Lade PDF oder Bilder hoch.', 'warn', 5000);
  try {
    const res = await assets.upload(file, { type: file.type });
    updateDoc('documents', doc.id, (d) => ({ ...d, assetId: res.id, contentType: res.contentType, size: res.sizeBytes, dataUrl: undefined, fileMissing: undefined }), 50);
    toast('Datei angehängt');
  } catch (e) {
    toast(e?.code === 'too_large' ? 'Datei ist zu groß.' : 'Hochladen fehlgeschlagen.', 'err');
  }
}

function AttachButton({ doc }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Btn small icon="upload" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? 'Lädt …' : 'Datei anhängen'}
      </Btn>
      <input
        ref={ref}
        type="file"
        hidden
        accept={doc.contentType || 'image/*,application/pdf'}
        onChange={async (e) => {
          const f = e.target.files[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          await attachFile(doc, f);
          setBusy(false);
        }}
      />
    </>
  );
}

export function UploadButton({ projectId, componentId, small, label = 'Hochladen', accept }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Btn small={small} icon="upload" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? 'Lädt …' : label}
      </Btn>
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        accept={accept || 'image/*,application/pdf'}
        onChange={async (e) => {
          const files = [...e.target.files];
          e.target.value = '';
          if (!files.length) return;
          setBusy(true);
          await uploadFiles(files, { projectId, componentId });
          setBusy(false);
        }}
      />
    </>
  );
}

function Lightbox({ doc, onClose }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="welcome" style={{ width: 'min(900px, calc(100% - 32px))' }} role="dialog" aria-label={doc.name}>
      <div className="spread">
        <b>{doc.name}</b>
        <IconBtn icon="x" label="Schließen" onClick={onClose} />
      </div>
      <img src={fileUrl(doc)} alt={doc.name} style={{ maxHeight: '70vh', objectFit: 'contain', borderRadius: 10 }} />
    </div>
  );
}

function DocAi({ doc, data }) {
  const isImg = (doc.contentType || '').startsWith('image/');
  if (!isImg) return <p className="small muted">KI-Auslesen funktioniert für Fotos und Scans (JPG, PNG). PDFs kannst du als Foto/Screenshot hochladen.</p>;
  const project = doc.projectId ? data.projects[doc.projectId] : null;
  return (
    <AiRunner
      title="Dokument mit KI auslesen"
      icon="file"
      desc="Erkennt Firma, Datum, Summe, Kostenpositionen und Fristen."
      cta="Auslesen"
      saved={doc.ai}
      run={async (signal) => {
        const url = fileUrl(doc);
        if (!url) throw { code: 'file_missing' };
        const res = await fetch(url);
        const blob = await res.blob();
        return aiReadImage(blob, 'document', { signal });
      }}
      onSave={(rec) => updateDoc('documents', doc.id, (d) => ({ ...d, ai: rec, type: rec.data?.docType && DOC_TYPES.some((t) => t.key === rec.data.docType) ? rec.data.docType : d.type }))}
      render={(r) => (
        <div className="stack" style={{ gap: 8 }}>
          {r.summary ? <p className="ai-summary">{r.summary}</p> : null}
          <div className="ai-meta">
            {r.vendor ? <Pill>{r.vendor}</Pill> : null}
            {isISO(r.date) ? <span>{fmtDate(r.date)}</span> : null}
            {r.total ? <b>{fmtEuro(r.total)}</b> : null}
          </div>
          {(r.items || []).length ? (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {r.items.map((it, i) => (
                <li key={i}>
                  {it.label}: {fmtEuro(it.amount)}
                </li>
              ))}
            </ul>
          ) : null}
          {project && (r.items || []).length ? (
            <div className="ai-actions">
              <Btn
                small
                icon="plus"
                onClick={() => {
                  const field = r.docType === 'rechnung' ? 'actual' : 'offer';
                  for (const it of r.items) addCost(project.id, { label: it.label, [field]: Number(it.amount) || null, vendor: r.vendor || '' });
                  toast(`${r.items.length} Positionen in „${project.title}“ übernommen`);
                }}
              >
                {r.docType === 'rechnung' ? 'Als Ist-Kosten übernehmen' : 'Als Angebot übernehmen'}
              </Btn>
              {(r.deadlines || []).filter((d) => isISO(d.date)).length ? (
                <Btn small kind="ghost" icon="flag" onClick={() => { r.deadlines.filter((d) => isISO(d.date)).forEach((d) => addMilestone(project.id, d.title, d.date)); toast('Fristen als Meilensteine übernommen'); }}>
                  Fristen übernehmen
                </Btn>
              ) : null}
            </div>
          ) : !project ? (
            <p className="small muted">Ordne das Dokument einem Projekt zu, um die Positionen zu übernehmen.</p>
          ) : null}
          {(r.warnings || []).length ? (
            <ul className="small" style={{ margin: 0, paddingLeft: 18, color: 'var(--warn-ink)' }}>
              {r.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    />
  );
}

function DocCard({ doc, data, compact, onOpen }) {
  const [open, setOpen] = useState(false);
  const url = fileUrl(doc);
  const isImg = (doc.contentType || '').startsWith('image/');
  const set = (patch) => updateDoc('documents', doc.id, (d) => ({ ...d, ...patch }));
  const remove = async () => {
    if (doc.assetId) {
      const a = await getAssets();
      try {
        await a?.delete(doc.assetId);
      } catch {}
    }
    deleteDoc('documents', doc.id);
    toast('Dokument gelöscht');
  };
  const typeName = DOC_TYPES.find((t) => t.key === doc.type)?.name || 'Dokument';
  const missing = !doc.assetId && !doc.dataUrl;
  const openIt = () => isImg && onOpen(doc);
  const thumb = isImg && url ? <img src={url} alt="" loading="lazy" /> : <Icon name="file" size={26} />;
  const Opener = ({ className, style, children }) =>
    isImg || !url ? (
      <button className={className} style={{ border: 0, padding: 0, ...style }} onClick={openIt} aria-label={`${doc.name} öffnen`}>
        {children}
      </button>
    ) : (
      <a className={className} style={style} href={url} target="_blank" rel="noopener noreferrer" aria-label={`${doc.name} öffnen`}>
        {children}
      </a>
    );
  if (compact)
    return (
      <div className="stack" style={{ gap: 6 }}>
        <div className="doc-mini">
          <Opener className="doc-ico">{thumb}</Opener>
          <div>
            <b>{doc.name}</b>
            <span>
              {typeName} · {fmtDate(doc.date)}
            </span>
          </div>
          {!isImg && url && doc.assetId ? (
            <a className="icon-btn" href={url} target="_blank" rel="noopener noreferrer" aria-label="Öffnen">
              <Icon name="eye" size={16} />
            </a>
          ) : null}
          {missing ? <AttachButton doc={doc} /> : null}
          <IconBtn icon="sparkles" label="Mit KI auslesen" active={open} onClick={() => setOpen(!open)} size={16} />
        </div>
        {open ? <DocAi doc={doc} data={data} /> : null}
      </div>
    );
  return (
    <div className="doc">
      <Opener className="doc-thumb" style={{ width: '100%' }}>
        {thumb}
      </Opener>
      <div className="doc-body">
        <b title={doc.name}>{doc.name}</b>
        <span>
          {fmtDate(doc.date)}
          {doc.size ? ` · ${(doc.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : ''}
        </span>
        <Select value={doc.type} onChange={(v) => set({ type: v })} options={DOC_TYPES.map((t) => ({ value: t.key, label: t.name }))} aria-label="Art" />
        <Select
          value={doc.projectId || ''}
          placeholder="Kein Projekt"
          onChange={(v) => set({ projectId: v || null })}
          options={Object.values(data.projects).map((p) => ({ value: p.id, label: p.title }))}
          aria-label="Projekt"
        />
        {missing ? (
          <div className="hstack" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">Datei fehlt</span>
            <AttachButton doc={doc} />
          </div>
        ) : null}
        <div className="hstack" style={{ justifyContent: 'space-between' }}>
          {missing ? <span /> : !isImg && url && doc.assetId ? (
            <a className="link" href={url} target="_blank" rel="noopener noreferrer">
              Öffnen
            </a>
          ) : (
            <button className="link" onClick={openIt}>
              Ansehen
            </button>
          )}
          <IconBtn icon="sparkles" label="Mit KI auslesen" active={open} onClick={() => setOpen(!open)} size={16} />
          <ConfirmBtn onConfirm={remove}>{''}</ConfirmBtn>
        </div>
        {open ? <DocAi doc={doc} data={data} /> : null}
      </div>
    </div>
  );
}

export function DocList({ data, filter = () => true, compact, projectId }) {
  const [box, setBox] = useState(null);
  const docs = Object.values(data.documents)
    .filter(filter)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!docs.length)
    return compact ? (
      <p className="small muted">Noch keine Dokumente. Lade Angebote, Rechnungen, Fotos oder Förderbescheide hoch.</p>
    ) : (
      <Empty icon="folder" title="Noch keine Dokumente">
        Lege Grundrisse, Energieausweis, Angebote, Rechnungen, Förderbescheide und Fotos hier ab.
      </Empty>
    );
  return (
    <>
      <div className={compact ? 'stack' : 'docs'} style={compact ? { gap: 8 } : undefined}>
        {docs.map((d) => (
          <DocCard key={d.id} doc={d} data={data} compact={compact} onOpen={setBox} />
        ))}
      </div>
      {box ? <Lightbox doc={box} onClose={() => setBox(null)} /> : null}
    </>
  );
}

function Backup({ data }) {
  const fileRef = useRef(null);
  const [armed, setArmed] = useState(null);
  const doExport = async () => {
    const json = JSON.stringify(exportData(), null, 1);
    const dl = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
    if (dl) {
      try {
        await dl.save({ filename: `hausakte-${todayISO()}.json`, data: json });
        toast('Sicherung gespeichert');
      } catch (e) {
        if (e?.code !== 'declined') toast('Export nicht möglich: ' + (e?.message || e?.code), 'err');
      }
      return;
    }
    if (!window.claude) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `hausakte-${todayISO()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Sicherung heruntergeladen');
      return;
    }
    try {
      await navigator.clipboard.writeText(json);
      toast('Sicherung als JSON in die Zwischenablage kopiert');
    } catch {
      toast('Export ist hier nicht möglich. Öffne die Hausakte in claude.ai.', 'warn');
    }
  };
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Sicherung</h3>
        <div className="hstack">
          <Btn small icon="download" onClick={doExport}>
            Exportieren (JSON)
          </Btn>
          <Btn small kind="ghost" icon="upload" onClick={() => fileRef.current?.click()}>
            Importieren
          </Btn>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files[0];
              e.target.value = '';
              if (!f) return;
              try {
                const obj = JSON.parse(await f.text());
                if (!obj.house) throw new Error();
                setArmed(obj);
              } catch {
                toast('Die Datei ist keine gültige Hausakte-Sicherung.', 'err');
              }
            }}
          />
        </div>
      </div>
      <p className="small muted">Exportiert alle Hausdaten, Grundrisse, Projekte und Verbräuche. Hochgeladene Dateien bleiben in der Hausakte und sind im Export nur verlinkt.</p>
      {armed ? (
        <div className="callout callout-warn" style={{ marginTop: 10 }}>
          <Icon name="alert" size={16} />
          <div style={{ flex: 1 }}>
            <b>Import ersetzt alle aktuellen Daten.</b>
            <div className="hstack" style={{ marginTop: 8 }}>
              <Btn
                small
                kind="danger"
                onClick={() => {
                  clearAll();
                  const obj = armed;
                  setTimeout(() => loadDataset(obj), 500);
                  setArmed(null);
                  toast('Sicherung wird importiert');
                }}
              >
                Ersetzen
              </Btn>
              <Btn small onClick={() => setArmed(null)}>
                Abbrechen
              </Btn>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Supabase mode: who has access, invitations, password, sign-out.
function Account() {
  const [me, setMe] = useState(null);
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const [{ data: u }, m, i] = await Promise.all([supa().auth.getUser(), listMembers(), listInvites()]);
      setMe(u?.user || null);
      setMembers(m);
      setInvites(i);
    } catch {}
  };
  useEffect(() => {
    load();
  }, []);
  const invite = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toast('Bitte eine gültige E-Mail-Adresse eingeben.', 'warn');
    setBusy(true);
    try {
      setCode({ email: email.trim().toLowerCase(), code: await createInvite(email) });
      setEmail('');
      load();
    } catch (e) {
      toast('Einladung fehlgeschlagen: ' + (e?.message || ''), 'err');
    }
    setBusy(false);
  };
  const changePw = async () => {
    if (pw.length < 8) return toast('Das Passwort muss mindestens 8 Zeichen haben.', 'warn');
    try {
      await updatePassword(pw);
      setPw('');
      toast('Passwort geändert');
    } catch (e) {
      toast(authErrorText(e), 'err');
    }
  };
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Konto & Zugriff</h3>
        <Btn small kind="ghost" icon="x" onClick={async () => { await signOut(); location.reload(); }}>
          Abmelden
        </Btn>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Angemeldet als <b>{me?.email || '…'}</b>. Zugriff haben:
        </p>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {members.map((m) => (
            <li key={m.user_id}>{m.email}</li>
          ))}
          {invites.map((i) => (
            <li key={i.email} className="muted">
              {i.email} – eingeladen, gültig bis {fmtDate(i.expires_at.slice(0, 10))}{' '}
              <button className="link" onClick={async () => { await deleteInvite(i.email); load(); }}>
                zurückziehen
              </button>
            </li>
          ))}
        </ul>
        <Field label="Person einladen (z. B. Partner:in)">
          <div className="inline-form">
            <TextInput value={email} onChange={setEmail} placeholder="E-Mail-Adresse" type="email" />
            <Btn small icon="plus" disabled={busy} onClick={invite}>
              Einladen
            </Btn>
          </div>
        </Field>
        {code ? (
          <div className="callout">
            <Icon name="info" size={16} />
            <div>
              Einladungscode für <b>{code.email}</b>: <code style={{ fontSize: 15, letterSpacing: 1 }}>{code.code}</code>
              <br />
              <span className="small muted">Gib den Code zusammen mit dem Link zu dieser Seite weiter. Er wird nur jetzt angezeigt und gilt 14 Tage.</span>
            </div>
          </div>
        ) : null}
        <Field label="Neues Passwort">
          <div className="inline-form">
            <TextInput value={pw} onChange={setPw} placeholder="mind. 8 Zeichen" type="password" />
            <Btn small onClick={changePw}>
              Ändern
            </Btn>
          </div>
        </Field>
      </div>
    </div>
  );
}

export function DocumentsSheet({ data }) {
  const [type, setType] = useState('alle');
  const [over, setOver] = useState(false);
  const docs = Object.values(data.documents);
  const counts = Object.fromEntries(DOC_TYPES.map((t) => [t.key, docs.filter((d) => d.type === t.key).length]));
  return (
    <Sheet title="Dokumente" icon="folder" eyebrow={`${docs.length} Dateien`} onClose={() => go('modell')} actions={<UploadButton />}>
      <div className="stack">
        <div
          className={`dropzone ${over ? 'is-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setOver(false);
            const files = [...e.dataTransfer.files];
            if (files.length) await uploadFiles(files);
          }}
        >
          <Icon name="upload" size={22} />
          <span>Dateien hierher ziehen – Grundrisse, Energieausweis, Angebote, Rechnungen, Förderbescheide, Fotos (PDF, JPG, PNG).</span>
        </div>
        <div className="chips">
          <button className={`chip ${type === 'alle' ? 'is-on' : ''}`} onClick={() => setType('alle')}>
            Alle <span className="tab-count">{docs.length}</span>
          </button>
          {DOC_TYPES.filter((t) => counts[t.key]).map((t) => (
            <button key={t.key} className={`chip ${type === t.key ? 'is-on' : ''}`} onClick={() => setType(t.key)}>
              {t.name} <span className="tab-count">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <DocList data={data} filter={(d) => type === 'alle' || d.type === type} />
        <Backup data={data} />
        {isSupabaseMode() ? <Account /> : null}
      </div>
    </Sheet>
  );
}
