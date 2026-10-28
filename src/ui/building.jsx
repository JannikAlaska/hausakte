import { Icon } from './icons.jsx';
import { Btn, IconBtn, Field, TextInput, NumInput, Select, DateInput, Toggle, Pill, Section, Drawer, Sheet, Empty, ConfirmBtn, Seg, Meter, KV } from './common.jsx';
import { AiRunner, useAiAvailable, AiUnavailable } from './ai-ui.jsx';
import { setUI, openDrawer, closeDrawer, toast, go, showFloor } from './state.js';
import { UploadButton, uploadFiles } from './documents.jsx';
import { GEWERKE, gewerk, CONDITION, ROOM_TYPES, roomType, BUNDESLAENDER, PROJECT_KINDS, projectKind, energyClass, ENERGY_CLASSES } from '../catalog.js';
import { buildingStats, componentWear, roomArea, sortFloors, floorStats } from '../metrics.js';
import { updateHouse, updateDoc, deleteDoc, fileUrl } from '../store.js';
import { createComponent, createProject } from '../actions.js';
import { aiComponents, aiReadImage, getLimits } from '../ai.js';
import { bearingName } from '../roof.js';
import { fmtNum, fmtFixed, fmtEuro, fmtArea, fmtDate } from '../util.js';

const { useState, useRef, useEffect } = React;

const HOUSE_TYPES = ['EFH', 'Doppelhaushälfte', 'Reihenhaus', 'Bungalow', 'Zweifamilienhaus', 'Mehrfamilienhaus'];
const CONSTRUCTIONS = ['Massivbau (Mauerwerk)', 'Stahlbeton', 'Holzständerbau', 'Fertighaus (Holz)', 'Fachwerk', 'Mischbauweise'];

export function BuildingSheet({ data }) {
  const [tab, setTab] = useState('bauteile');
  const comps = Object.values(data.components);
  const rooms = Object.values(data.floors).reduce((s, f) => s + (f.rooms || []).length, 0);
  return (
    <Sheet
      title="Gebäudedaten"
      icon="building"
      eyebrow={data.house?.name || 'Haus'}
      onClose={() => go('modell')}
      tabs={[
        { key: 'bauteile', label: 'Bauteile & Gewerke', icon: 'wrench', count: comps.length },
        { key: 'stamm', label: 'Stammdaten', icon: 'home' },
        { key: 'raeume', label: 'Räume', icon: 'room', count: rooms },
        { key: 'kennwerte', label: 'Kennwerte', icon: 'ruler' },
      ]}
      tab={tab}
      onTab={setTab}
    >
      {tab === 'stamm' ? <MasterData data={data} /> : tab === 'raeume' ? <RoomsTable data={data} /> : tab === 'kennwerte' ? <Metrics data={data} /> : <Components data={data} />}
    </Sheet>
  );
}

