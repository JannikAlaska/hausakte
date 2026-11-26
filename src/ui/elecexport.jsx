// Dialog "Elektroplan exportieren": one room (or every room on its own page), the storey or all storeys; as PDF
// or JPEG; paper size, which connections (existing / planned) and what else goes on the plan. Files are saved
// like every other export (browser download, Android Downloads, claude.ai download).
import { Icon } from './icons.jsx';
import { Btn, IconBtn, Field, Seg, Toggle, Select } from './common.jsx';
import { toast } from './state.js';
import { elecPages, elecPlanPdf, elecSummary, floorsWithFixtures } from '../elecplan.js';
import { drawToBlob } from '../drawimg.js';
import { saveFile } from '../download.js';
import { todayISO } from '../util.js';

const { useState, useEffect } = React;

const FILTERS = [
  { value: 'alle', label: 'Bestand + geplant' },
  { value: 'bestand', label: 'Nur Bestand' },
  { value: 'geplant', label: 'Nur geplant' },
];
const ALL_ROOMS = '*';

function sumText(s) {
  const parts = [];
  if (s.lamps) parts.push(`${s.lamps} Leuchte${s.lamps === 1 ? '' : 'n'}`);
  if (s.switches) parts.push(`${s.switches} Schalter`);
  if (s.sockets) parts.push(`${s.sockets} Steckdose${s.sockets === 1 ? '' : 'n'}`);
  if (s.net) parts.push(`${s.net} LAN`);
  return parts.join(' · ') || 'keine Anschlüsse';
}
// file name part: "Küche/Essen" -> "Kueche-Essen"
const slug = (s) =>
  String(s || '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'Plan';

export function ElecExportDialog({ data, floor, filter: startFilter = 'alle', roomId = null, onClose }) {
  const withFx = floorsWithFixtures(data);
  const rooms = (floor.rooms || []).filter((r) => r.poly?.length > 2).sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  const [scope, setScope] = useState(roomId && rooms.some((r) => r.id === roomId) ? 'room' : 'floor');
  const [room, setRoom] = useState(roomId && rooms.some((r) => r.id === roomId) ? roomId : rooms[0]?.id || ALL_ROOMS);
  const [format, setFormat] = useState('pdf');
  const [paper, setPaper] = useState('A4');
  const [filter, setFilter] = useState(startFilter);
  const [furniture, setFurniture] = useState(true);
  const [lines, setLines] = useState(false);
  const [list, setList] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const floors = scope === 'all' ? withFx : [floor];
  const pickedRooms = scope === 'room' ? (room === ALL_ROOMS ? rooms : rooms.filter((r) => r.id === room)) : [];
  const hasPower = floors.some((f) => (f.lines || []).some((l) => l.kind === 'strom'));
  const planCount = scope === 'room' ? pickedRooms.length : floors.length;
  const empty = scope === 'room' ? pickedRooms.every((r) => !Object.keys(elecSummary(floor, filter, r)).length) : floors.every((f) => !(f.points || []).length);
  const opts = {
    scope: scope === 'room' ? { type: 'rooms', floorId: floor.id, roomIds: pickedRooms.map((r) => r.id) } : { type: 'floors', floorIds: floors.map((f) => f.id) },
    paper,
    furniture,
    lines: lines && hasPower,
    list: format === 'pdf' && list,
    filter,
  };
  const baseName = () => {
    if (scope === 'all') return 'alle-Etagen';
    const fl = slug(floor.short || floor.name);
    if (scope === 'room') return room === ALL_ROOMS ? `${fl}_Raeume` : `${fl}_${slug(pickedRooms[0]?.name)}`;
    return fl;
  };

  const go = async () => {
    if (!planCount) return toast('Hier gibt es keinen Raum mit Grundriss.', 'warn');
    setBusy(true);
    try {
      if (format === 'pdf') {
        if (await saveFile(`Elektroplan_${baseName()}_${todayISO()}.pdf`, 'application/pdf', elecPlanPdf(data, opts))) onClose();
      } else {
        // one image per plan; several are saved one after the other
        const plans = elecPages(data, opts).filter((p) => p.kind === 'plan');
        let saved = 0;
        for (const p of plans) {
          const blob = await drawToBlob(p.draw, { paper });
          const name = plans.length === 1 ? `Elektroplan_${baseName()}_${todayISO()}.jpg` : `Elektroplan_${slug(p.name)}_${todayISO()}.jpg`;
          if (!(await saveFile(name, 'image/jpeg', blob))) break;
          saved++;
        }
        if (saved === plans.length) onClose();
      }
    } catch (e) {
      toast('Der Elektroplan konnte nicht erstellt werden: ' + (e?.message || e), 'err', 6000);
    }
    setBusy(false);
  };

  return ReactDOM.createPortal(
    <div className="qn-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qn-modal" role="dialog" aria-modal="true" aria-label="Elektroplan exportieren">
        <div className="panel stack elec-export">
          <div className="spread">
            <h3 className="hstack" style={{ gap: 8 }}>
              <Icon name="socket" size={18} /> Elektroplan exportieren
            </h3>
            <IconBtn icon="x" label="Schließen" onClick={onClose} />
          </div>
          <p className="small muted">Grundriss mit allen Leuchten, Schaltern und Steckdosen als Symbolen – mit Anzahl und Höhe an jedem Symbol, Legende und Zählung je Raum. Zum Ausdrucken oder für den Elektriker.</p>
          <Field label="Umfang">
            <Seg
              value={scope}
              onChange={setScope}
              options={[
                { value: 'room', label: 'Raum', disabled: !rooms.length },
                { value: 'floor', label: floor.name || 'Diese Etage' },
                { value: 'all', label: `Alle Etagen (${withFx.length})`, disabled: !withFx.length },
              ]}
            />
          </Field>
          {scope === 'room' ? (
            <Field label="Welcher Raum?" hint={room === ALL_ROOMS ? `Jeder Raum auf einer eigenen ${format === 'pdf' ? 'Seite' : 'Bilddatei'} (${rooms.length})` : 'Herangezoomt, nur die Anschlüsse dieses Raums'}>
              <Select value={room} onChange={setRoom} options={[...rooms.map((r) => ({ value: r.id, label: r.name || 'Raum' })), { value: ALL_ROOMS, label: `Alle Räume einzeln (${rooms.length})` }]} />
            </Field>
          ) : null}
          <Field label="Format" hint={format === 'jpg' ? `Bild ca. ${paper === 'A3' ? '2980 × 2100' : '2100 × 1490'} Pixel – zum Verschicken per Messenger oder Mail` : 'Gestochen scharf beim Zoomen und Drucken'}>
            <Seg value={format} onChange={setFormat} options={[{ value: 'pdf', label: 'PDF' }, { value: 'jpg', label: 'JPEG (Bild)' }]} />
          </Field>
          <Field label="Papier" hint={paper === 'A3' ? 'Größer – meist Maßstab 1:50' : 'Passt in jeden Drucker'}>
            <Seg value={paper} onChange={setPaper} options={[{ value: 'A4', label: 'A4 quer' }, { value: 'A3', label: 'A3 quer' }]} />
          </Field>
          <Field label="Anschlüsse">
            <Seg value={filter} onChange={setFilter} options={FILTERS} />
          </Field>
          <div className="stack" style={{ gap: 8 }}>
            <Toggle checked={furniture} onChange={setFurniture} label="Möbel zur Orientierung" />
            <Toggle checked={lines && hasPower} onChange={setLines} label={hasPower ? 'Stromleitungen einzeichnen' : 'Stromleitungen (keine gezeichnet)'} />
            {format === 'pdf' ? <Toggle checked={list} onChange={setList} label="Anschlussliste als Extraseite" /> : null}
          </div>
          <div className="elec-sum">
            {scope === 'room'
              ? (room === ALL_ROOMS ? [{ id: ALL_ROOMS, name: `${floor.name}, alle Räume`, sum: elecSummary(floor, filter) }] : pickedRooms.map((r) => ({ id: r.id, name: r.name, sum: elecSummary(floor, filter, r) }))).map((x) => (
                  <div key={x.id} className="kv">
                    <span>{x.name}</span>
                    <b>{sumText(x.sum)}</b>
                  </div>
                ))
              : floors.map((f) => (
                  <div key={f.id} className="kv">
                    <span>{f.name}</span>
                    <b>{sumText(elecSummary(f, filter))}</b>
                  </div>
                ))}
          </div>
          {empty ? <p className="small muted">{scope === 'room' ? 'In diesem Raum sind noch keine Anschlüsse eingezeichnet' : scope === 'all' ? 'Auf keiner Etage sind Anschlüsse eingezeichnet' : 'Auf dieser Etage sind noch keine Anschlüsse eingezeichnet'} – der Plan zeigt dann nur den Grundriss. Anschlüsse setzt du mit dem Werkzeug „Installation › Anschluss“.</p> : null}
          <div className="hstack" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Btn kind="ghost" onClick={onClose}>
              Abbrechen
            </Btn>
            <Btn kind="primary" icon="download" onClick={go} disabled={busy || !planCount}>
              {busy ? 'Wird erstellt …' : format === 'pdf' ? 'PDF erstellen' : planCount > 1 ? `${planCount} Bilder erstellen` : 'Bild erstellen'}
            </Btn>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
