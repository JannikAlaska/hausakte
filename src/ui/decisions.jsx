// Decision tool: question → options & criteria → weighted matrix → pre-mortem → decision with reasons.
// Once decided, everything is kept read-only as a protocol (and can be saved as PDF or reopened).
import { Icon } from './icons.jsx';
import { Btn, IconBtn, Field, TextInput, Select, DateInput, Pill, Section, Drawer, Empty, ConfirmBtn, Seg, AutoText } from './common.jsx';
import { AiRunner } from './ai-ui.jsx';
import { closeDrawer, openDrawer, toast } from './state.js';
import { decOf, decisions, isFromMeeting, DEC_STATUS, WEIGHTS, SCORES, LEVELS, levelName, CRITERIA_PRESETS, createDecision, setDec, matrix, riskScore, riskTone, risksFor, riskSummary, readiness, decide, reopen, newOption, newCriterion, newRisk } from '../decisions.js';
import { liveProjects, isDone } from '../metrics.js';
import { deleteDoc, updateDoc } from '../store.js';
import { addConstraint } from '../actions.js';
import { aiDecisionHelp } from '../ai.js';
import { buildPdf } from '../pdf.js';
import { saveFile } from '../download.js';
import { fmtDate, fmtNum, todayISO, addDays } from '../util.js';

const { useState } = React;

const STEPS = [
  { key: 'frage', label: 'Frage', icon: 'info' },
  { key: 'optionen', label: 'Optionen & Kriterien', icon: 'list' },
  { key: 'bewertung', label: 'Bewertung', icon: 'gantt' },
  { key: 'premortem', label: 'Pre-Mortem', icon: 'alert' },
  { key: 'entscheidung', label: 'Entscheidung', icon: 'check' },
];
const pct = (v) => `${fmtNum(v, 0)} %`;
const nameOf = (o) => String(o?.name || '').trim() || 'Option ohne Namen';

// ---------- list (Projekte › Entscheidungen and inside a project) ----------
export function DecisionList({ data, projectId, showProject = true, emptyText }) {
  const list = decisions(data).filter((d) => projectId === undefined || d.projectId === projectId);
  if (!list.length) return <p className="small muted">{emptyText || 'Noch keine Entscheidungen.'}</p>;
  const open = list.filter((d) => decOf(d).status !== 'entschieden');
  const done = list.filter((d) => decOf(d).status === 'entschieden');
  const row = (d) => {
    const dec = decOf(d);
    const m = matrix(dec);
    const p = d.projectId ? data.projects?.[d.projectId] : null;
    const decided = dec.status === 'entschieden';
    const late = !decided && dec.deadline && dec.deadline < todayISO();
    return (
      <button key={d.id} type="button" className="dec-row" onClick={() => openDrawer({ type: 'decision', id: d.id })}>
        <span className={`dec-row-ico ${decided ? 'is-done' : ''}`}>
          <Icon name={decided ? 'check' : 'scale'} size={16} />
        </span>
        <span className="dec-row-main">
          <b>{dec.question || d.name}</b>
          <span className="small muted">
            {decided ? `Entschieden: ${dec.decision?.optionName || '–'} · ${fmtDate(dec.decision?.date)}${isFromMeeting(dec) ? ' · aus Besprechung' : ''}` : m.leader ? `Favorit: ${nameOf(m.leader.option)} (${pct(m.leader.pct)})` : `${(dec.options || []).length} Optionen · ${m.criteria.length} Kriterien`}
            {showProject && p ? ` · ${p.title}` : ''}
          </span>
        </span>
        {decided ? null : dec.deadline ? <Pill tone={late ? 'warn' : 'neutral'}>bis {fmtDate(dec.deadline)}</Pill> : <Pill tone="warn">offen</Pill>}
      </button>
    );
  };
  return (
    <div className="dec-list">
      {open.map(row)}
      {done.length ? (
        <>
          {open.length ? <div className="group-title">Entschieden</div> : null}
          {done.map(row)}
        </>
      ) : null}
    </div>
  );
}

export function NewDecisionButton({ projectId = null, small = true, kind = 'soft' }) {
  return (
    <Btn small={small} kind={kind} icon="plus" onClick={() => openDrawer({ type: 'decision', id: createDecision({ projectId }) })}>
      Entscheidung
    </Btn>
  );
}

// "+ Neu": the question first, then the drawer
export function NewDecision({ data, onClose }) {
  const projects = liveProjects(data.projects).filter((p) => !isDone(p));
  const [q, setQ] = useState('');
  const [pid, setPid] = useState('');
  const start = () => {
    const id = createDecision({ question: q, projectId: pid || null });
    onClose?.();
    openDrawer({ type: 'decision', id, tab: 'optionen' });
  };
  return (
    <div className="panel">
      <div className="spread">
        <h3>Entscheidung treffen</h3>
        <IconBtn icon="x" label="Schließen" onClick={onClose} />
      </div>
      <p className="small muted">Mit Entscheidungsmatrix und Pre-Mortem – am Ende ist dokumentiert, warum, mit welchen Kriterien und wie entschieden wurde.</p>
      <Field label="Was ist zu entscheiden?">
        <TextInput value={q} onChange={setQ} placeholder="z. B. Welche Heizung bauen wir ein?" autoFocus onKeyDown={(e) => e.key === 'Enter' && q.trim() && start()} />
      </Field>
      <Field label="Zu welchem Projekt? (optional)">
        <Select value={pid} onChange={setPid} options={[{ value: '', label: 'Ohne Projekt' }, ...projects.map((p) => ({ value: p.id, label: p.title }))]} />
      </Field>
      <Btn kind="primary" icon="arrowR" disabled={!q.trim()} onClick={start}>
        Los geht's
      </Btn>
    </div>
  );
}

