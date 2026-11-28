// Decisions: a weighted decision matrix plus a pre-mortem, closed with a documented decision.
// A decision is a document of type "entscheidung" without a file; its data lives in doc.dec:
//   question, context, deadline, who
//   options   [{ id, name, note }]
//   criteria  [{ id, name, weight 1..5, note }]
//   scores    { [criterionId]: { [optionId]: 1..5 } }
//   risks     [{ id, optionId, text, likelihood 1..3, impact 1..3, measure }]   (pre-mortem)
//   decision  { optionId, rationale, by, date, next, snapshot }                  once decided
//   history   [{ at, text }]                                                     what happened when
import { getState, putDoc, updateDoc } from './store.js';
import { uid, todayISO } from './util.js';

export const isDecision = (d) => d?.type === 'entscheidung';
export const decOf = (d) => d?.dec || {};
export const decisions = (data = getState()) =>
  Object.values(data.documents || {})
    .filter(isDecision)
    .sort((a, b) => (decOf(b).updatedAt || 0) - (decOf(a).updatedAt || 0));

export const DEC_STATUS = {
  offen: { name: 'Offen', tone: 'warn' },
  entschieden: { name: 'Entschieden', tone: 'accent' },
};

export const WEIGHTS = [
  { value: 1, label: '1', title: 'unwichtig' },
  { value: 2, label: '2', title: 'weniger wichtig' },
  { value: 3, label: '3', title: 'wichtig' },
  { value: 4, label: '4', title: 'sehr wichtig' },
  { value: 5, label: '5', title: 'entscheidend' },
];
export const SCORES = [
  { value: 1, title: 'sehr schlecht' },
  { value: 2, title: 'schlecht' },
  { value: 3, title: 'mittel' },
  { value: 4, title: 'gut' },
  { value: 5, title: 'sehr gut' },
];
export const LEVELS = [
  { value: 1, name: 'gering' },
  { value: 2, name: 'mittel' },
  { value: 3, name: 'hoch' },
];
export const levelName = (v) => LEVELS.find((l) => l.value === v)?.name || '–';

// typical criteria for decisions about a house
export const CRITERIA_PRESETS = [
  'Anschaffungskosten',
  'Laufende Kosten',
  'Förderung',
  'Dauer / Zeitaufwand',
  'Komfort',
  'Optik',
  'Wertsteigerung',
  'Klimaschutz / CO₂',
  'Wartungsaufwand',
  'Eigenleistung möglich',
  'Verträglichkeit mit Altbau / Fachwerk',
  'Risiko / Unsicherheit',
];

const touch = (dec, text) => ({ ...dec, updatedAt: Date.now(), ...(text ? { history: [...(dec.history || []), { at: Date.now(), text }] } : {}) });

export function createDecision({ question = '', projectId = null } = {}) {
  const id = uid('d-');
  const q = String(question || '').trim();
  const dec = {
    question: q,
    context: '',
    deadline: null,
    who: '',
    status: 'offen',
    options: [],
    criteria: [],
    scores: {},
    risks: [],
    decision: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: [{ at: Date.now(), text: 'Entscheidung angelegt' }],
  };
  putDoc('documents', id, { id, type: 'entscheidung', noFile: true, name: q || 'Neue Entscheidung', date: todayISO(), projectId, notes: '', dec }, 50);
  return id;
}

export const setDec = (id, fn, delay = 300) =>
  updateDoc('documents', id, (d) => {
    const dec = typeof fn === 'function' ? fn(d.dec || {}) : { ...(d.dec || {}), ...fn };
    return { ...d, name: dec.question || 'Neue Entscheidung', dec: { ...dec, updatedAt: Date.now() } };
  }, delay);

// ---------- matrix ----------
// weighted result per option: points = sum(weight × score), share of the maximum, how many cells are rated
export function matrix(dec) {
  const opts = dec.options || [];
  const crits = (dec.criteria || []).filter((c) => String(c.name || '').trim());
  const maxPts = crits.reduce((s, c) => s + (c.weight || 3) * 5, 0);
  const rows = opts.map((o) => {
    let pts = 0,
      rated = 0;
    const per = {};
    for (const c of crits) {
      const v = dec.scores?.[c.id]?.[o.id];
      if (v) {
        pts += (c.weight || 3) * v;
        rated++;
        per[c.id] = v;
      }
    }
    return { option: o, pts, pct: maxPts ? (pts / maxPts) * 100 : 0, rated, per };
  });
  const ranked = [...rows].sort((a, b) => b.pts - a.pts);
  const cells = opts.length * crits.length;
  const done = rows.reduce((s, r) => s + r.rated, 0);
  const leader = ranked[0] && ranked[0].pts > 0 ? ranked[0] : null;
  const close = leader && ranked[1] && leader.pct - ranked[1].pct < 5;
  return { rows, ranked, maxPts, cells, done, complete: cells > 0 && done === cells, leader, close, criteria: crits };
}

// ---------- pre-mortem ----------
export const riskScore = (r) => (r.likelihood || 2) * (r.impact || 2);
export const riskTone = (r) => (riskScore(r) >= 6 ? 'danger' : riskScore(r) >= 3 ? 'warn' : 'neutral');
export function risksFor(dec, optionId) {
  return (dec.risks || []).filter((r) => String(r.text || '').trim() && (r.optionId || null) === (optionId || null));
}
export function riskSummary(dec, optionId) {
  const rs = risksFor(dec, optionId);
  return { count: rs.length, high: rs.filter((r) => riskScore(r) >= 6).length, open: rs.filter((r) => riskScore(r) >= 3 && !String(r.measure || '').trim()).length };
}