// ---------- Stammdaten ----------
function MasterData({ data }) {
  const h = data.house;
  const set = (patch) => updateHouse((x) => ({ ...x, ...patch, example: false }));
  const setModel = (patch) => updateHouse((x) => ({ ...x, model: { ...x.model, ...patch } }));
  const st = buildingStats(h, Object.values(data.floors));
  const missing = [!h.state && 'Bundesland', !h.zip && 'PLZ', !h.buildYear && 'Baujahr', !h.purchaseDate && 'Kaufdatum'].filter(Boolean);
  return (
    <div className="stack">
      {missing.length ? (
        <div className="callout callout-info">
          <Icon name="sparkles" size={16} />
          <span>
            Für genauere KI-Hinweise zu Förderung und Pflichten ergänze: <b>{missing.join(', ')}</b>.
          </span>
        </div>
      ) : null}
      <div className="panel">
        <div className="panel-head">
          <h3>Objekt</h3>
          {h.example ? <Pill className="pill-example">Beispielwerte</Pill> : null}
        </div>
        <div className="grid3">
          <Field label="Bezeichnung" className="field-wide">
            <TextInput id="h-name" value={h.name} onChange={(v) => set({ name: v })} />
          </Field>
          <Field label="Straße und Hausnummer">
            <TextInput id="h-street" value={h.street} onChange={(v) => set({ street: v })} />
          </Field>
          <Field label="PLZ">
            <TextInput id="h-zip" value={h.zip} onChange={(v) => set({ zip: v })} inputMode="numeric" />
          </Field>
          <Field label="Ort">
            <TextInput id="h-city" value={h.city} onChange={(v) => set({ city: v })} />
          </Field>
          <Field label="Bundesland" hint="Für Landes- und Kommunalprogramme">
            <Select id="h-state" value={h.state} placeholder="Bitte wählen" onChange={(v) => set({ state: v })} options={BUNDESLAENDER.map((b) => ({ value: b, label: b }))} />
          </Field>
          <Field label="Baujahr">
            <NumInput id="h-year" value={h.buildYear} onChange={(v) => set({ buildYear: v })} digits={0} />
          </Field>
          <Field label="Kaufdatum" hint="Startet Fristen für Nachrüstpflichten">
            <DateInput id="h-purchase" value={h.purchaseDate} onChange={(v) => set({ purchaseDate: v })} />
          </Field>
          <Field label="Gebäudetyp">
            <Select id="h-type" value={h.houseType} onChange={(v) => set({ houseType: v })} options={HOUSE_TYPES.map((b) => ({ value: b, label: b }))} />
          </Field>
          <Field label="Bauweise">
            <Select id="h-constr" value={h.construction} placeholder="Unbekannt" onChange={(v) => set({ construction: v })} options={CONSTRUCTIONS.map((b) => ({ value: b, label: b }))} />
          </Field>
          <Field label="Wohneinheiten">
            <NumInput id="h-units" value={h.units} onChange={(v) => set({ units: v })} digits={0} />
          </Field>
          <Field label="Personen im Haushalt">
            <NumInput id="h-persons" value={h.persons} onChange={(v) => set({ persons: v })} digits={0} />
          </Field>
          <Field label="Grundstücksfläche">
            <NumInput id="h-plot" value={h.plotArea} onChange={(v) => set({ plotArea: v })} unit="m²" digits={0} />
          </Field>
          <Field label="Wohnfläche" hint={`Aus dem Grundriss: ${fmtArea(st.livingComputed)}`}>
            <NumInput id="h-living" value={h.livingAreaOverride} placeholder={fmtFixed(st.livingComputed, 1)} onChange={(v) => set({ livingAreaOverride: v })} unit="m²" digits={1} />
          </Field>
        </div>
        <div className="hstack" style={{ marginTop: 12, gap: 20 }}>
          <Toggle id="h-self" checked={h.selfUse !== false} onChange={(v) => set({ selfUse: v })} label="Selbst bewohnt" />
          <Toggle id="h-heritage" checked={h.heritage} onChange={(v) => set({ heritage: v })} label="Denkmalschutz" />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Energie & Förderung</h3>
        </div>
        <div className="grid4">
          <Field label="Energieausweis">
            <Select id="h-ec-kind" value={h.energyCert?.kind} placeholder="Keiner" onChange={(v) => set({ energyCert: { ...h.energyCert, kind: v } })} options={['Bedarfsausweis', 'Verbrauchsausweis'].map((b) => ({ value: b, label: b }))} />
          </Field>
          <Field label="Klasse">
            <Select id="h-ec-cls" value={h.energyCert?.cls} placeholder="–" onChange={(v) => set({ energyCert: { ...h.energyCert, cls: v } })} options={ENERGY_CLASSES.map((e) => ({ value: e.c, label: e.c }))} />
          </Field>
          <Field label="Kennwert">
            <NumInput id="h-ec-val" value={h.energyCert?.value} onChange={(v) => set({ energyCert: { ...h.energyCert, value: v } })} unit="kWh/m²a" digits={0} />
          </Field>
          <Field label="Gültig bis">
            <DateInput id="h-ec-valid" value={h.energyCert?.validUntil} onChange={(v) => set({ energyCert: { ...h.energyCert, validUntil: v } })} />
          </Field>
          <Field label="Zu versteuerndes Haushaltseinkommen (optional)" hint="Nur für die KI-Prüfung des Einkommensbonus" className="field-wide">
            <NumInput id="h-income" value={h.householdIncome} onChange={(v) => set({ householdIncome: v })} unit="€" digits={0} />
          </Field>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>3D-Modell & Lage</h3>
        </div>
        <div className="grid4">
          <Field label="Nordrichtung" hint="Drehung des Plans in Grad (0 = oben ist Norden)">
            <NumInput id="h-north" value={h.northAngle} onChange={(v) => set({ northAngle: v ?? 0 })} unit="°" digits={0} />
          </Field>
          <Field label="Geländehöhe" hint="Relativ zum EG-Fußboden">
            <NumInput id="h-ground" value={h.model?.groundLevel} onChange={(v) => setModel({ groundLevel: v ?? 0 })} unit="m" digits={2} />
          </Field>
          <Field label="Fassadenfarbe">
            <input id="h-facade" className="input" type="color" value={h.model?.facadeColor || '#f1efe9'} onChange={(e) => setModel({ facadeColor: e.target.value })} />
          </Field>
          <Field label="Dachfarbe">
            <input id="h-roofcol" className="input" type="color" value={h.model?.roofColor || '#6b5f5a'} onChange={(e) => setModel({ roofColor: e.target.value })} />
          </Field>
          {['x', 'y', 'w', 'd'].map((k) => (
            <Field key={k} label={{ x: 'Grundstück links', y: 'Grundstück oben', w: 'Grundstücksbreite', d: 'Grundstückstiefe' }[k]}>
              <NumInput id={'h-plot-' + k} value={h.model?.plot?.[k]} onChange={(v) => setModel({ plot: { ...(h.model?.plot || {}), [k]: v ?? 0 } })} unit="m" digits={1} />
            </Field>
          ))}
        </div>
      </div>
      <div className="panel">
        <Field label="Notizen zum Haus">
          <TextInput id="h-notes" multiline rows={4} value={h.notes} onChange={(v) => set({ notes: v })} placeholder="Besonderheiten, Mängel aus dem Kaufgutachten, Wünsche …" />
        </Field>
      </div>
    </div>
  );
}