// ---------- the drawer ----------
export function DecisionDrawer({ data, drawer }) {
  const d = data.documents?.[drawer.id];
  const dec = decOf(d);
  const decided = dec.status === 'entschieden';
  const [tab, setTab] = useState(drawer.tab || (decided ? 'protokoll' : 'frage'));
  if (!d)
    return (
      <Drawer title="Entscheidung nicht gefunden" onClose={closeDrawer}>
        <Empty title="Diese Entscheidung existiert nicht mehr." />
      </Drawer>
    );
  const set = (fn, delay) => setDec(d.id, fn, delay);
  const m = matrix(dec);
  const rd = readiness(dec);
  const p = d.projectId ? data.projects?.[d.projectId] : null;
  const steps = decided ? [{ key: 'protokoll', label: 'Protokoll', icon: 'file' }, ...STEPS.filter((s) => s.key !== 'entscheidung')] : STEPS;
  const cur = steps.some((s) => s.key === tab) ? tab : steps[0].key;
  const doneOf = { frage: rd.steps[0].ok, optionen: rd.steps[1].ok && rd.steps[2].ok, bewertung: rd.steps[3].ok, premortem: rd.steps[4].ok };
  const tabs = steps.map((s, i) => ({ key: s.key, label: decided || s.key === 'protokoll' ? s.label : `${i + 1} ${s.label}`, count: !decided && doneOf[s.key] ? '✓' : null }));
  const idx = steps.findIndex((s) => s.key === cur);
  const next = !decided && idx < steps.length - 1 ? steps[idx + 1] : null;
  const ro = decided;
  return (
    <Drawer
      className="decision-drawer"
      eyebrow={`Entscheidung${p ? ` · ${p.title}` : ''}`}
      title={dec.question || 'Neue Entscheidung'}
      icon="scale"
      onClose={closeDrawer}
      subtitle={
        <>
          <Pill tone={DEC_STATUS[decided ? 'entschieden' : 'offen'].tone}>{decided ? `Entschieden: ${dec.decision?.optionName || ''}` : 'Offen'}</Pill>
          {!decided && dec.deadline ? <span>bis {fmtDate(dec.deadline)}</span> : null}
          {!decided && m.leader ? <span>Favorit: {nameOf(m.leader.option)}</span> : null}
        </>
      }
      tabs={tabs}
      tab={cur}
      onTab={setTab}
      footer={
        <>
          <ConfirmBtn confirmText="Entscheidung löschen?" onConfirm={() => { deleteDoc('documents', d.id); closeDrawer(); toast('Entscheidung gelöscht'); }} />
          {next ? (
            <Btn kind="primary" icon="arrowR" onClick={() => setTab(next.key)}>
              Weiter: {next.label}
            </Btn>
          ) : decided ? (
            <Btn kind="primary" icon="download" onClick={() => exportProtocol(d, data)}>
              Protokoll als PDF
            </Btn>
          ) : null}
        </>
      }
    >
      {cur === 'protokoll' ? <Protocol d={d} data={data} /> : null}
      <fieldset className="ro-fieldset" disabled={ro}>
        {ro && cur !== 'protokoll' ? <p className="small muted dec-ro-note"><Icon name="lock" size={13} /> Entschieden – zum Ändern im Protokoll „Wieder öffnen“.</p> : null}
        {cur === 'frage' ? <StepQuestion d={d} dec={dec} data={data} set={set} /> : null}
        {cur === 'optionen' ? <StepOptions d={d} dec={dec} data={data} set={set} ro={ro} /> : null}
        {cur === 'bewertung' ? <StepMatrix dec={dec} set={set} m={m} /> : null}
        {cur === 'premortem' ? <StepPremortem d={d} dec={dec} data={data} set={set} m={m} ro={ro} /> : null}
      </fieldset>
      {cur === 'entscheidung' ? <StepDecide d={d} dec={dec} data={data} m={m} rd={rd} onDone={() => setTab('protokoll')} onGo={setTab} /> : null}
    </Drawer>
  );
}