// ---------- the decision ----------
// what is still missing before deciding
export function readiness(dec) {
  const m = matrix(dec);
  const steps = [
    { key: 'frage', ok: !!String(dec.question || '').trim(), text: 'Frage formuliert' },
    { key: 'optionen', ok: (dec.options || []).filter((o) => String(o.name || '').trim()).length >= 2, text: 'mindestens zwei Optionen' },
    { key: 'kriterien', ok: m.criteria.length >= 2, text: 'mindestens zwei Kriterien' },
    { key: 'bewertung', ok: m.complete, text: m.cells ? `alle Felder bewertet (${m.done}/${m.cells})` : 'Matrix bewertet' },
    { key: 'premortem', ok: (dec.risks || []).some((r) => String(r.text || '').trim()), text: 'Pre-Mortem gemacht' },
  ];
  return { steps, ok: steps.every((s) => s.ok), m };
}

export function decide(id, { optionId, rationale, by, date, next }) {
  setDec(id, (dec) => {
    const m = matrix(dec);
    const opt = (dec.options || []).find((o) => o.id === optionId);
    const snapshot = {
      ranking: m.ranked.map((r) => ({ id: r.option.id, name: r.option.name, pts: r.pts, pct: Math.round(r.pct * 10) / 10 })),
      maxPts: m.maxPts,
      criteria: m.criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight || 3 })),
      followedMatrix: !!m.leader && m.leader.option.id === optionId,
      risks: risksFor(dec, optionId).map((r) => ({ text: r.text, likelihood: r.likelihood, impact: r.impact, measure: r.measure || '' })),
    };
    return touch(
      { ...dec, status: 'entschieden', decision: { optionId, optionName: opt?.name || '', rationale: String(rationale || '').trim(), by: String(by || '').trim(), date: date || todayISO(), next: String(next || '').trim(), at: Date.now(), snapshot } },
      `Entschieden für „${opt?.name || '?'}“${by ? ` (${by})` : ''}`,
    );
  }, 50);
}

// reopening keeps the earlier decision in the history
export function reopen(id, reason = '') {
  setDec(id, (dec) => touch({ ...dec, status: 'offen', earlier: [...(dec.earlier || []), dec.decision].filter(Boolean), decision: null }, `Wieder geöffnet${reason ? `: ${reason}` : ''}`), 50);
}

export const newOption = (name = '') => ({ id: uid('o'), name, note: '' });

// ---------- decisions taken elsewhere (in a meeting) ----------
// A decision that was already taken, e.g. recognised in a meeting note: stored as decided, without matrix and
// pre-mortem; source points back ({ kind: 'besprechung', projectId, meetingId, title, date }).
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();
export const isFromMeeting = (dec) => dec?.source?.kind === 'besprechung';
// in the order the meeting named them
export const meetingDecisions = (data, meetingId) =>
  decisions(data)
    .filter((d) => decOf(d).source?.meetingId === meetingId)
    .sort((a, b) => (decOf(a).createdAt || 0) - (decOf(b).createdAt || 0));

export function recordDecision({ question, choice, alternatives = [], reason = '', by = '', date, projectId = null, context = '', source = null, order = 0 }) {
  const q = String(question || '').trim().slice(0, 200);
  const c = String(choice || '').trim().slice(0, 200);
  if (!q || !c) return null;
  // the same decision of the same meeting is not stored twice (e.g. when a note is prepared again)
  if (source?.meetingId && meetingDecisions(getState(), source.meetingId).some((d) => norm(decOf(d).question) === norm(q) || norm(decOf(d).decision?.optionName) === norm(c))) return null;
  const id = uid('d-');
  const chosen = { ...newOption(c) };
  const others = [...new Set((alternatives || []).map((a) => String(a || '').trim().slice(0, 200)).filter((a) => a && norm(a) !== norm(c)))].slice(0, 5).map((a) => newOption(a));
  const now = Date.now() + order;
  const day = date || todayISO();
  const from = source?.kind === 'besprechung' ? `Aus der Besprechung „${source.title || 'Besprechung'}“ übernommen` : 'Entscheidung festgehalten';
  const dec = {
    question: q,
    context: String(context || '').trim().slice(0, 1500),
    deadline: null,
    who: String(by || '').trim().slice(0, 120),
    status: 'entschieden',
    options: [chosen, ...others],
    criteria: [],
    scores: {},
    risks: [],
    decision: { optionId: chosen.id, optionName: c, rationale: String(reason || '').trim().slice(0, 1500), by: String(by || '').trim().slice(0, 120), date: day, next: '', at: now, snapshot: { ranking: [], maxPts: 0, criteria: [], followedMatrix: false, risks: [] } },
    source,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, text: from }],
  };
  putDoc('documents', id, { id, type: 'entscheidung', noFile: true, name: q, date: day, projectId, notes: '', dec }, 50);
  return id;
}
export const newCriterion = (name = '', weight = 3) => ({ id: uid('c'), name, weight, note: '' });
export const newRisk = (optionId = null, text = '') => ({ id: uid('r'), optionId, text, likelihood: 2, impact: 2, measure: '' });