// ---------- Bauteile ----------
const wearTone = (w) => (w.state === 'faellig' ? 'faellig' : w.state === 'bald' ? 'bald' : 'ok');
const wearText = (w, c) =>
  !c.year ? 'Jahr unbekannt' : w.remaining == null ? `seit ${c.year}` : w.remaining <= 0 ? `fällig seit ${w.due}` : `noch ca. ${w.remaining} J.`;

function CompRow({ c }) {
  const w = componentWear(c);
  return (
    <button className="comp" onClick={() => openDrawer({ type: 'component', id: c.id })}>
      <span className="comp-main">
        <b>{c.name}</b>
        <span>
          {[c.material, c.year ? `Bj. ${c.year}` : null].filter(Boolean).join(' · ') || 'Noch keine Angaben'}
        </span>
      </span>
      <span className="comp-wear">
        <Meter ratio={w.ratio} tone={wearTone(w)} />
        <span>{wearText(w, c)}</span>
      </span>
      <span className="hstack" style={{ gap: 6 }}>
        {c.example ? <Pill className="pill-example">Beispiel</Pill> : null}
        {w.state === 'faellig' ? <Pill tone="danger">fällig</Pill> : w.state === 'bald' ? <Pill tone="warn">bald</Pill> : null}
        {c.condition >= 4 ? <Pill tone="warn">Zustand {c.condition}</Pill> : null}
        <Icon name="chevR" size={15} />
      </span>
    </button>
  );
}

function Components({ data }) {
  const [adding, setAdding] = useState(null);
  const comps = Object.values(data.components);
  const byG = Object.fromEntries(GEWERKE.map((g) => [g.key, comps.filter((c) => c.gewerk === g.key)]));
  const used = GEWERKE.filter((g) => byG[g.key].length);
  const unused = GEWERKE.filter((g) => !byG[g.key].length);
  const wear = comps.map((c) => componentWear(c));
  const due = wear.filter((w) => w.state === 'faellig').length;
  const soon = wear.filter((w) => w.state === 'bald').length;
  return (
    <div className="stack">
      <div className="stat-grid">
        <div className="stat">
          <span>Erfasste Bauteile</span>
          <b>{comps.length}</b>
          <small>in {used.length} von {GEWERKE.length} Gewerken</small>
        </div>
        <div className="stat">
          <span>Nutzungsdauer überschritten</span>
          <b style={{ color: due ? 'var(--danger)' : undefined }}>{due}</b>
          <small>Erneuerung einplanen</small>
        </div>
        <div className="stat">
          <span>In den nächsten 5 Jahren fällig</span>
          <b style={{ color: soon ? 'var(--warn)' : undefined }}>{soon}</b>
          <small>vorausschauend bündeln</small>
        </div>
      </div>
      <AiRunner
        title="Bauteile bewerten"
        icon="sparkles"
        desc="Die KI bewertet Alter, Zustand und Pflichten nach dem Hauskauf und sagt dir, was zuerst drankommt – und welche Bauteile du noch erfassen solltest."
        saved={data.house?.ai?.components}
        run={(signal) => aiComponents(data, { signal })}
        onSave={(rec) => updateHouse((h) => ({ ...h, ai: { ...(h.ai || {}), components: rec } }), 100)}
        cta="Bewerten"
        render={(r) => <ComponentAssessment r={r} data={data} />}
      />
      {used.map((g) => (
        <div key={g.key} className="gw-block">
          <div className="gw-head">
            <span className="gw-ico">
              <Icon name={g.icon} size={16} />
            </span>
            <h3>{g.name}</h3>
            <Btn small kind="ghost" icon="plus" onClick={() => setAdding(adding === g.key ? null : g.key)}>
              Bauteil
            </Btn>
          </div>
          {adding === g.key ? <Catalog g={g} existing={byG[g.key]} onDone={() => setAdding(null)} /> : null}
          {byG[g.key].map((c) => (
            <CompRow key={c.id} c={c} />
          ))}
        </div>
      ))}
      <div className="panel">
        <div className="panel-head">
          <h3>Weitere Gewerke erfassen</h3>
        </div>
        <div className="chips">
          {unused.map((g) => (
            <button key={g.key} className={`chip ${adding === g.key ? 'is-on' : ''}`} onClick={() => setAdding(adding === g.key ? null : g.key)}>
              <Icon name={g.icon} size={14} /> {g.name}
            </button>
          ))}
        </div>
        {adding && unused.some((g) => g.key === adding) ? <Catalog g={gewerk(adding)} existing={[]} onDone={() => setAdding(null)} /> : null}
      </div>
    </div>
  );
}