// ---------- 1 question ----------
function StepQuestion({ d, dec, data, set }) {
  const projects = liveProjects(data.projects);
  return (
    <>
      <Section title="Worum geht es?">
        <Field label="Frage">
          <TextInput value={dec.question} onChange={(v) => set({ question: v })} placeholder="z. B. Welche Heizung bauen wir ein?" />
        </Field>
        <Field label="Hintergrund & Ziel" hint="Was soll die Entscheidung erreichen, was ist vorgegeben?">
          <TextInput multiline rows={4} value={dec.context} onChange={(v) => set({ context: v })} placeholder="z. B. Ölheizung ist 30 Jahre alt, Förderung nur bis Ende 2027, Fachwerkhaus mit Heizkörpern …" />
        </Field>
        <div className="grid2">
          <Field label="Entscheiden bis">
            <DateInput value={dec.deadline} onChange={(v) => set({ deadline: v })} />
          </Field>
          <Field label="Wer entscheidet">
            <TextInput value={dec.who} onChange={(v) => set({ who: v })} placeholder="z. B. Jannik und Anna" />
          </Field>
        </div>
        <Field label="Projekt">
          <Select value={d.projectId || ''} onChange={(v) => setDecDoc(d.id, { projectId: v || null })} options={[{ value: '', label: 'Ohne Projekt' }, ...projects.map((p) => ({ value: p.id, label: p.title }))]} />
        </Field>
      </Section>
      <div className="dec-howto">
        <b>So gehst du vor</b>
        <ol>
          <li><b>Optionen & Kriterien:</b> Was steht zur Wahl, und worauf kommt es an? Kriterien gewichtest du von 1 (unwichtig) bis 5 (entscheidend).</li>
          <li><b>Bewertung:</b> Jede Option bekommt pro Kriterium 1–5 Punkte. Die Matrix rechnet Gewicht × Punkte zusammen.</li>
          <li><b>Pre-Mortem:</b> Stell dir vor, die Entscheidung ist schiefgegangen – warum? So findest du Risiken und Gegenmaßnahmen, bevor es zu spät ist.</li>
          <li><b>Entscheidung:</b> Option wählen und begründen. Alles wird als Protokoll festgehalten.</li>
        </ol>
      </div>
    </>
  );
}
const setDecDoc = (id, patch) => updateDoc('documents', id, (x) => ({ ...x, ...patch }));

