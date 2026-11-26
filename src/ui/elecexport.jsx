// Dialog "Elektroplan als PDF": which storeys, paper size, which connections (existing / planned) and what
// else goes on the plan; the file is saved like every other export (browser download, Android Downloads).
import { Icon } from './icons.jsx';
import { Btn, IconBtn, Field, Seg, Toggle } from './common.jsx';
import { toast } from './state.js';
import { elecPlanPdf, elecSummary, floorsWithFixtures } from '../elecplan.js';
import { saveFile } from '../download.js';
import { todayISO } from '../util.js';

const { useState, useEffect } = React;

const FILTERS = [
  { value: 'alle', label: 'Bestand + geplant' },
  { value: 'bestand', label: 'Nur Bestand' },
  { value: 'geplant', label: 'Nur geplant' },
];

function sumText(s) {
  const parts = [];
  if (s.lamps) parts.push(`${s.lamps} Leuchte${s.lamps === 1 ? '' : 'n'}`);
  if (s.switches) parts.push(`${s.switches} Schalter`);
  if (s.sockets) parts.push(`${s.sockets} Steckdose${s.sockets === 1 ? '' : 'n'}`);
  if (s.net) parts.push(`${s.net} LAN`);
  return parts.join(' · ') || 'keine Anschlüsse';
}

export function ElecExportDialog({ data, floor, filter: startFilter = 'alle', onClose }) {
  const withFx = floorsWithFixtures(data);
  const [scope, setScope] = useState('floor');
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
  const hasPower = floors.some((f) => (f.lines || []).some((l) => l.kind === 'strom'));
  const empty = floors.every((f) => !(f.points || []).length);

  const go = async () => {
    setBusy(true);
    try {
      const pdf = elecPlanPdf(data, { floorIds: floors.map((f) => f.id), paper, furniture, lines: lines && hasPower, list, filter });
      const tag = scope === 'all' ? 'alle-Etagen' : String(floor.short || floor.name || 'Etage').replace(/[^A-Za-z0-9-]+/g, '-');
      if (await saveFile(`Elektroplan_${tag}_${todayISO()}.pdf`, 'application/pdf', pdf)) onClose();
    } catch (e) {
      toast('Der Elektroplan konnte nicht erstellt werden: ' + (e?.message || e), 'err', 6000);
    }
    setBusy(false);
  };

  return ReactDOM.createPortal(
    <div className="qn-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qn-modal" role="dialog" aria-modal="true" aria-label="Elektroplan als PDF">
        <div className="panel stack elec-export">
          <div className="spread">
            <h3 className="hstack" style={{ gap: 8 }}>
              <Icon name="socket" size={18} /> Elektroplan als PDF
            </h3>
            <IconBtn icon="x" label="Schließen" onClick={onClose} />
          </div>
          <p className="small muted">Grundriss mit allen Leuchten, Schaltern und Steckdosen als Symbolen – mit Anzahl und Höhe an jedem Symbol, Legende und Zählung je Raum. Zum Ausdrucken oder für den Elektriker.</p>
          <Field label="Etagen">
            <Seg
              value={scope}
              onChange={setScope}
              options={[
                { value: 'floor', label: floor.name || 'Diese Etage' },
                { value: 'all', label: `Alle mit Anschlüssen (${withFx.length})`, disabled: !withFx.length },
              ]}
            />
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
            <Toggle checked={list} onChange={setList} label="Anschlussliste je Raum als Extraseite" />
          </div>
          <div className="elec-sum">
            {floors.map((f) => (
              <div key={f.id} className="kv">
                <span>{f.name}</span>
                <b>{sumText(elecSummary(f, filter))}</b>
              </div>
            ))}
          </div>
          {empty ? <p className="small muted">{scope === 'all' ? 'Auf keiner Etage sind Anschlüsse eingezeichnet' : 'Auf dieser Etage sind noch keine Anschlüsse eingezeichnet'} – der Plan zeigt dann nur den Grundriss. Anschlüsse setzt du mit dem Werkzeug „Installation › Anschluss“.</p> : null}
          <div className="hstack" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Btn kind="ghost" onClick={onClose}>
              Abbrechen
            </Btn>
            <Btn kind="primary" icon="download" onClick={go} disabled={busy}>
              {busy ? 'Wird erstellt …' : 'PDF erstellen'}
            </Btn>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