function Catalog({ g, existing, onDone }) {
  const have = new Set(existing.map((c) => c.name));
  return (
    <div className="catalog" style={{ marginBottom: 8 }}>
      {g.items.map((it) => (
        <button
          key={it.name}
          className={`chip chip-add ${have.has(it.name) ? 'is-on' : ''}`}
          onClick={() => {
            const id = createComponent({ gewerk: g.key, name: it.name, life: it.life });
            openDrawer({ type: 'component', id });
            onDone();
          }}
        >
          <Icon name="plus" size={13} /> {it.name}
        </button>
      ))}
      <button
        className="chip chip-add"
        onClick={() => {
          const id = createComponent({ gewerk: g.key, name: 'Eigenes Bauteil' });
          openDrawer({ type: 'component', id });
          onDone();
        }}
      >
        <Icon name="edit" size={13} /> Eigenes
      </button>
    </div>
  );
}

const kindForGewerk = (gw) => PROJECT_KINDS.find((k) => k.gewerk === gw)?.key || 'sonstiges';

function ComponentAssessment({ r, data }) {
  const urg = { hoch: 'danger', mittel: 'warn', niedrig: 'neutral' };
  return (
    <div className="stack" style={{ gap: 8 }}>
      {r.summary ? <p className="ai-summary">{r.summary}</p> : null}
      <ul className="ai-list">
        {(r.items || [])
          .filter((it) => data.components[it.componentId])
          .map((it, i) => {
            const c = data.components[it.componentId];
            const linked = Object.values(data.projects).find((p) => (p.components || []).includes(c.id));
            return (
              <li key={i} className="ai-item">
                <div className="ai-item-head">
                  <b>
                    {c.name}
                    <span className="muted" style={{ fontWeight: 500 }}> · {gewerk(c.gewerk).name}</span>
                  </b>
                  <Pill tone={urg[it.urgency] || 'neutral'}>{it.urgency}</Pill>
                </div>
                <p>
                  <b>{it.action}</b>
                  {it.byYear ? ` – bis ${it.byYear}` : ''}
                </p>
                {it.reason ? <p>{it.reason}</p> : null}
                <div className="ai-actions">
                  {linked ? (
                    <button className="link" onClick={() => openDrawer({ type: 'project', id: linked.id })}>
                      Projekt „{linked.title}“
                    </button>
                  ) : (
                    <Btn small icon="plus" onClick={() => openDrawer({ type: 'project', id: createProject({ title: it.action || c.name, kind: kindForGewerk(c.gewerk), components: [c.id], priority: it.urgency === 'hoch' ? 1 : 2, notes: it.reason || '' }) })}>
                      Als Projekt anlegen
                    </Btn>
                  )}
                </div>
              </li>
            );
          })}
      </ul>
      {(r.missing || []).length ? (
        <div className="callout">
          <Icon name="info" size={16} />
          <div>
            <b>Noch erfassen:</b> {r.missing.join(', ')}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------- Component drawer ----------
export function ComponentDrawer({ data, drawer }) {
  const c = data.components[drawer.id];
  const [aiBusy, setAiBusy] = useState(false);
  const [aiRes, setAiRes] = useState(null);
  const [aiErr, setAiErr] = useState(null);
  const avail = useAiAvailable();
  const photoRef = useRef(null);
  if (!c)
    return (
      <Drawer title="Bauteil nicht gefunden" onClose={closeDrawer}>
        <Empty title="Dieses Bauteil existiert nicht mehr." />
      </Drawer>
    );
  const g = gewerk(c.gewerk);
  const set = (patch) => updateDoc('components', c.id, (x) => ({ ...x, ...patch, example: false }));
  const w = componentWear(c);
  const floors = sortFloors(Object.values(data.floors));
  const floor = c.floorId ? data.floors[c.floorId] : null;
  const photos = Object.values(data.documents).filter((d) => d.componentId === c.id);
  const projects = Object.values(data.projects).filter((p) => (p.components || []).includes(c.id));
  const readPhoto = async (file) => {
    setAiBusy(true);
    setAiErr(null);
    try {
      const lim = await getLimits();
      if (!lim?.images) throw { code: 'images_unavailable' };
      const res = await aiReadImage(file, 'component');
      setAiRes(res);
    } catch (e) {
      setAiErr(e?.code === 'images_unavailable' ? 'Bilder kann die KI in dieser Ansicht nicht lesen.' : e?.code === 'not_granted' ? 'Die KI ist für diese Seite nicht freigegeben.' : 'Das Foto konnte nicht ausgelesen werden.');
    } finally {
      setAiBusy(false);
    }
  };
  return (
    <Drawer
      eyebrow={`Bauteil · ${g.name}`}
      title={c.name}
      icon={g.icon}
      onClose={closeDrawer}
      subtitle={
        <>
          {c.year ? <span>Bj. {c.year}</span> : <span>Jahr unbekannt</span>}
          {w.state === 'faellig' ? <Pill tone="danger">Nutzungsdauer überschritten</Pill> : w.state === 'bald' ? <Pill tone="warn">bald fällig</Pill> : null}
          {c.example ? <Pill className="pill-example">Beispiel</Pill> : null}
        </>
      }
      footer={
        <>
          <ConfirmBtn onConfirm={() => { deleteDoc('components', c.id); closeDrawer(); toast('Bauteil gelöscht'); }} />
          <Btn kind="primary" icon="plus" onClick={() => openDrawer({ type: 'project', id: createProject({ title: `${c.name} erneuern`, kind: kindForGewerk(c.gewerk), components: [c.id] }) })}>
            Modernisierung planen
          </Btn>
        </>
      }
    >
      <Section n={1} title="Bauteil">
        <div className="grid2">
          <Field label="Gewerk">
            <Select id={'c-gw-' + c.id} value={c.gewerk} onChange={(v) => set({ gewerk: v })} options={GEWERKE.map((x) => ({ value: x.key, label: x.name }))} />
          </Field>
          <Field label="Bezeichnung">
            <input id={'c-name-' + c.id} className="input" list={'cat-' + c.id} value={c.name} onChange={(e) => {
              const it = g.items.find((i) => i.name === e.target.value);
              set({ name: e.target.value, ...(it && !c.life ? { life: it.life } : {}) });
            }} />
            <datalist id={'cat-' + c.id}>
              {g.items.map((it) => (
                <option key={it.name} value={it.name} />
              ))}
            </datalist>
          </Field>
          <Field label="Material / Typ" className="field-wide">
            <TextInput id={'c-mat-' + c.id} value={c.material} onChange={(v) => set({ material: v })} placeholder="z. B. Betondachsteine, Gas-Brennwert 20 kW" />
          </Field>
          <Field label="Hersteller">
            <TextInput id={'c-maker-' + c.id} value={c.maker} onChange={(v) => set({ maker: v })} />
          </Field>
          <Field label="Modell">
            <TextInput id={'c-model-' + c.id} value={c.model} onChange={(v) => set({ model: v })} />
          </Field>
        </div>
      </Section>

      <Section n={2} title="Alter & Zustand">
        <div className="grid2">
          <Field label="Eingebaut / zuletzt erneuert">
            <NumInput id={'c-year-' + c.id} value={c.year} onChange={(v) => set({ year: v })} digits={0} placeholder="Jahr" />
          </Field>
          <Field label="Übliche Nutzungsdauer">
            <NumInput id={'c-life-' + c.id} value={c.life} onChange={(v) => set({ life: v })} unit="Jahre" digits={0} />
          </Field>
        </div>
        {c.year && c.life ? (
          <div className="stack" style={{ gap: 5 }}>
            <Meter ratio={w.ratio} tone={wearTone(w)} />
            <span className="small muted">
              {w.age} Jahre alt · {w.remaining > 0 ? `Erneuerung etwa ${w.due}` : `Nutzungsdauer seit ${w.due} überschritten`}
            </span>
          </div>
        ) : null}
        <Field label="Zustand">
          <Seg small value={c.condition} onChange={(v) => set({ condition: v })} options={CONDITION.map((k) => ({ value: k.v, label: String(k.v), title: k.name }))} />
        </Field>
        {c.condition ? <span className="small muted">{CONDITION.find((k) => k.v === c.condition)?.name}</span> : null}
      </Section>

      <Section n={3} title="Maße, Kennwerte, Ort">
        <div className="grid3">
          <Field label="Menge">
            <NumInput id={'c-qty-' + c.id} value={c.qty} onChange={(v) => set({ qty: v })} digits={2} />
          </Field>
          <Field label="Einheit">
            <Select id={'c-unit-' + c.id} value={c.unit} placeholder="–" onChange={(v) => set({ unit: v })} options={['m²', 'm', 'Stk', 'kW', 'kWp', 'kWh', 'l'].map((u) => ({ value: u, label: u }))} />
          </Field>
          <Field label="U-Wert">
            <NumInput id={'c-u-' + c.id} value={c.uValue} onChange={(v) => set({ uValue: v })} unit="W/m²K" digits={2} />
          </Field>
          <Field label="Etage">
            <Select id={'c-floor-' + c.id} value={c.floorId} placeholder="Ganzes Haus" onChange={(v) => set({ floorId: v || null, roomId: null })} options={floors.map((f) => ({ value: f.id, label: f.name }))} />
          </Field>
          <Field label="Raum" className="field-wide" >
            <Select id={'c-room-' + c.id} value={c.roomId} placeholder="–" onChange={(v) => set({ roomId: v || null })} options={(floor?.rooms || []).map((r) => ({ value: r.id, label: r.name }))} disabled={!floor} />
          </Field>
        </div>
      </Section>

      <Section n={4} title="Notizen">
        <TextInput id={'c-notes-' + c.id} multiline value={c.notes} onChange={(v) => set({ notes: v })} placeholder="Mängel, Wartung, Prüfprotokolle, Garantie …" />
      </Section>

      <Section n={5} title="Fotos & Typenschild" aside={<UploadButton componentId={c.id} small label="Foto" accept="image/*" />}>
        {photos.length ? (
          <div className="chips">
            {photos.map((p) => (
              <a key={p.id} href={p.assetId ? fileUrl(p) : undefined} target="_blank" rel="noopener noreferrer" className="doc-mini" style={{ width: 'calc(50% - 4px)' }}>
                <span className="doc-ico">{(p.contentType || '').startsWith('image/') ? <img src={fileUrl(p)} alt="" /> : <Icon name="file" />}</span>
                <div>
                  <b>{p.name}</b>
                  <span>{fmtDate(p.date)}</span>
                </div>
              </a>
            ))}
          </div>
        ) : null}
        <div className="ai-box">
          <div className="ai-head">
            <Icon name="camera" size={16} />
            <b>Typenschild mit KI auslesen</b>
          </div>
          <p className="small muted">Fotografiere das Typenschild oder das Bauteil – die KI erkennt Hersteller, Modell, Baujahr und technische Daten.</p>
          {avail === false ? (
            <AiUnavailable />
          ) : (
            <div className="ai-actions">
              <Btn small kind="ai" icon="camera" disabled={aiBusy} onClick={() => photoRef.current?.click()}>
                {aiBusy ? 'Liest …' : 'Foto auswählen'}
              </Btn>
              <input
                ref={photoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={async (e) => {
                  const f = e.target.files[0];
                  e.target.value = '';
                  if (!f) return;
                  uploadFiles([f], { componentId: c.id, type: 'foto' });
                  readPhoto(f);
                }}
              />
            </div>
          )}
          {aiBusy ? (
            <div className="ai-thinking">
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              KI liest das Foto …
            </div>
          ) : null}
          {aiErr ? (
            <div className="ai-err">
              <Icon name="alert" size={15} />
              {aiErr}
            </div>
          ) : null}
          {aiRes ? (
            <div className="ai-item">
              {aiRes.summary ? <p>{aiRes.summary}</p> : null}
              <div className="small">
                {[['Bezeichnung', aiRes.name], ['Typ', aiRes.material], ['Hersteller', aiRes.maker], ['Modell', aiRes.model], ['Baujahr', aiRes.year]].filter(([, v]) => v).map(([k, v]) => (
                  <KV key={k} k={k} v={String(v)} />
                ))}
              </div>
              {(aiRes.specs || []).length ? (
                <ul>
                  {aiRes.specs.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : null}
              {aiRes.notes ? <p>{aiRes.notes}</p> : null}
              <div className="ai-actions">
                <Btn
                  small
                  icon="check"
                  onClick={() => {
                    set({
                      ...(aiRes.material ? { material: aiRes.material } : {}),
                      ...(aiRes.maker ? { maker: aiRes.maker } : {}),
                      ...(aiRes.model ? { model: aiRes.model } : {}),
                      ...(Number(aiRes.year) > 1900 ? { year: Number(aiRes.year) } : {}),
                      ...(aiRes.specs?.length ? { notes: [c.notes, aiRes.specs.join('; ')].filter(Boolean).join('\n') } : {}),
                    });
                    setAiRes(null);
                    toast('Angaben übernommen');
                  }}
                >
                  Angaben übernehmen
                </Btn>
              </div>
            </div>
          ) : null}
        </div>
      </Section>

      <Section n={6} title="Projekte">
        {projects.length ? (
          <div className="chips">
            {projects.map((p) => (
              <button key={p.id} className="chip" onClick={() => openDrawer({ type: 'project', id: p.id })}>
                <Icon name={projectKind(p.kind).icon} size={13} /> {p.title}
              </button>
            ))}
          </div>
        ) : (
          <p className="small muted">Noch kein Projekt für dieses Bauteil.</p>
        )}
      </Section>
    </Drawer>
  );
}

// ---------- Räume ----------
export function updateRoom(floorId, roomId, patch) {
  updateDoc('floors', floorId, (f) => ({ ...f, rooms: (f.rooms || []).map((r) => (r.id === roomId ? { ...r, ...patch, example: false } : r)) }));
}

function RoomsTable({ data }) {
  const floors = sortFloors(Object.values(data.floors)).reverse();
  return (
    <div className="stack">
      <p className="small muted">Räume legst du im Grundriss an (Werkzeug „Raum“ in einen geschlossenen Bereich klicken). Hier pflegst du Namen und Ausstattung.</p>
      {floors.map((f) => (
        <div key={f.id}>
          <div className="group-title">
            {f.short} · {f.name}
            <span className="tab-count">{(f.rooms || []).length}</span>
          </div>
          {(f.rooms || []).length ? (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Raum</th>
                    <th>Typ</th>
                    <th className="r">Fläche</th>
                    <th>Boden</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {f.rooms.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <input className="input" value={r.name} onChange={(e) => updateRoom(f.id, r.id, { name: e.target.value })} aria-label="Raumname" />
                      </td>
                      <td>
                        <select className="input select" value={r.type} onChange={(e) => updateRoom(f.id, r.id, { type: e.target.value })} aria-label="Raumtyp">
                          {ROOM_TYPES.map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="r mono">{fmtFixed(roomArea(r), 1)} m²</td>
                      <td>
                        <input className="input" value={r.floorCover || ''} onChange={(e) => updateRoom(f.id, r.id, { floorCover: e.target.value })} placeholder="z. B. Parkett" aria-label="Bodenbelag" />
                      </td>
                      <td>
                        <IconBtn icon="chevR" label="Details" onClick={() => openDrawer({ type: 'room', floorId: f.id, roomId: r.id })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="small muted">Keine Räume angelegt.</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function RoomDrawer({ data, drawer }) {
  const f = data.floors[drawer.floorId];
  const r = f?.rooms?.find((x) => x.id === drawer.roomId);
  if (!r)
    return (
      <Drawer title="Raum nicht gefunden" onClose={closeDrawer}>
        <Empty title="Dieser Raum existiert nicht mehr." />
      </Drawer>
    );
  const set = (patch) => updateRoom(f.id, r.id, patch);
  const comps = Object.values(data.components).filter((c) => c.roomId === r.id);
  const computed = Math.abs(roomArea({ ...r, area: null }));
  return (
    <Drawer
      eyebrow={`Raum · ${f.name}`}
      title={r.name || roomType(r.type).name}
      icon="room"
      onClose={closeDrawer}
      subtitle={
        <>
          <Pill tone="accent">{fmtFixed(roomArea(r), 1)} m²</Pill>
          <span>{roomType(r.type).name}</span>
        </>
      }
      footer={
        <>
          <ConfirmBtn onConfirm={() => { updateDoc('floors', f.id, (x) => ({ ...x, rooms: x.rooms.filter((y) => y.id !== r.id) })); closeDrawer(); setUI({ selection: null }); toast('Raum gelöscht'); }} />
          <Btn kind="primary" icon="plan" onClick={() => { closeDrawer(); setUI({ floorId: f.id }); go('grundriss'); }}>
            Im Grundriss bearbeiten
          </Btn>
        </>
      }
    >
      <Section n={1} title="Raum">
        <div className="grid2">
          <Field label="Name">
            <TextInput id={'r-name-' + r.id} value={r.name} onChange={(v) => set({ name: v })} />
          </Field>
          <Field label="Typ">
            <Select id={'r-type-' + r.id} value={r.type} onChange={(v) => set({ type: v })} options={ROOM_TYPES.map((t) => ({ value: t.key, label: t.name }))} />
          </Field>
          <Field label="Fläche" hint={`Aus dem Grundriss (Innenmaß): ${fmtArea(computed)}`}>
            <NumInput id={'r-area-' + r.id} value={r.area} placeholder={fmtFixed(computed, 2)} onChange={(v) => set({ area: v })} unit="m²" digits={2} />
          </Field>
          <Field label="Raumhöhe">
            <NumInput id={'r-h-' + r.id} value={r.height} placeholder={fmtFixed(f.height - (f.slab ?? 0.2), 2)} onChange={(v) => set({ height: v })} unit="m" digits={2} />
          </Field>
        </div>
      </Section>
      <Section n={2} title="Ausstattung">
        <div className="grid2">
          <Field label="Bodenbelag">
            <TextInput id={'r-floor-' + r.id} value={r.floorCover} onChange={(v) => set({ floorCover: v })} placeholder="Parkett, Fliesen …" />
          </Field>
          <Field label="Wände">
            <TextInput id={'r-walls-' + r.id} value={r.wallFinish} onChange={(v) => set({ wallFinish: v })} placeholder="Raufaser, Putz …" />
          </Field>
          <Field label="Decke">
            <TextInput id={'r-ceil-' + r.id} value={r.ceiling} onChange={(v) => set({ ceiling: v })} placeholder="Putz, Holz, abgehängt …" />
          </Field>
          <Field label="Heizung">
            <TextInput id={'r-heat-' + r.id} value={r.heating} onChange={(v) => set({ heating: v })} placeholder="2 Heizkörper, FBH …" />
          </Field>
        </div>
        <Field label="Notizen">
          <TextInput id={'r-notes-' + r.id} multiline value={r.notes} onChange={(v) => set({ notes: v })} placeholder="Steckdosen, Mängel, Ideen …" />
        </Field>
      </Section>
      <Section n={3} title="Bauteile im Raum" aside={<Btn small kind="ghost" icon="plus" onClick={() => openDrawer({ type: 'component', id: createComponent({ floorId: f.id, roomId: r.id, name: 'Neues Bauteil' }) })}>Bauteil</Btn>}>
        {comps.length ? comps.map((c) => <CompRow key={c.id} c={c} />) : <p className="small muted">Keine Bauteile zugeordnet.</p>}
      </Section>
    </Drawer>
  );
}

// ---------- Kennwerte ----------
function Metrics({ data }) {
  const st = buildingStats(data.house, Object.values(data.floors));
  const winShare = st.facadeGross ? (st.windowArea / st.facadeGross) * 100 : 0;
  return (
    <div className="stack">
      <p className="small muted">Berechnet aus deinem 3D-Modell: Flächen nach Innenmaß der Räume, Bruttogrundfläche aus den Außenmaßen. Wie genau die Werte sind, hängt davon ab, wie genau der Grundriss gezeichnet ist.</p>
      <div className="stat-grid">
        <div className="stat"><span>Wohnfläche</span><b>{fmtFixed(st.living, 1)} m²</b><small>{data.house.livingAreaOverride ? 'manuell gesetzt' : 'aus Räumen'}</small></div>
        <div className="stat"><span>Nutzfläche gesamt</span><b>{fmtFixed(st.usable, 1)} m²</b><small>alle Räume</small></div>
        <div className="stat"><span>Bruttogrundfläche</span><b>{fmtFixed(st.gross, 0)} m²</b><small>Summe aller Etagen</small></div>
        <div className="stat"><span>Bruttovolumen</span><b>{fmtFixed(st.volume, 0)} m³</b><small>ohne Dachraum</small></div>
        <div className="stat"><span>Fassade (opak)</span><b>{fmtFixed(st.facadeOpaque, 0)} m²</b><small>über Gelände</small></div>
        <div className="stat"><span>Fenster & Türen</span><b>{fmtFixed(st.windowArea, 1)} m²</b><small>{st.windows} Fenster · {fmtFixed(winShare, 0)} % der Fassade</small></div>
        <div className="stat"><span>Dachfläche</span><b>{fmtFixed(st.roofArea, 0)} m²</b><small>geneigt, mit Überstand</small></div>
        <div className="stat"><span>PV-Potenzial</span><b>{fmtFixed(st.pvKwp, 1)} kWp</b><small>ca. {fmtNum(Math.round(st.pvKwh / 100) * 100, 0)} kWh/a (Schätzung)</small></div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>Dachflächen</h3>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Fläche</th>
                <th>Ausrichtung</th>
                <th className="r">Neigung</th>
                <th className="r">Fläche</th>
                <th className="r">Module</th>
                <th className="r">kWp</th>
                <th className="r">Ertrag/a</th>
              </tr>
            </thead>
            <tbody>
              {st.pv.map((p) => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  <td>
                    {p.azimuth != null ? `${bearingName(p.azimuth)} (${fmtNum(p.azimuth, 0)}°)` : 'flach'}
                  </td>
                  <td className="r">{fmtNum(p.tilt, 0)}°</td>
                  <td className="r">{fmtFixed(p.area, 1)} m²</td>
                  <td className="r">{p.modules}</td>
                  <td className="r">{fmtFixed(p.kwp, 1)}</td>
                  <td className="r">
                    {fmtNum(Math.round(p.kwhYear / 10) * 10, 0)} kWh{' '}
                    <Pill tone={p.factor >= 0.9 ? 'accent' : p.factor >= 0.8 ? 'info' : 'neutral'}>{fmtNum(p.factor * 100, 0)} %</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>Module 1,13 × 1,72 m mit 430 Wp, 45 cm Randabstand. Ertrag mit 950 kWh/kWp bei Südausrichtung, abgemindert nach Ausrichtung und Neigung.</p>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>Etagen</h3>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Etage</th>
                <th className="r">OKFF</th>
                <th className="r">Geschosshöhe</th>
                <th className="r">BGF</th>
                <th className="r">Wohnfläche</th>
                <th className="r">Räume</th>
                <th className="r">Fenster</th>
              </tr>
            </thead>
            <tbody>
              {st.perFloor.slice().reverse().map((p) => (
                <tr key={p.floor.id} className="clickable" onClick={() => { showFloor(p.floor.id); go('modell'); }}>
                  <td>
                    <b>{p.floor.short}</b> {p.floor.name}
                  </td>
                  <td className="r">{fmtFixed(p.floor.elevation, 2)} m</td>
                  <td className="r">{fmtFixed(p.floor.height, 2)} m</td>
                  <td className="r">{fmtFixed(p.gross, 1)} m²</td>
                  <td className="r">{fmtFixed(p.living, 1)} m²</td>
                  <td className="r">{p.roomCount}</td>
                  <td className="r">{p.windows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