// ---------- 2 options & criteria ----------
function StepOptions({ d, dec, data, set, ro }) {
  const options = dec.options || [];
  const criteria = dec.criteria || [];
  const updO = (id, patch) => set((x) => ({ ...x, options: (x.options || []).map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
  const updC = (id, patch) => set((x) => ({ ...x, criteria: (x.criteria || []).map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const addO = (name = '', note = '') => set((x) => ({ ...x, options: [...(x.options || []), { ...newOption(name), note }] }), 50);
  const addC = (name = '', weight = 3) => set((x) => ({ ...x, criteria: [...(x.criteria || []), newCriterion(name, weight)] }), 50);
  const has = (list, name) => list.some((x) => String(x.name || '').trim().toLowerCase() === String(name).trim().toLowerCase());
  return (
    <>
      <Section title="Optionen" aside={`${options.length}`}>
        <div className="dec-items">
          {options.map((o, i) => (
            <div key={o.id} className="dec-item">
              <span className="dec-item-n">{String.fromCharCode(65 + i)}</span>
              <div className="dec-item-main">
                <AutoText value={o.name} onChange={(v) => updO(o.id, { name: v })} placeholder="Option, z. B. Luft-Wärmepumpe" aria-label="Option" />
                <AutoText className="dec-note" value={o.note} onChange={(v) => updO(o.id, { note: v })} placeholder="Kurz beschreiben (Kosten, Anbieter, Besonderheiten) – optional" aria-label="Beschreibung" />
              </div>
              {ro ? null : <IconBtn icon="trash" size={15} label="Option entfernen" onClick={() => set((x) => ({ ...x, options: (x.options || []).filter((y) => y.id !== o.id) }))} />}
            </div>
          ))}
        </div>
        {ro ? null : (
          <button type="button" className="chip chip-add" onClick={() => addO()}>
            <Icon name="plus" size={13} /> Option
          </button>
        )}
      </Section>
      <Section title="Kriterien" aside={`${criteria.length}`}>
        <p className="small muted">Worauf kommt es an? Das Gewicht sagt, wie wichtig das Kriterium ist: 1 = unwichtig … 5 = entscheidend.</p>
        <div className="dec-items">
          {criteria.map((c) => (
            <div key={c.id} className="dec-item dec-crit">
              <div className="dec-item-main">
                <AutoText value={c.name} onChange={(v) => updC(c.id, { name: v })} placeholder="Kriterium, z. B. Laufende Kosten" aria-label="Kriterium" />
                <div className="dec-weight">
                  <span className="small muted">Gewicht</span>
                  <Seg small value={c.weight || 3} onChange={(v) => updC(c.id, { weight: v })} options={WEIGHTS} />
                </div>
              </div>
              {ro ? null : <IconBtn icon="trash" size={15} label="Kriterium entfernen" onClick={() => set((x) => ({ ...x, criteria: (x.criteria || []).filter((y) => y.id !== c.id), scores: Object.fromEntries(Object.entries(x.scores || {}).filter(([k]) => k !== c.id)) }))} />}
            </div>
          ))}
        </div>
        {ro ? null : (
          <div className="chips">
            <button type="button" className="chip chip-add" onClick={() => addC()}>
              <Icon name="plus" size={13} /> Eigenes
            </button>
            {CRITERIA_PRESETS.filter((n) => !has(criteria, n)).map((n) => (
              <button key={n} type="button" className="chip chip-add" onClick={() => addC(n)}>
                <Icon name="plus" size={13} /> {n}
              </button>
            ))}
          </div>
        )}
      </Section>
      {ro ? null : (
        <AiRunner
          title="Optionen & Kriterien vorschlagen"
          icon="sparkles"
          desc="Die KI schlägt passend zu deiner Frage und deinem Haus weitere Optionen und Kriterien mit Gewicht vor. Du übernimmst nur, was passt."
          saved={dec.ai?.setup}
          run={(signal) => aiDecisionHelp('setup', d, data, { signal })}
          onSave={(rec) => set((x) => ({ ...x, ai: { ...(x.ai || {}), setup: rec } }), 50)}
          cta="Vorschläge holen"
          render={(r) => (
            <div className="dec-sugg">
              {(r.options || []).length ? <span className="field-label">Optionen</span> : null}
              {(r.options || []).map((o, i) => (
                <SuggRow key={'o' + i} title={o.name} sub={o.note} added={has(options, o.name)} onAdd={() => addO(o.name, o.note || '')} />
              ))}
              {(r.criteria || []).length ? <span className="field-label">Kriterien</span> : null}
              {(r.criteria || []).map((c, i) => (
                <SuggRow key={'c' + i} title={`${c.name} · Gewicht ${c.weight || 3}`} sub={c.why} added={has(criteria, c.name)} onAdd={() => addC(c.name, Math.min(5, Math.max(1, Math.round(c.weight || 3))))} />
              ))}
            </div>
          )}
        />
      )}
    </>
  );
}

function SuggRow({ title, sub, added, onAdd }) {
  return (
    <div className={`dec-sugg-row ${added ? 'is-added' : ''}`}>
      <span>
        <b>{title}</b>
        {sub ? <span className="small muted">{sub}</span> : null}
      </span>
      {added ? (
        <span className="small muted">
          <Icon name="check" size={13} /> übernommen
        </span>
      ) : (
        <Btn small kind="ghost" icon="plus" onClick={onAdd}>
          Übernehmen
        </Btn>
      )}
    </div>
  );
}

// ---------- 3 matrix ----------
function Results({ m, dec, compact }) {
  if (!m.rows.length) return null;
  return (
    <div className="dec-results">
      <div className="spread">
        <span className="field-label">Ergebnis der Matrix</span>
        {m.close ? <Pill tone="warn">knapp</Pill> : m.complete ? <Pill tone="accent">vollständig bewertet</Pill> : <span className="small muted">{m.done}/{m.cells} bewertet</span>}
      </div>
      {m.ranked.map((r, i) => {
        const rs = riskSummary(dec, r.option.id);
        return (
          <div key={r.option.id} className={`dec-bar-row ${i === 0 && m.leader ? 'is-lead' : ''}`}>
            <span className="dec-bar-name">
              {i === 0 && m.leader ? <Icon name="star" size={13} /> : null}
              {nameOf(r.option)}
            </span>
            <span className="dec-bar">
              <span style={{ width: `${r.pct}%` }} />
            </span>
            <b className="dec-bar-pct">{pct(r.pct)}</b>
            {compact ? null : (
              <span className="dec-bar-sub small muted">
                {r.pts} von {m.maxPts} Punkten{r.rated < m.criteria.length ? ` · ${m.criteria.length - r.rated} offen` : ''}
                {rs.high ? ` · ${rs.high === 1 ? '1 hohes Risiko' : `${rs.high} hohe Risiken`}` : ''}
              </span>
            )}
          </div>
        );
      })}
      {m.close ? <p className="small muted">Die ersten beiden liegen weniger als 5 Prozentpunkte auseinander – schau dir die Gewichte und das Pre-Mortem besonders genau an.</p> : null}
    </div>
  );
}

function ScorePick({ value, onChange, label }) {
  return (
    <div className="score-pick" role="radiogroup" aria-label={label}>
      {SCORES.map((s) => (
        <button key={s.value} type="button" role="radio" aria-checked={value === s.value} className={value === s.value ? `is-on s${s.value}` : ''} title={`${s.value} = ${s.title}`} onClick={() => onChange(value === s.value ? null : s.value)}>
          {s.value}
        </button>
      ))}
    </div>
  );
}

function StepMatrix({ dec, set, m }) {
  const options = dec.options || [];
  if (options.length < 2 || !m.criteria.length)
    return <p className="small muted dec-empty">Lege unter „Optionen & Kriterien“ mindestens zwei Optionen und ein Kriterium an – dann bewertest du hier.</p>;
  const setScore = (cid, oid, v) =>
    set((x) => {
      const row = { ...(x.scores?.[cid] || {}) };
      if (v) row[oid] = v;
      else delete row[oid];
      return { ...x, scores: { ...(x.scores || {}), [cid]: row } };
    }, 150);
  return (
    <>
      <Results m={m} dec={dec} />
      <p className="small muted">Pro Kriterium jede Option bewerten: 1 = sehr schlecht … 5 = sehr gut. Bei Kosten heißt „gut“ günstig. Nochmal tippen löscht die Bewertung.</p>
      {m.criteria.map((c) => (
        <div key={c.id} className="dec-crit-card">
          <div className="spread">
            <b>{c.name}</b>
            <span className="small muted">Gewicht {c.weight || 3}</span>
          </div>
          {options.map((o, i) => (
            <div key={o.id} className="score-row">
              <span className="score-opt">
                <span className="dec-item-n">{String.fromCharCode(65 + i)}</span>
                {nameOf(o)}
              </span>
              <ScorePick value={dec.scores?.[c.id]?.[o.id] || null} onChange={(v) => setScore(c.id, o.id, v)} label={`${c.name}: ${nameOf(o)}`} />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// ---------- 4 pre-mortem ----------
const PROMPTS = ['Was ist teurer geworden als gedacht?', 'Was hat viel länger gedauert?', 'Welcher Handwerker oder Lieferant ist ausgefallen?', 'Was passte technisch nicht zum alten Haus?', 'Was haben wir im Alltag unterschätzt?', 'Welche Förderung oder Genehmigung ging schief?'];

function StepPremortem({ d, dec, data, set, m, ro }) {
  const options = (dec.options || []).filter((o) => String(o.name || '').trim());
  const [target, setTarget] = useState(() => dec.decision?.optionId || m.leader?.option.id || options[0]?.id || null);
  const tgt = options.find((o) => o.id === target) || options[0] || null;
  const risks = (dec.risks || []).filter((r) => (r.optionId || null) === (tgt?.id || null));
  const upd = (id, patch) => set((x) => ({ ...x, risks: (x.risks || []).map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const add = (text = '', extra = {}) => set((x) => ({ ...x, risks: [...(x.risks || []), { ...newRisk(tgt?.id || null, text), ...extra }] }), 50);
  const inYear = fmtDate(addDays(todayISO(), 365));
  if (!tgt) return <p className="small muted dec-empty">Lege zuerst unter „Optionen & Kriterien“ die Optionen an.</p>;
  return (
    <>
      <div className="dec-pm-intro">
        <Icon name="alert" size={18} />
        <div>
          <b>Stell dir vor, es ist der {inYear}.</b> Die Entscheidung für <b>„{nameOf(tgt)}“</b> war ein Fehlschlag. Was ist passiert? Schreib alle Gründe auf, die dir einfallen – und was du heute schon dagegen tun kannst.
        </div>
      </div>
      {options.length > 1 ? (
        <Field label="Pre-Mortem für">
          <div className="chips">
            {options.map((o) => {
              const rs = riskSummary(dec, o.id);
              return (
                <button key={o.id} type="button" className={`chip ${o.id === tgt.id ? 'is-on' : ''}`} onClick={() => setTarget(o.id)}>
                  {m.leader?.option.id === o.id ? <Icon name="star" size={12} /> : null} {nameOf(o)}
                  {rs.count ? <span className="tab-count">{rs.count}</span> : null}
                </button>
              );
            })}
          </div>
        </Field>
      ) : null}
      <div className="dec-risks">
        {risks.map((r) => (
          <div key={r.id} className={`dec-risk tone-${riskTone(r)}`}>
            <div className="dec-risk-top">
              <AutoText value={r.text} onChange={(v) => upd(r.id, { text: v })} placeholder={r.hint || 'Was ist schiefgegangen?'} aria-label="Risiko" />
              {ro ? null : <IconBtn icon="trash" size={15} label="Risiko entfernen" onClick={() => set((x) => ({ ...x, risks: (x.risks || []).filter((y) => y.id !== r.id) }))} />}
            </div>
            <div className="dec-risk-levels">
              <span className="small muted">Wahrscheinlichkeit</span>
              <Seg small value={r.likelihood || 2} onChange={(v) => upd(r.id, { likelihood: v })} options={LEVELS.map((l) => ({ value: l.value, label: l.name }))} />
              <span className="small muted">Auswirkung</span>
              <Seg small value={r.impact || 2} onChange={(v) => upd(r.id, { impact: v })} options={LEVELS.map((l) => ({ value: l.value, label: l.name }))} />
            </div>
            <TextInput value={r.measure || ''} onChange={(v) => upd(r.id, { measure: v })} placeholder="Gegenmaßnahme: Was tun wir, damit es nicht passiert?" aria-label="Gegenmaßnahme" />
          </div>
        ))}
      </div>
      {ro ? null : (
        <>
          <button type="button" className="chip chip-add" onClick={() => add()}>
            <Icon name="plus" size={13} /> Grund aufschreiben
          </button>
          <div className="dec-prompts">
            <span className="small muted">Denkanstöße:</span>
            {PROMPTS.map((t) => (
              <button key={t} type="button" className="link small" onClick={() => add('', { hint: t })}>
                {t}
              </button>
            ))}
          </div>
          <AiRunner
            title="Risiken vorschlagen"
            icon="sparkles"
            desc={`Die KI spielt das Pre-Mortem für „${nameOf(tgt)}“ durch – mit Blick auf dein Haus – und schlägt Risiken mit Gegenmaßnahmen vor.`}
            saved={dec.ai?.premortem?.[tgt.id]}
            run={(signal) => aiDecisionHelp('premortem', d, data, { signal, optionId: tgt.id })}
            onSave={(rec) => set((x) => ({ ...x, ai: { ...(x.ai || {}), premortem: { ...(x.ai?.premortem || {}), [tgt.id]: rec } } }), 50)}
            cta="Risiken vorschlagen"
            render={(r) => (
              <div className="dec-sugg">
                {(r.risks || []).map((x, i) => {
                  const added = risks.some((y) => String(y.text || '').trim().toLowerCase() === String(x.text || '').trim().toLowerCase());
                  return <SuggRow key={i} title={x.text} sub={`Wahrscheinlichkeit ${levelName(x.likelihood)} · Auswirkung ${levelName(x.impact)}${x.measure ? ` · Gegenmaßnahme: ${x.measure}` : ''}`} added={added} onAdd={() => add(x.text, { likelihood: x.likelihood || 2, impact: x.impact || 2, measure: x.measure || '' })} />;
                })}
              </div>
            )}
          />
        </>
      )}
    </>
  );
}

// ---------- 5 decide ----------
function StepDecide({ d, dec, data, m, rd, onDone, onGo }) {
  const options = (dec.options || []).filter((o) => String(o.name || '').trim());
  const [pick, setPick] = useState(() => m.leader?.option.id || options[0]?.id || null);
  const [why, setWhy] = useState('');
  const [by, setBy] = useState(dec.who || '');
  const [date, setDate] = useState(todayISO());
  const [next, setNext] = useState('');
  const measures = risksFor(dec, pick).filter((r) => String(r.measure || '').trim());
  const [asTasks, setAsTasks] = useState(true);
  const deviates = m.leader && pick && pick !== m.leader.option.id;
  const ok = pick && why.trim().length >= 3;
  const go = () => {
    decide(d.id, { optionId: pick, rationale: why, by, date, next });
    if (d.projectId && asTasks && measures.length) for (const r of measures) addConstraint(d.projectId, `${r.measure} (aus Entscheidung „${dec.question}“)`, 'organisatorisch');
    toast(d.projectId && asTasks && measures.length ? `Entschieden – ${measures.length} Gegenmaßnahme${measures.length === 1 ? '' : 'n'} als Aufgabe im Projekt` : 'Entschieden und dokumentiert', 'ok', 4000);
    onDone();
  };
  return (
    <>
      <div className="dec-ready">
        {rd.steps.map((s) => (
          <button key={s.key} type="button" className={`dec-ready-item ${s.ok ? 'is-ok' : ''}`} onClick={() => !s.ok && onGo(s.key === 'kriterien' ? 'optionen' : s.key)}>
            <Icon name={s.ok ? 'check' : 'alert'} size={13} /> {s.text}
          </button>
        ))}
      </div>
      <Results m={m} dec={dec} compact />
      <Section title="Wofür entscheidest du dich?">
        <div className="dec-pick">
          {options.map((o) => {
            const r = m.rows.find((x) => x.option.id === o.id);
            const rs = riskSummary(dec, o.id);
            return (
              <label key={o.id} className={`dec-pick-opt ${pick === o.id ? 'is-on' : ''}`}>
                <input type="radio" name={'pick-' + d.id} checked={pick === o.id} onChange={() => setPick(o.id)} />
                <span>
                  <b>{nameOf(o)}</b>
                  <span className="small muted">
                    {r ? `Matrix ${pct(r.pct)}` : ''}
                    {m.leader?.option.id === o.id ? ' · Favorit' : ''}
                    {rs.count ? ` · ${rs.count === 1 ? '1 Risiko' : `${rs.count} Risiken`}${rs.high ? `, ${rs.high} hoch` : ''}` : ''}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {deviates ? (
          <div className="callout callout-warn">
            <Icon name="alert" size={16} />
            <span>Du entscheidest dich gegen den Favoriten der Matrix („{nameOf(m.leader.option)}“). Das ist in Ordnung – schreib in die Begründung, was die Matrix nicht abbildet.</span>
          </div>
        ) : null}
        <Field label="Begründung (Pflicht)" hint="Warum diese Option? Was gab den Ausschlag, was nimmst du bewusst in Kauf?">
          <TextInput multiline rows={4} value={why} onChange={setWhy} placeholder="z. B. Beste Gesamtbewertung, Förderung sicher, Risiko Lautstärke durch Aufstellort im Garten gelöst …" />
        </Field>
        <div className="grid2">
          <Field label="Entschieden von">
            <TextInput value={by} onChange={setBy} placeholder="Namen" />
          </Field>
          <Field label="Datum">
            <DateInput value={date} onChange={(v) => setDate(v || todayISO())} />
          </Field>
        </div>
        <Field label="Nächste Schritte / Bedingungen (optional)">
          <TextInput multiline rows={2} value={next} onChange={setNext} placeholder="z. B. Angebot von Firma X bis 15.12. annehmen, Förderantrag vorher stellen" />
        </Field>
        {d.projectId && measures.length ? (
          <label className="dec-check">
            <input type="checkbox" checked={asTasks} onChange={(e) => setAsTasks(e.target.checked)} />
            <span>
              {measures.length} Gegenmaßnahme{measures.length === 1 ? '' : 'n'} aus dem Pre-Mortem als Aufgabe{measures.length === 1 ? '' : 'n'} ins Projekt übernehmen
            </span>
          </label>
        ) : null}
        <Btn kind="primary" icon="check" disabled={!ok} onClick={go}>
          Entscheidung treffen und dokumentieren
        </Btn>
        {!rd.ok ? <p className="small muted">Noch nicht alles ausgefüllt (siehe oben) – entscheiden kannst du trotzdem, das Protokoll hält fest, was fehlte.</p> : null}
      </Section>
    </>
  );
}

// ---------- protocol ----------
// the meeting a decision was taken in, if it still exists: { project, meeting }
function sourceMeeting(dec, data) {
  const src = dec.source;
  if (src?.kind !== 'besprechung') return null;
  const project = data.projects?.[src.projectId];
  const meeting = project?.meetings?.find((m) => m.id === src.meetingId);
  return meeting ? { project, meeting } : null;
}

function Protocol({ d, data }) {
  const dec = decOf(d);
  const x = dec.decision || {};
  const s = x.snapshot || {};
  const p = d.projectId ? data.projects?.[d.projectId] : null;
  const [why, setWhy] = useState('');
  const fromMeeting = isFromMeeting(dec);
  const meet = sourceMeeting(dec, data);
  const noMatrix = !(s.ranking || []).length;
  return (
    <div className="dec-protocol">
      <div className="dec-verdict">
        <Icon name="check" size={20} />
        <div>
          <span className="small">Entschieden am {fmtDate(x.date)}{x.by ? ` von ${x.by}` : ''}</span>
          <b>{x.optionName}</b>
          <span className="small">{fromMeeting ? `in der Besprechung „${dec.source.title || 'Besprechung'}“ festgehalten` : noMatrix ? 'ohne Entscheidungsmatrix' : s.followedMatrix ? 'entspricht dem Favoriten der Matrix' : 'weicht vom Favoriten der Matrix ab'}</span>
        </div>
      </div>
      {fromMeeting ? (
        <div className="dec-source">
          <Icon name="mic" size={14} />
          <div>
            <span className="small">
              {meet ? `Aus der Besprechung „${meet.meeting.title || 'Besprechung'}“ vom ${fmtDate(meet.meeting.date)} übernommen.` : `Aus einer Besprechung vom ${fmtDate(dec.source.date)} übernommen (die Besprechung gibt es nicht mehr).`}
            </span>{' '}
            {meet ? (
              <button type="button" className="link small" onClick={() => openDrawer({ type: 'project', id: meet.project.id, tab: 'besprechungen' })}>
                Zur Besprechung
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <Section title="Frage">
        <p>{dec.question}</p>
        {dec.context ? <p className="small muted pre-wrap">{dec.context}</p> : null}
        {p ? <p className="small muted">Projekt: {p.title}</p> : null}
      </Section>
      <Section title="Begründung">
        {x.rationale ? <p className="pre-wrap">{x.rationale}</p> : <p className="small muted">Keine Begründung festgehalten.</p>}
        {x.next ? (
          <>
            <span className="field-label">Nächste Schritte / Bedingungen</span>
            <p className="pre-wrap small">{x.next}</p>
          </>
        ) : null}
      </Section>
      {noMatrix ? (
        <Section title="Optionen">
          <ul className="dec-opt-plain">
            {(dec.options || []).filter((o) => String(o.name || '').trim()).map((o) => (
              <li key={o.id} className={o.id === x.optionId ? 'is-lead' : ''}>
                {o.id === x.optionId ? <Icon name="check" size={13} /> : <span className="dec-opt-dot" />} {o.name}
                {o.id === x.optionId ? <span className="small muted"> – gewählt</span> : <span className="small muted"> – verworfen</span>}
              </li>
            ))}
          </ul>
          <p className="small muted">{fromMeeting ? 'Ohne Entscheidungsmatrix – entschieden in der Besprechung.' : 'Ohne Entscheidungsmatrix entschieden.'} Mit „Wieder öffnen“ kannst du sie nachträglich mit Matrix und Pre-Mortem prüfen; diese Entscheidung bleibt dabei im Verlauf.</p>
        </Section>
      ) : (
      <Section title="Matrix zum Zeitpunkt der Entscheidung">
        {(s.ranking || []).map((r, i) => (
          <div key={r.id} className={`dec-bar-row ${r.id === x.optionId ? 'is-lead' : ''}`}>
            <span className="dec-bar-name">
              {r.id === x.optionId ? <Icon name="check" size={13} /> : null}
              {i + 1}. {r.name}
            </span>
            <span className="dec-bar">
              <span style={{ width: `${r.pct}%` }} />
            </span>
            <b className="dec-bar-pct">{pct(r.pct)}</b>
          </div>
        ))}
        <span className="field-label">Kriterien und Gewichte</span>
        <div className="chips">
          {(s.criteria || []).map((c) => (
            <span key={c.id} className="chip">
              {c.name} <b>×{c.weight}</b>
            </span>
          ))}
        </div>
      </Section>
      )}
      {noMatrix && !(s.risks || []).length ? null : (
      <Section title={`Pre-Mortem für „${x.optionName}“`}>
        {(s.risks || []).length ? (
          (s.risks || []).map((r, i) => (
            <div key={i} className={`dec-risk-line tone-${riskTone(r)}`}>
              <b>{r.text}</b>
              <span className="small muted">
                Wahrscheinlichkeit {levelName(r.likelihood)} · Auswirkung {levelName(r.impact)}
              </span>
              {r.measure ? <span className="small">Gegenmaßnahme: {r.measure}</span> : <span className="small muted">keine Gegenmaßnahme notiert</span>}
            </div>
          ))
        ) : (
          <p className="small muted">Für diese Option wurde kein Pre-Mortem gemacht.</p>
        )}
      </Section>
      )}
      <Section title="Verlauf">
        <ul className="dec-history">
          {[...(dec.history || [])].reverse().map((h, i) => (
            <li key={i}>
              <span className="small muted">{new Date(h.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span> {h.text}
            </li>
          ))}
        </ul>
        {(dec.earlier || []).length ? <p className="small muted">Frühere Entscheidungen: {dec.earlier.map((e) => `${e.optionName} (${fmtDate(e.date)})`).join(', ')}</p> : null}
      </Section>
      <div className="dec-reopen">
        <TextInput value={why} onChange={setWhy} placeholder="Warum wieder öffnen? (optional)" aria-label="Grund zum Wiederöffnen" />
        <ConfirmBtn icon="unlock" confirmText="Wirklich wieder öffnen?" onConfirm={() => { reopen(d.id, why.trim()); toast('Wieder geöffnet – die bisherige Entscheidung bleibt im Verlauf'); }}>
          Wieder öffnen
        </ConfirmBtn>
      </div>
    </div>
  );
}

// ---------- PDF ----------
export function exportProtocol(d, data) {
  const dec = decOf(d);
  const x = dec.decision || {};
  const s = x.snapshot || {};
  const p = d.projectId ? data.projects?.[d.projectId] : null;
  const opts = dec.options || [];
  const crits = (dec.criteria || []).filter((c) => String(c.name || '').trim());
  const blocks = [
    { t: 'title', text: `Entscheidung: ${dec.question}` },
    { t: 'small', text: `${data.house?.name || 'Hausakte'}${p ? ` · Projekt ${p.title}` : ''} · Protokoll erstellt am ${fmtDate(todayISO())}` },
    { t: 'h', text: 'Ergebnis' },
    { t: 'p', text: `Entschieden für: ${x.optionName}` },
    { t: 'p', text: `Am ${fmtDate(x.date)}${x.by ? ` von ${x.by}` : ''} – ${isFromMeeting(dec) ? `in der Besprechung „${dec.source.title || 'Besprechung'}“ festgehalten (ohne Entscheidungsmatrix).` : !(s.ranking || []).length ? 'ohne Entscheidungsmatrix.' : s.followedMatrix ? 'entspricht dem Favoriten der Matrix.' : 'weicht vom Favoriten der Matrix ab.'}` },
    { t: 'h', text: 'Begründung' },
    { t: 'p', text: x.rationale || '–' },
  ];
  const noMatrix = !crits.length;
  if (x.next) blocks.push({ t: 'h', text: 'Nächste Schritte / Bedingungen' }, { t: 'p', text: x.next });
  if (dec.context) blocks.push({ t: 'h', text: 'Hintergrund & Ziel' }, { t: 'p', text: dec.context });
  blocks.push({ t: 'h', text: 'Optionen' });
  opts.forEach((o, i) => blocks.push({ t: 'p', text: `${String.fromCharCode(65 + i)}) ${nameOf(o)}${o.note ? ` – ${o.note}` : ''}` }));
  if (!noMatrix) blocks.push({ t: 'h', text: 'Entscheidungsmatrix (Punkte 1–5, Gewicht 1–5)' });
  const ow = Math.max(40, Math.floor(300 / Math.max(1, opts.length)));
  if (!noMatrix) blocks.push({
    t: 'table',
    cols: [{ w: 170 }, { w: 45, right: true }, ...opts.map(() => ({ w: ow, right: true }))],
    head: ['Kriterium', 'Gewicht', ...opts.map((o, i) => String.fromCharCode(65 + i))],
    rows: crits.map((c) => [c.name, String(c.weight || 3), ...opts.map((o) => String(dec.scores?.[c.id]?.[o.id] || '–'))]),
    foot: ['Ergebnis', '', ...opts.map((o) => {
      const r = (s.ranking || []).find((y) => y.id === o.id);
      return r ? `${fmtNum(r.pct, 0)} %` : '–';
    })],
  });
  if (!noMatrix || (s.risks || []).length) blocks.push({ t: 'h', text: `Pre-Mortem für „${x.optionName}“` });
  if (noMatrix && !(s.risks || []).length);
  else if ((s.risks || []).length)
    blocks.push({ t: 'table', cols: [{ w: 210 }, { w: 60 }, { w: 60 }, { w: 180 }], head: ['Was ist schiefgegangen?', 'Wahrsch.', 'Auswirk.', 'Gegenmaßnahme'], rows: s.risks.map((r) => [r.text, levelName(r.likelihood), levelName(r.impact), r.measure || '–']) });
  else blocks.push({ t: 'p', text: 'Kein Pre-Mortem für diese Option.' });
  const others = (dec.risks || []).filter((r) => r.optionId !== x.optionId && String(r.text || '').trim());
  if (others.length) {
    blocks.push({ t: 'h', text: 'Risiken der anderen Optionen' });
    others.forEach((r) => blocks.push({ t: 'p', text: `– ${nameOf(opts.find((o) => o.id === r.optionId))}: ${r.text} (Wahrsch. ${levelName(r.likelihood)}, Auswirkung ${levelName(r.impact)})` }));
  }
  blocks.push({ t: 'h', text: 'Verlauf' });
  (dec.history || []).forEach((h) => blocks.push({ t: 'small', text: `${new Date(h.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} – ${h.text}` }));
  const name = String(dec.question || 'Entscheidung').replace(/[^\wäöüÄÖÜß -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50);
  saveFile(`Entscheidung-${name}.pdf`, 'application/pdf', buildPdf(blocks, { title: `Entscheidung ${dec.question || ''}`, footer: `Hausakte · Entscheidung ${dec.question || ''}` }));
}
