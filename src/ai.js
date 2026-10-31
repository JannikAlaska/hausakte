// AI features via the viewer's Claude (the artifact `sample` capability).
// Every call sends the instruction, the relevant house data and the expected JSON shape.

import { FUNDING_KNOWLEDGE, gewerk, projectKind, status as statusOf, PROJECT_KINDS, medium, CONSTRAINT_KINDS, lineKind, fixtureKind } from './catalog.js';
import { pointInPoly } from './geometry.js';
import { roomOfPoint } from './planops.js';
import { furnLabel } from './furniture.js';
import { buildingStats, componentWear, projectCost, sortFloors, consumptionByYear, heatingIndex, roomArea, resolveRef } from './metrics.js';
import { bearingName } from './roof.js';
import { todayISO, fmtNum } from './util.js';
import { isSupabaseMode, makeSupaSample } from './supa.js';
import { fileUrl } from './store.js';

let samplePromise = null;
export function getSample() {
  if (!samplePromise && isSupabaseMode()) samplePromise = Promise.resolve(makeSupaSample());
  if (!samplePromise) {
    samplePromise =
      typeof window !== 'undefined' && window.claude?.use ? window.claude.use('sample').catch(() => null) : Promise.resolve(null);
  }
  return samplePromise;
}

let limitsPromise = null;
export function getLimits() {
  if (!limitsPromise) limitsPromise = getSample().then((s) => (s ? s.limits().catch(() => null) : null));
  return limitsPromise;
}

const ERR = {
  not_granted: 'Die KI ist für diese Seite nicht freigegeben. Erlaube „Claude verwenden“ in den Berechtigungen der Seite.',
  sampling_disabled: 'Für dein Konto ist die KI hier nicht verfügbar.',
  not_declared: 'Diese Version der Seite darf keine KI verwenden.',
  rate_limited: 'Gerade zu viele KI-Anfragen. Versuche es in ein paar Minuten noch einmal.',
  refused: 'Die KI hat die Anfrage abgelehnt. Formuliere sie anders.',
  invalid_json: 'Die Antwort kam unvollständig zurück. Versuche es noch einmal.',
  prompt_too_large: 'Zu viele Daten für eine Anfrage. Kürze Notizen oder frage gezielter.',
  session_expired: 'Deine Anmeldung ist abgelaufen. Lade die Seite neu und melde dich an.',
  empty_completion: 'Die KI hat keine Antwort geliefert. Versuche es noch einmal.',
  image_rejected: 'Das Bild konnte nicht verarbeitet werden. Verwende ein JPG oder PNG unter 20 MB.',
  images_unavailable: 'Bilder kann die KI in dieser Ansicht nicht lesen.',
  tools_unavailable: 'Aktionen kann die KI in dieser Ansicht nicht ausführen.',
  cancelled: 'Abgebrochen.',
  not_configured: 'Die KI ist noch nicht eingerichtet: Hinterlege deinen Anthropic-API-Schlüssel in Supabase unter Edge Functions → Secrets als ANTHROPIC_API_KEY.',
  overloaded: 'Die KI ist gerade überlastet. Versuche es in ein paar Minuten noch einmal.',
  not_member: 'Dein Konto gehört nicht zu dieser Hausakte.',
  file_missing: 'Die Datei ist noch nicht hochgeladen.',
  pdf_unsupported: 'PDFs kann die KI in dieser Ansicht nicht lesen. Öffne die Hausakte über deine eigene Adresse oder lade das Angebot als Foto hoch.',
  too_many_files: 'Vergleiche höchstens 5 Angebote auf einmal.',
};
export const aiErrorText = (e) => ERR[e?.code] || 'Die KI-Anfrage ist fehlgeschlagen. Versuche es später noch einmal.';
export const isHardAiError = (e) => ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(e?.code);

export const AI_DISCLAIMER =
  'KI-Hinweise beruhen auf einer Wissensbasis mit Stand Oktober 2026 und auf deinen Daten. Förderbedingungen ändern sich häufig – prüfe Beträge und Fristen vor jedem Antrag bei KfW, BAFA oder deiner Kommune.';

// ---------- context ----------
export function houseContext(d, { withProjects = true, withComponents = true, withConsumption = true, maxNotes = 220 } = {}) {
  const h = d.house || {};
  const floors = sortFloors(Object.values(d.floors || {}));
  const st = buildingStats(h, floors);
  const L = [];
  const yesNo = (v) => (v ? 'ja' : 'nein');
  L.push('HAUS');
  L.push(
    [
      `Bezeichnung: ${h.name || '–'}`,
      `Ort: ${[h.zip, h.city].filter(Boolean).join(' ') || 'unbekannt'}${h.state ? ', ' + h.state : ', Bundesland unbekannt'}`,
      `Baujahr: ${h.buildYear || 'unbekannt'}`,
      `Kaufdatum: ${h.purchaseDate || 'unbekannt'}`,
      `Typ: ${h.houseType || '–'}`,
      `Bauweise: ${h.construction || '–'}`,
      `Wohneinheiten: ${h.units || 1}`,
      `Personen im Haushalt: ${h.persons || 'unbekannt'}`,
      `Selbstgenutzt: ${yesNo(h.selfUse !== false)}`,
      `Denkmalschutz: ${yesNo(h.heritage)}`,
      h.energyCert?.cls || h.energyCert?.value ? `Energieausweis: ${h.energyCert.kind || ''} Klasse ${h.energyCert.cls || '?'}, ${h.energyCert.value || '?'} kWh/m²a` : 'Energieausweis: keiner hinterlegt',
      h.householdIncome ? `Zu versteuerndes Haushaltseinkommen: ca. ${fmtNum(h.householdIncome, 0)} €` : null,
    ]
      .filter(Boolean)
      .join('; '),
  );
  L.push('');
  L.push('KENNWERTE (aus dem 3D-Modell berechnet, Näherung)');
  L.push(
    `Wohnfläche ca. ${fmtNum(st.living, 0)} m²; Nutzfläche gesamt ${fmtNum(st.usable, 0)} m²; Bruttogrundfläche ${fmtNum(st.gross, 0)} m²; Fassade opak ${fmtNum(st.facadeOpaque, 0)} m²; Fenster/Türen ${fmtNum(st.windowArea, 1)} m² (${st.windows} Fenster); Dachfläche ${fmtNum(st.roofArea, 0)} m²`,
  );
  for (const p of st.pv)
    L.push(
      `Dachfläche ${p.azimuth != null ? bearingName(p.azimuth) : 'flach'} ${fmtNum(p.tilt, 0)}°: ${fmtNum(p.area, 1)} m², Platz für ca. ${p.modules} PV-Module (${fmtNum(p.kwp, 1)} kWp, ca. ${fmtNum(p.kwhYear, 0)} kWh/a)`,
    );
  L.push('');
  L.push('GESCHOSSE');
  for (const f of floors) {
    const rooms = (f.rooms || []).map((r) => `${r.name} ${fmtNum(roomArea(r), 1)} m²`).join(', ');
    L.push(`${f.short || ''} ${f.name} (OKFF ${fmtNum(f.elevation, 2)} m, Geschosshöhe ${fmtNum(f.height, 2)} m${f.underRoof ? ', Dachgeschoss' : ''}): ${rooms || 'keine Räume'}`);
  }
  const lineInfo = [];
  for (const f of floors)
    for (const l of (f.lines || []).filter((x) => !x.auto)) {
      let len = 0;
      for (let i = 1; i < (l.pts || []).length; i++) len += Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1], (l.pts[i][2] ?? 0) - (l.pts[i - 1][2] ?? 0));
      lineInfo.push(`- ${f.short || f.name}: ${lineKind(l.kind).name}${l.riser ? ' (Steigleitung)' : ''}${l.label ? ` „${l.label}“` : ''}, ${fmtNum(len, 1)} m, ${l.status || 'bestand'}${l.notes ? `, ${String(l.notes).slice(0, 120)}` : ''}`);
    }
  if (lineInfo.length) {
    L.push('');
    L.push('EINGEZEICHNETE LEITUNGEN');
    L.push(...lineInfo.slice(0, 40));
  }
  // furniture per floor and room, so questions like "passt ein 2-m-Sofa ins Wohnzimmer?" can be answered
  const furnInfo = [];
  for (const f of [...floors, ...(h.model?.context || []).filter((b) => b.kind !== 'neighbor')]) {
    const byRoom = new Map();
    for (const x of f.furniture || []) {
      const r = roomOfPoint(f, { x: x.x, y: x.y });
      const k = r?.name || 'ohne Raum/außen';
      if (!byRoom.has(k)) byRoom.set(k, []);
      byRoom.get(k).push(`${furnLabel(x)}${x.status === 'geplant' ? ' (geplant)' : ''}`);
    }
    for (const [room, items] of byRoom) furnInfo.push(`- ${f.short || f.name}, ${room}: ${items.join(', ')}`);
  }
  if (furnInfo.length) {
    L.push('');
    L.push('MÖBEL (im Grundriss eingerichtet)');
    L.push(...furnInfo.slice(0, 40));
  }
  const outb = (h.model?.context || []).filter((b) => b.kind !== 'neighbor');
  if (outb.length) {
    L.push('');
    L.push('NEBENGEBÄUDE');
    for (const b of outb) {
      const rooms = (b.rooms || []).map((r) => `${r.name} ${fmtNum(roomArea(r), 1)} m²`).join(', ');
      const fx = (b.points || []).map((q) => `${q.count > 1 ? q.count + '× ' : ''}${fixtureKind(q.kind).name}`).join(', ');
      L.push(`- ${b.name || 'Nebengebäude'}: ${fmtNum(b.w, 1)} × ${fmtNum(b.d, 1)} m, Wandhöhe ${fmtNum(b.h ?? 2.4, 1)} m${b.open ? ', offen' : ''}${rooms ? `; Räume: ${rooms}` : ''}${(b.lines || []).length ? `; ${b.lines.length} Leitungen (${[...new Set(b.lines.map((l) => lineKind(l.kind).name))].join(', ')})` : ''}${fx ? `; Anschlüsse: ${fx}` : ''}${b.notes ? `; Notiz: ${String(b.notes).slice(0, 160)}` : ''}`);
    }
  }
  const dimInfo = [];
  for (const f of floors)
    for (const d of f.dims || []) {
      const m = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
      const rm = (f.rooms || []).find((r) => r.poly?.length && pointInPoly(m, r.poly));
      dimInfo.push(`- ${f.short || f.name}${rm ? ' ' + rm.name : ''}: ${d.label || 'Maß'} ${fmtNum(d.value ?? Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]), 2)} m${d.value != null ? ' (vor Ort gemessen)' : ''}`);
    }
  if (dimInfo.length) {
    L.push('');
    L.push('EINGETRAGENE MASSE');
    L.push(...dimInfo.slice(0, 40));
  }
  const fixInfo = [];
  for (const f of floors) {
    const by = new Map();
    for (const q of f.points || []) {
      const rm = (f.rooms || []).find((r) => {
        const a = ((q.rot ?? 0) * Math.PI) / 180;
        const pt = q.rot == null ? [q.x, q.y] : [q.x + Math.cos(a) * 0.08, q.y + Math.sin(a) * 0.08];
        return r.poly?.length && pointInPoly(pt, r.poly);
      });
      const key = rm?.name || 'ohne Raum';
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(`${q.count > 1 ? q.count + '× ' : ''}${fixtureKind(q.kind).name}${q.label ? ` „${q.label}“` : ''}${q.status && q.status !== 'bestand' ? ` (${q.status})` : ''}`);
    }
    for (const [room, items] of by) fixInfo.push(`- ${f.short || f.name} ${room}: ${items.join(', ')}`);
  }
  if (fixInfo.length) {
    L.push('');
    L.push('ANSCHLÜSSE (Steckdosen, Schalter, Lampen, Netzwerk, Wasser, Gas)');
    L.push(...fixInfo.slice(0, 50));
  }
  if (withComponents) {
    L.push('');
    L.push('BAUTEILE');
    const comps = Object.values(d.components || {});
    if (!comps.length) L.push('keine erfasst');
    for (const c of comps) {
      const w = componentWear(c);
      L.push(
        `- [${c.id}] ${gewerk(c.gewerk).name} / ${c.name}: ${c.material || 'Material unbekannt'}${c.year ? `, eingebaut/zuletzt erneuert ${c.year} (Alter ${w.age} J.)` : ', Jahr unbekannt'}${c.life ? `, übliche Nutzungsdauer ${c.life} J.` : ''}${c.condition ? `, Zustand ${c.condition}/5` : ''}${c.uValue ? `, U-Wert ${c.uValue}` : ''}${c.notes ? `, Notiz: ${String(c.notes).slice(0, maxNotes)}` : ''}`,
      );
    }
  }
  if (withConsumption) {
    L.push('');
    L.push('VERBRAUCH');
    const years = consumptionByYear(Object.values(d.readings || {}));
    const ys = Object.keys(years).sort().slice(-4);
    if (!ys.length) L.push('keine Werte erfasst');
    for (const y of ys)
      L.push(
        `${y}: ` +
          Object.entries(years[y])
            .map(([k, v]) => `${medium(k).name} ${fmtNum(v.amount, 0)} ${medium(k).unit}${v.cost ? ` (${fmtNum(v.cost, 0)} €)` : ''}`)
            .join(', '),
      );
    const hi = heatingIndex(Object.values(d.readings || {}), st.living);
    if (hi.last?.perM2) L.push(`Heizenergie ${hi.last.year}: ca. ${fmtNum(hi.last.perM2, 0)} kWh/m²a (Klasse ${hi.cls?.c})`);
  }
  const notes = Object.values(d.notes || {}).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (notes.length) {
    L.push('');
    L.push('NOTIZEN (allgemein, ohne Projekt)');
    for (const n of notes.slice(0, 30)) L.push(`- [${n.id}] ${n.date} ${n.title}: ${String(n.text || '').replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  const contacts = Object.values(d.contacts || {});
  if (contacts.length) {
    L.push('');
    L.push('KONTAKTE');
    for (const c of contacts.slice(0, 60)) L.push(`- ${contactLine(c)}${c.phone || c.mobile ? ` · Tel. ${c.phone || c.mobile}` : ''}${c.email ? ` · ${c.email}` : ''}`);
  }
  if (withProjects) {
    L.push('');
    L.push('PROJEKTE');
    const projects = Object.values(d.projects || {}).filter((p) => !p.archived);
    const archived = Object.values(d.projects || {}).filter((p) => p.archived);
    if (!projects.length) L.push('keine');
    for (const p of projects) {
      const c = projectCost(p);
      L.push(
        `- [${p.id}] ${p.title} (${projectKind(p.kind).name}), Status ${statusOf(p.status).name}, ${p.start || '?'} bis ${p.end || '?'}, Kosten ca. ${fmtNum(c.best, 0)} €${(p.dependsOn || []).length ? `, startet erst nach ${p.dependsOn.join(', ')}` : ''}${(p.funding || []).length ? `, Förderung: ${p.funding.map((f) => `${f.program} (${f.status})`).join('; ')}` : ''}`,
      );
      if (p.hints?.trim()) L.push(`  Hinweise: ${String(p.hints).replace(/\s+/g, ' ').slice(0, 300)}`);
      for (const m of p.milestones || [])
        L.push(`  Meilenstein [${p.id}#${m.id}] ${m.title}: ${m.date || 'ohne Datum'}${m.done ? ', erledigt' : ''}${(m.dependsOn || []).length ? `, erst nach ${m.dependsOn.join(', ')}` : ''}`);
    }
    if (archived.length) L.push(`Deaktivierte Projekte (nicht geplant, nicht im Budget): ${archived.map((p) => `[${p.id}] ${p.title}`).join('; ')}`);
    if (projects.length) L.push('Abhängigkeiten verweisen auf eine Projekt-ID (= nach Projektende) oder auf „Projekt-ID#Meilenstein-ID“ (= nach diesem Meilenstein).');
  }
  L.push('');
  L.push(`HEUTE: ${todayISO()}`);
  return L.join('\n');
}

function depName(d, ref) {
  const r = resolveRef(d.projects || {}, ref);
  return r ? (r.kind === 'milestone' ? `Meilenstein „${r.title}“ von „${r.project.title}“ (${r.date || 'ohne Datum'})` : `Ende von „${r.title}“ (${r.date || 'offen'})`) : ref;
}

function projectBlock(p, d) {
  const c = projectCost(p);
  const lines = [
    `Titel: ${p.title}`,
    `Art: ${projectKind(p.kind).name}`,
    `Status: ${statusOf(p.status).name}`,
    `Zeitraum: ${p.start || 'offen'} bis ${p.end || 'offen'}`,
    `Priorität: ${p.priority || 2} (1 = hoch)`,
    `Kostenpositionen: ${(p.costs || []).map((k) => `${k.label} ${fmtNum(k.actual ?? k.offer ?? k.estimate, 0)} €`).join('; ') || 'keine'}`,
    `Summe ca. ${fmtNum(c.best, 0)} €`,
    `Rahmenbedingungen: ${(p.constraints || []).map((k) => k.text).join('; ') || 'keine'}`,
    `Bereits erfasste Förderung: ${(p.funding || []).map((f) => `${f.program} (${f.provider}, ${f.status})`).join('; ') || 'keine'}`,
    `Startet erst nach: ${(p.dependsOn || []).map((r) => depName(d, r)).join('; ') || 'keine Abhängigkeit'}`,
    `Meilensteine: ${(p.milestones || []).map((m) => `${m.title} ${m.date || 'ohne Datum'}${m.done ? ' (erledigt)' : ''}${(m.dependsOn || []).length ? ` – erst nach ${m.dependsOn.map((r) => depName(d, r)).join(', ')}` : ''}`).join('; ') || 'keine'}`,
    `Hinweise: ${p.hints?.trim() || '–'}`,
    `Offene Aufgaben: ${(p.constraints || []).filter((c) => !c.done).map((c) => `${c.text}${c.due ? ` (bis ${c.due})` : ''}${c.who ? ` [${c.who}]` : ''}`).join('; ') || 'keine'}`,
    `Besprechungen: ${(p.meetings || []).slice(0, 5).map((m) => `${m.date} ${m.title}: ${String(m.summary || '').slice(0, 300)}`).join(' | ') || 'keine'}`,
    `Verknüpfte Bauteile: ${(p.components || []).map((id) => d.components?.[id]?.name).filter(Boolean).join('; ') || 'keine'}`,
    `Notizen: ${p.notes || '–'}`,
  ];
  return lines.join('\n');
}

const JSON_RULES = 'Antworte ausschließlich mit gültigem JSON ohne Erklärtext. Datumswerte im Format YYYY-MM-DD. Beträge als Zahl in Euro ohne Tausenderpunkte.';

async function askJSON(prompt, opts = {}) {
  const sample = await getSample();
  if (!sample) throw { code: 'not_granted', message: 'sample unavailable' };
  return sample.json(prompt, { modelTier: opts.tier || 'default', signal: opts.signal, onText: opts.onText, cache: opts.cache ?? false, ...(opts.web ? { web: true } : {}) });
}

// ---------- project analyses ----------
export async function aiFunding(p, d, opts) {
  const prompt = `Du bist unabhängiger Energieberater und Fördermittelexperte für private Wohngebäude in Deutschland.
Aufgabe: Finde für die unten beschriebene Modernisierungsmaßnahme alle sinnvollen Förderungen (Bund, Land, Kommune, Steuer, Einspeisevergütung, zinsgünstige Kredite) und bestimme den besten Zeitpunkt für jeden Antrag.
Regeln:
- Stütze dich auf die WISSENSBASIS. Was dort nicht steht, kennzeichne mit confidence "niedrig" und empfiehl eine Prüfung.
- Rechne geschätzte Förderbeträge aus den Projektkosten und den förderfähigen Höchstgrenzen.
- Beachte: Anträge bei KfW/BAFA vor Auftragsvergabe bzw. Vorhabenbeginn. Setze applyBy so, dass vor dem Projektstart genug Vorlauf bleibt (Energieberater-Termin, Bearbeitungszeit). Wenn sich Fördersätze bald verschlechtern, sag das und nenne das Datum.
- Nenne Kombinationsverbote (z. B. § 35c EStG vs. BEG) und welche Variante günstiger ist.
- Wenn das Bundesland unbekannt ist, weise darauf hin, dass regionale Programme fehlen könnten.
- Prüfe auch gesetzliche Pflichten oder Fristen (z. B. Nachrüstpflichten nach dem Hauskauf), die den Zeitpunkt beeinflussen.

WISSENSBASIS
${FUNDING_KNOWLEDGE}

MASSNAHME
${projectBlock(p, d)}

HAUSDATEN
${houseContext(d, { withProjects: false, withConsumption: false })}

${JSON_RULES}
Format:
{"summary":"2-3 Sätze Fazit","programs":[{"name":"Programmname","provider":"KfW|BAFA|Finanzamt|Netzbetreiber|Land|Kommune|sonstige","type":"zuschuss|kredit|steuer|verguetung|sonstiges","rate":15,"amount":4500,"conditions":["Bedingung"],"applyBy":"2026-12-01","timing":"Wann und wie beantragen (1 Satz)","combinable":"Kombinierbarkeit (1 Satz)","confidence":"hoch|mittel|niedrig","url":"https://... oder null"}],"bestTiming":{"recommendation":"Konkrete Empfehlung","applyBy":"YYYY-MM-DD oder null","reasons":["Grund"]},"steps":[{"title":"Schritt","date":"YYYY-MM-DD oder null"}],"warnings":["Warnung"]}`;
  return askJSON(prompt, opts);
}

export async function aiTiming(p, d, opts) {
  const others = Object.values(d.projects || {})
    .filter((x) => x.id !== p.id && !x.archived)
    .map((x) => `- [${x.id}] ${x.title} (${projectKind(x.kind).name}, ${statusOf(x.status).name}, ${x.start || '?'} bis ${x.end || '?'})${(x.milestones || []).length ? `; Meilensteine: ${x.milestones.map((m) => `${m.title} ${m.date || 'ohne Datum'}`).join(', ')}` : ''}`)
    .join('\n');
  const prompt = `Du bist Bauleiter und planst Modernisierungen an einem bewohnten Einfamilienhaus in Deutschland.
Aufgabe: Schlage für die Maßnahme einen realistischen Zeitraum vor und prüfe Abhängigkeiten zu den anderen Projekten.
Berücksichtige: Jahreszeit und Witterung (Dach, Fassade, Außenarbeiten), typische Vorlaufzeiten von Handwerkern, Lieferzeiten, Förderanträge vor Auftragsvergabe, sinnvolle Reihenfolge der Gewerke (z. B. Elektrik vor PV/Wärmepumpe, Dach vor PV, Hülle vor Heizungsauslegung), Heizperiode bei Heizungstausch, gesetzliche Fristen.
Gib Abhängigkeiten nur zu den aufgeführten Projekten an (ihre IDs in eckigen Klammern).

MASSNAHME
${projectBlock(p, d)}

ANDERE PROJEKTE
${others || 'keine'}

HAUS
${houseContext(d, { withProjects: false, withConsumption: false, withComponents: true })}

${JSON_RULES}
Format:
{"summary":"Fazit in 2 Sätzen","start":"YYYY-MM-DD","end":"YYYY-MM-DD","season":"Begründung Jahreszeit","leadTimeWeeks":8,"reasons":["Grund"],"dependencies":[{"projectId":"ID","type":"vorher|nachher|gleichzeitig","reason":"Warum"}],"milestones":[{"title":"Meilenstein","date":"YYYY-MM-DD"}],"hints":"Wichtige Hinweise zu Abhängigkeiten und Fristen für das Feld Hinweise (1–3 kurze Sätze)","warnings":["Hinweis"]}`;
  return askJSON(prompt, opts);
}

export async function aiCosts(p, d, opts) {
  const prompt = `Du bist Kostenplaner für Sanierungen von Wohngebäuden in Deutschland (Preisstand 2026, inkl. MwSt.).
Aufgabe: Schätze die Kosten der Maßnahme als Positionen mit Spanne. Nutze die Maße aus dem 3D-Modell (Flächen, Fensteranzahl, Dachflächen, Wohnfläche). Nenne Annahmen.

MASSNAHME
${projectBlock(p, d)}

HAUS
${houseContext(d, { withProjects: false, withConsumption: false })}

${JSON_RULES}
Format:
{"summary":"Fazit","items":[{"label":"Position","low":1000,"high":1500,"note":"Menge/Annahme"}],"totalLow":10000,"totalHigh":15000,"assumptions":["Annahme"]}`;
  return askJSON(prompt, opts);
}

export async function aiRisks(p, d, opts) {
  const kinds = CONSTRAINT_KINDS.map((k) => k.key).join('|');
  const prompt = `Du bist Sachverständiger für Altbausanierung in Deutschland.
Aufgabe: Nenne für die Maßnahme die wichtigsten Rahmenbedingungen (Genehmigungen, gesetzliche Pflichten nach GModG/GEG, Statik, Schadstoffe wie Asbest je nach Baujahr, Brandschutz, Nachbarrecht, Netzbetreiber, Wetter, Bewohnbarkeit während der Bauzeit) und Risiken.

MASSNAHME
${projectBlock(p, d)}

HAUS
${houseContext(d, { withProjects: false, withConsumption: false })}

WISSENSBASIS
${FUNDING_KNOWLEDGE}

${JSON_RULES}
Format:
{"summary":"Fazit","constraints":[{"text":"Rahmenbedingung als Aufgabe formuliert","kind":"${kinds}"}],"risks":[{"text":"Risiko","mitigation":"Gegenmaßnahme"}],"checks":["Vorab prüfen"]}`;
  return askJSON(prompt, opts);
}

// ---------- house-wide analyses ----------
export async function aiRoadmap(d, opts) {
  const kinds = PROJECT_KINDS.map((k) => k.key).join('|');
  const prompt = `Du bist Energieberater und erstellst für ein frisch gekauftes Bestandsgebäude einen Sanierungsfahrplan (ähnlich iSFP) für die nächsten 2–6 Jahre.
Aufgabe: Leite aus Baujahr, Bauteilen (Alter vs. Nutzungsdauer, Zustand), Verbrauch und bestehenden Projekten die sinnvollen Maßnahmen ab. Ordne sie technisch sinnvoll (Hülle vor Heizungsauslegung, Elektrik vor PV/Wärmepumpe, Dach vor PV, Gerüst gemeinsam nutzen), berücksichtige Nachrüstpflichten nach dem Kauf, Förderfristen (z. B. sinkender Klimabonus) und Jahreszeiten.
Bestehende Projekte nicht doppelt vorschlagen; verweise stattdessen über existingProjectId.
Wirtschaftlichkeit: Schätze für jede Maßnahme die Amortisationszeit (Netto-Investition nach Förderung ÷ jährliche Ersparnis, Energiepreise +3 %/a) und vergleiche sie mit der Lebensdauer (Dämmung ca. 40 Jahre, Fenster 30, Wärmepumpe 20, PV 25, Speicher 15, Elektrik 40). verdict: "wirtschaftlich" wenn die Amortisation höchstens die halbe Lebensdauer beträgt, "grenzwertig" bis zur Lebensdauer, sonst "unwirtschaftlich"; bei Pflichtmaßnahmen, Sicherheit oder ohnehin fälligem Ersatz "notwendig". Sowieso-Kosten (z. B. Putz muss ohnehin erneuert werden) mindern die Investition.

WISSENSBASIS
${FUNDING_KNOWLEDGE}

HAUS
${houseContext(d)}

${JSON_RULES}
Format:
{"summary":"Fazit in 3 Sätzen","measures":[{"key":"m1","title":"Maßnahme","kind":"${kinds}","priority":1,"start":"YYYY-MM-DD","end":"YYYY-MM-DD","costLow":10000,"costHigh":15000,"fundingHint":"Passende Förderung + Antragszeitpunkt","saving":"z. B. 600–900 €/Jahr oder null","payback":"z. B. 12–16 Jahre oder null","verdict":"wirtschaftlich|grenzwertig|unwirtschaftlich|notwendig","dependsOn":["m0"],"reason":"Warum und warum jetzt","existingProjectId":null}]}`;
  return askJSON(prompt, { tier: 'complex', ...opts });
}

export async function aiComponents(d, opts) {
  const prompt = `Du bist Gebäudegutachter. Bewerte die erfassten Bauteile des Hauses: Wo besteht Erneuerungsbedarf, was ist gesetzlich vorgeschrieben (z. B. Nachrüstpflichten nach Eigentümerwechsel), was sollte geprüft werden (Schadstoffe nach Baujahr)? Fehlen wichtige Bauteile in der Erfassung, nenne sie.

HAUS
${houseContext(d, { withProjects: true, withConsumption: true })}

WISSENSBASIS
${FUNDING_KNOWLEDGE}

${JSON_RULES}
Format:
{"summary":"Fazit","items":[{"componentId":"ID aus eckigen Klammern","urgency":"hoch|mittel|niedrig","action":"Empfohlene Maßnahme","byYear":2027,"reason":"Begründung"}],"missing":["Bauteil, das erfasst werden sollte"]}`;
  return askJSON(prompt, opts);
}

export async function aiConsumption(d, opts) {
  const prompt = `Du bist Energieberater. Analysiere die Verbrauchswerte des Hauses im Verhältnis zu Wohnfläche, Baujahr, Bauteilen und Haushaltsgröße. Vergleiche mit typischen Werten, nenne Auffälligkeiten und konkrete Einsparmaßnahmen mit grober Ersparnis pro Jahr, Kosten und Amortisation.
Wirtschaftlichkeit: Schätze für jede Maßnahme die Amortisationszeit (Netto-Investition nach Förderung ÷ jährliche Ersparnis, Energiepreise +3 %/a) und vergleiche sie mit der Lebensdauer (Dämmung ca. 40 Jahre, Fenster 30, Wärmepumpe 20, PV 25, Speicher 15, Elektrik 40). verdict: "wirtschaftlich" wenn die Amortisation höchstens die halbe Lebensdauer beträgt, "grenzwertig" bis zur Lebensdauer, sonst "unwirtschaftlich"; bei Pflichtmaßnahmen, Sicherheit oder ohnehin fälligem Ersatz "notwendig". Sowieso-Kosten (z. B. Putz muss ohnehin erneuert werden) mindern die Investition.

HAUS
${houseContext(d)}

${JSON_RULES}
Format:
{"summary":"Fazit","benchmark":"Einordnung gegenüber Vergleichswerten","findings":["Auffälligkeit"],"tips":[{"title":"Maßnahme","saving":"z. B. 300–500 €/Jahr","effort":"gering|mittel|hoch","cost":"z. B. 2.000–3.000 € oder 0","payback":"z. B. 5–7 Jahre oder sofort","verdict":"wirtschaftlich|grenzwertig|unwirtschaftlich"}]}`;
  return askJSON(prompt, opts);
}

// ---------- meeting notes from a voice memo ----------
export async function aiMeeting(p, transcript, d, { date, signal } = {}) {
  const ms = (p.milestones || []).map((m) => `- ${m.title} (${m.date || 'ohne Datum'}${m.done ? ', erledigt' : ''})`).join('\n') || 'keine';
  const todos = (p.constraints || []).filter((c) => !c.done).map((c) => `- ${c.text}${c.due ? ` (bis ${c.due})` : ''}`).join('\n') || 'keine';
  const contacts = Object.values(d.contacts || {});
  const prompt = `Du hilfst bei der Modernisierung eines Wohnhauses. Aus einer gesprochenen Notiz zu einem Termin oder Gespräch im Projekt erstellst du eine knappe Besprechungsnotiz und leitest Termine und Aufgaben ab.
Die Notiz wurde automatisch aus Sprache in Text umgewandelt und kann Erkennungsfehler enthalten – korrigiere offensichtlich falsch erkannte Fachbegriffe (z. B. „Wechsel Richter“ = Wechselrichter, „Zähler Schrank“ = Zählerschrank).
Datum der Besprechung: ${date || todayISO()} (heute ist ${todayISO()}). Rechne relative Angaben wie „nächsten Dienstag“, „in zwei Wochen“ oder „Ende November“ von diesem Datum aus in YYYY-MM-DD um.
Termine (appointments) nur, wenn ein Zeitpunkt genannt oder klar ableitbar ist (z. B. Montage, Zählerwechsel, Besichtigung, Abnahme, Rückruf, Angebotsfrist); Uhrzeit, falls genannt.
Aufgaben (todos) sind konkrete nächste Schritte mit Verantwortlichem (who: „ich“ für den Eigentümer oder Firma/Person) und Fälligkeit, wenn erkennbar.
Erfinde nichts; Unklares gehört in openQuestions. Lege nichts doppelt an, was schon unten steht. Genannte Preise oder Angebotssummen in costs (Euro brutto).

PROJEKT
${projectBlock(p, d)}

VORHANDENE MEILENSTEINE
${ms}

OFFENE AUFGABEN
${todos}

BEKANNTE KONTAKTE (ordne Teilnehmer und Zuständige über die ID zu, wenn eindeutig)
${contacts.map(contactLine).join('\n') || 'keine'}

GESPROCHENE NOTIZ
"""${String(transcript).slice(0, 40000)}"""

${JSON_RULES}
Format:
{"title":"Kurzer Titel, z. B. Vor-Ort-Termin Elektriker PV","date":"YYYY-MM-DD","participants":["Person oder Firma"],"contactIds":["Kontakt-ID der Teilnehmer"],"summary":"2–4 Sätze","points":["Besprochener Punkt"],"decisions":["Entscheidung oder Vereinbarung"],"openQuestions":["Offene Frage"],"appointments":[{"title":"Termin","date":"YYYY-MM-DD","time":"HH:MM oder null","note":"kurz"}],"todos":[{"text":"Was ist zu tun","who":"ich|Firma|Person","contactId":"Kontakt-ID oder null","due":"YYYY-MM-DD oder null","kind":"${CONSTRAINT_KINDS.map((k) => k.key).join('|')}"}],"costs":[{"label":"Position","amount":1234}]}`;
  return askJSON(prompt, { signal });
}

// ---------- heat load / heat pump ----------
export async function aiHeat(d, res, after, measures, opts) {
  const f1 = (v) => fmtNum(v, 1);
  const rows = res.surfaces.map((x) => `- ${x.label}: ${f1(x.area)} m², U ${fmtNum(x.u, 2)} W/m²K, Faktor ${fmtNum(x.b, 2)} → ${fmtNum(x.H * res.dT, 0)} W`).join('\n');
  const prompt = `Du bist unabhängiger Energieberater (Gebäudeenergieberater, BAFA-gelistet) für private Wohngebäude in Deutschland.
Ordne die vereinfachte Heizlast-Schätzung aus dem 3D-Modell der App ein und berate zur geplanten Wärmepumpe. Sei konkret, nenne Zahlen und weise auf Unsicherheiten hin. Ersetzt keine Heizlastberechnung nach DIN EN 12831 – sag, wann eine nötig ist (für die Förderung ist sie Pflicht).
Wirtschaftlichkeit: Schätze für jede Maßnahme die Amortisationszeit (Netto-Investition nach Förderung ÷ jährliche Ersparnis, Energiepreise +3 %/a) und vergleiche sie mit der Lebensdauer (Dämmung ca. 40 Jahre, Fenster 30, Wärmepumpe 20, PV 25, Speicher 15, Elektrik 40). verdict: "wirtschaftlich" wenn die Amortisation höchstens die halbe Lebensdauer beträgt, "grenzwertig" bis zur Lebensdauer, sonst "unwirtschaftlich"; bei Pflichtmaßnahmen, Sicherheit oder ohnehin fälligem Ersatz "notwendig". Sowieso-Kosten (z. B. Putz muss ohnehin erneuert werden) mindern die Investition.

WISSENSBASIS FÖRDERUNG
${FUNDING_KNOWLEDGE}

HAUS
${houseContext(d, { withConsumption: true })}

SCHÄTZUNG AUS DEM MODELL
Beheizte Etagen: ${res.heated.map((x) => x.short || x.name).join(', ')}; beheizte Fläche ca. ${f1(res.netArea)} m², Volumen ${fmtNum(res.volume, 0)} m³
Innentemperatur ${res.cfg.tIn} °C, Norm-Außentemperatur ${res.cfg.tOut} °C, Luftwechsel ${res.cfg.ach}/h
Wärmeverluste:
${rows}
- Wärmebrücken-Zuschlag: ${fmtNum(res.bridges * res.dT, 0)} W
- Lüftung: ${fmtNum(res.HV * res.dT, 0)} W
Heizlast ca. ${f1(res.loadKw)} kW (${fmtNum(res.perM2, 0)} W/m²), Heizwärmebedarf ca. ${fmtNum(res.heatKwh, 0)} kWh/a, Warmwasser ${fmtNum(res.wwKwh, 0)} kWh/a (${res.persons} Personen)
Heizflächen: ${res.emitter.name} (Vorlauf ca. ${res.emitter.flow} °C, angenommene JAZ ${res.emitter.jaz})
Wärmepumpe rechnerisch ca. ${res.hpSize} kW. Kosten/Jahr: Öl ca. ${fmtNum(res.oil.cost, 0)} € (${fmtNum(res.oil.liters, 0)} l), Wärmepumpe ca. ${fmtNum(res.hp.cost, 0)} € (${fmtNum(res.hp.kwh, 0)} kWh Strom)
${res.actual ? `Tatsächlicher Ölverbrauch ${res.actual.year}: ${fmtNum(res.actual.liters, 0)} l → Heizlast nach Verbrauch ca. ${f1(res.actual.loadKw)} kW` : 'Kein Ölverbrauch erfasst.'}
${measures.length ? `Ausgewählte Maßnahmen: ${measures.map((m) => m.label).join('; ')} → Heizlast danach ca. ${f1(after.loadKw)} kW, Wärmepumpe ca. ${after.hpSize} kW, WP-Kosten ca. ${fmtNum(after.hp.cost, 0)} €/a` : 'Keine Maßnahmen ausgewählt.'}

${JSON_RULES}
Format:
{"summary":"Fazit in 2–3 Sätzen","plausibility":"Wie belastbar ist die Schätzung, was ist unsicher (z. B. U-Werte, Fachwerk)","hpFit":{"verdict":"gut|bedingt|kritisch","reason":"Eignung für eine Luft-Wasser-Wärmepumpe, Vorlauftemperatur, Heizkörper"},"sizing":"Empfohlene Leistung und warum (inkl. Warmwasser, Sperrzeiten, Bivalenz)","steps":[{"title":"Schritt","why":"Begründung","when":"vor/mit/nach Wärmepumpe","payback":"z. B. 15–20 Jahre oder null","verdict":"wirtschaftlich|grenzwertig|unwirtschaftlich|notwendig"}],"funding":[{"program":"Programm","amount":"Betrag oder Quote","note":"Bedingung, z. B. Antrag vor Auftrag"}],"warnings":["Hinweis"]}`;
  return askJSON(prompt, { tier: 'complex', ...opts });
}

// ---------- offer comparison ----------
export async function aiCompareOffers(p, docs, d, opts = {}) {
  const sample = await getSample();
  if (!sample) throw { code: 'not_granted' };
  const lim = await getLimits();
  const canPdf = !!lim?.images?.mediaTypes?.includes('application/pdf');
  const files = [];
  const parts = [];
  for (const doc of docs) {
    const ex = doc.ai?.data;
    if (ex && ((ex.items || []).length || ex.total)) {
      parts.push(
        `ANGEBOT [${doc.id}] „${doc.name}“ (bereits ausgelesen): Firma ${ex.vendor || 'unbekannt'}, Datum ${ex.date || 'unbekannt'}, Summe ${ex.total ?? 'unbekannt'} €. Positionen: ${(ex.items || []).map((i) => `${i.label}: ${i.amount} €`).join('; ') || 'keine'}. ${ex.summary || ''}`,
      );
      continue;
    }
    const url = fileUrl(doc);
    if (!url) throw { code: 'file_missing' };
    const isPdf = /pdf/i.test(doc.contentType || doc.name || '');
    if (isPdf && !canPdf) throw { code: 'pdf_unsupported' };
    if (!lim?.images) throw { code: 'images_unavailable' };
    files.push(await (await fetch(url)).blob());
    parts.push(`ANGEBOT [${doc.id}] „${doc.name}“: Datei Nr. ${files.length} im Anhang`);
  }
  if (files.length > (lim?.images?.maxCount || 5)) throw { code: 'too_many_files' };
  const prompt = `Du bist ein erfahrener, unabhängiger Bauberater und Energieberater. Vergleiche die Handwerkerangebote für das Projekt „${p.title}“ (${projectKind(p.kind).name}) an diesem Haus. Lies alle Positionen, Mengen und Preise aus den Angeboten.
Prüfe: Leistungsumfang im Vergleich (gleiche Leistungen nebeneinander), fehlende Leistungen, die für dieses Projekt üblich oder nötig sind (z. B. bei Wärmepumpen Heizlastberechnung, hydraulischer Abgleich, Elektroanschluss, Fundament/Aufstellung, Entsorgung Altanlage/Öltank, Inbetriebnahme; bei PV Gerüst, Zählerschrank, Anmeldung Netzbetreiber), Preisplausibilität (z. B. €/kW, €/kWp, €/m²), Gewährleistung, Zahlungsbedingungen, Bindefrist, und was für die Förderung nötig ist (Antrag vor Auftrag, technische Mindestanforderungen, Bestätigung des Fachunternehmens). Formuliere konkrete Rückfragen an jeden Anbieter.

PROJEKT
${projectBlock(p, d)}

WISSENSBASIS FÖRDERUNG
${FUNDING_KNOWLEDGE}

HAUS
${houseContext(d, { withConsumption: false, withComponents: true, withProjects: false })}

ANGEBOTE
${parts.join('\n')}

${JSON_RULES}
Verwende als offerId die ID in eckigen Klammern.
Format:
{"summary":"Fazit in 2–3 Sätzen","offers":[{"offerId":"ID","vendor":"Firma","total":12345,"date":"YYYY-MM-DD oder null","validUntil":"YYYY-MM-DD oder null","strengths":["…"],"weaknesses":["…"],"missing":["fehlende oder unklare Leistung"],"questions":["Rückfrage an den Anbieter"]}],"positions":[{"label":"Leistung (vereinheitlicht)","values":{"ID":1234},"note":"z. B. nur pauschal enthalten"}],"recommendation":{"offerId":"ID oder null","reason":"Begründung"},"funding":["Hinweis zur Förderung"],"warnings":["Auffälligkeit, z. B. Vorkasse"]}`;
  return sample.json(prompt, { images: files.length ? files : undefined, modelTier: 'complex', signal: opts.signal, cache: false });
}

// ---------- images ----------
export async function aiReadImage(file, purpose, opts = {}) {
  const sample = await getSample();
  if (!sample) throw { code: 'not_granted' };
  const lim = await getLimits();
  if (!lim?.images) throw { code: 'images_unavailable' };
  let prompt;
  if (purpose === 'contact') {
    prompt = `Das Bild zeigt eine Visitenkarte, eine E-Mail-Signatur, einen Briefkopf oder einen Screenshot (z. B. Webseite, Google-Eintrag, Chat) mit Kontaktdaten einer Firma oder Person rund um Hausbau, Handwerk, Behörde oder Beratung. Lies die Kontaktdaten aus. Telefonnummern im internationalen oder deutschen Format so wie abgebildet. Erfinde nichts.
${JSON_RULES}
Format:
{"name":"Vor- und Nachname oder leer","company":"Firma","role":"Funktion, z. B. Elektromeister, Geschäftsführer, Sachbearbeiter","trade":"${['rohbau', 'dach', 'fassade', 'fenster', 'keller', 'heizung', 'lueftung', 'sanitaer', 'elektro', 'solar', 'innenausbau', 'boden', 'maler', 'sicherheit', 'aussen', 'schadstoffe', 'beratung', 'behoerde', 'sonstiges'].join('|')}","phone":"Festnetz","mobile":"Mobil","email":"E-Mail","website":"Webseite","address":"Straße, PLZ Ort","notes":"weitere Angaben, z. B. Fax, Steuernummer, Öffnungszeiten"}`;
  } else if (purpose === 'component') {
    prompt = `Das Bild zeigt ein Bauteil eines Wohnhauses oder sein Typenschild (z. B. Heizkessel, Wärmepumpe, Zählerschrank, Fenster, Wechselrichter). Lies alle erkennbaren Angaben aus.
${JSON_RULES}
Format:
{"summary":"Was ist zu sehen (1 Satz)","gewerk":"${['rohbau', 'dach', 'fassade', 'fenster', 'keller', 'heizung', 'lueftung', 'sanitaer', 'elektro', 'solar', 'innenausbau', 'boden', 'maler', 'sicherheit', 'aussen', 'schadstoffe'].join('|')}","name":"Bauteilbezeichnung","material":"Typ/Material/Leistung","maker":"Hersteller","model":"Modell","year":2001,"condition":3,"specs":["technische Angabe"],"notes":"Auffälligkeiten (z. B. Korrosion, Alter, Austauschpflicht)"}`;
  } else {
    prompt = `Das Bild bzw. PDF zeigt ein Dokument zu einer Hausmodernisierung (Exposé, Angebot, Rechnung, Förderbescheid, Vertrag oder Plan). Lies die wichtigsten Angaben aus. Fasse Kostenpositionen zu höchstens 12 Positionen zusammen.
${JSON_RULES}
Format:
{"docType":"objekt|angebot|rechnung|foerderung|vertrag|plan|gutachten|genehmigung|finanzierung|sonstiges","title":"Kurzer Titel","vendor":"Firma oder Behörde","date":"YYYY-MM-DD oder null","total":12345,"items":[{"label":"Position","amount":1000}],"deadlines":[{"title":"Frist","date":"YYYY-MM-DD"}],"summary":"2 Sätze","warnings":["Auffälligkeit, z. B. fehlende Positionen"]}`;
  }
  return sample.json(prompt, { images: [file], modelTier: 'default', signal: opts.signal, cache: false });
}

// ---------- chat ----------
export function chatRules(d) {
  return `Du bist der Haus-Assistent in der App „Hausakte“. Du hilfst dem Eigentümer, sein gerade gekauftes Haus zu verstehen, zu renovieren und zu modernisieren.
Antworte auf Deutsch, konkret und knapp (höchstens ca. 200 Wörter, wenn nicht anders gewünscht). Nutze kurze Absätze oder Aufzählungen mit "- ". Fett mit **…** sparsam.
Beziehe dich auf die Hausdaten unten. Bei Förderungen nutze die Wissensbasis und weise auf Prüfung bei KfW/BAFA hin. Erfinde keine Daten zum Haus; frage nach, wenn etwas fehlt.
Wenn der Nutzer etwas anlegen oder ändern möchte (Projekt, Termine, Status, Hinweise, Abhängigkeiten, Förderung, Kostenposition, Rahmenbedingung, Meilenstein), nutze die verfügbaren Werkzeuge und sage danach kurz, was du geändert hast. Hole dir vor dem Ändern einzelner Positionen die IDs mit get_project. Ganze Projekte löschst du nicht. Auf Wunsch deaktivierst du ein Projekt mit update_project (archived: true); endgültig löschen kann der Nutzer ein deaktiviertes Projekt nur selbst in der App.
Besprechungen: Erzählt der Nutzer von einem Termin oder Gespräch zu einem Projekt (z. B. „Notiz zur PV: Elektriker war da …“), lege mit add_meeting_note eine Besprechungsnotiz mit Terminen und To-dos an. Ändern und löschen kannst du Besprechungen mit update_item bzw. delete_item (type meeting, IDs aus get_project); frage beim Löschen nach, ob die daraus angelegten Termine und To-dos mit weg sollen, wenn der Nutzer das nicht gesagt hat.
Kontakte (Handwerker, Berater, Behörden) verwaltest und verknüpfst du mit manage_contact; Fotos von Visitenkarten lädt der Nutzer unter Dokumente › Kontakte oder im Projekt-Reiter „Ansprechpartner“ hoch.
Allgemeine Notizen ohne Projektbezug (z. B. „Notiere: …“, „Schreib dir auf …“) verwaltest du mit manage_note (anlegen, ändern, ergänzen, löschen). Passt eine Notiz eindeutig zu einem Projekt, frage kurz nach, ob sie als Besprechung ans Projekt soll.
Grundriss: Für Maße (Türbreiten, Abstände zwischen Fenstern, Wandlängen, Raummaße) hole mit get_floor_plan die Räume, Wände und Öffnungen der Etage und trage das Maß mit add_measurement ein; Leitungslängen änderst du mit update_line. Möbel stellst, änderst oder entfernst du mit manage_furniture (vorher get_floor_plan für Raum- und Wand-IDs; „an die Nordwand“ = Wand mit side Norden im Raum). Wähle bei mehreren passenden Fenstern die naheliegendsten (gleiche Wand, nebeneinander) und sage kurz, welche du genommen hast. Nachrichten können per Spracheingabe kommen – rechne mit Erkennungsfehlern (z. B. „eins komma fünf“ = 1,5) und frage nach, wenn etwas unklar ist.
Das Feld „Hinweise“ eines Projekts ist für Abhängigkeiten, Fristen und Besonderheiten gedacht, die man beim Planen beachten muss. Abhängigkeiten können auf ein Projekt (nach dessen Ende) oder auf einen Meilenstein („Projekt-ID#Meilenstein-ID“) zeigen – für Projekte und für Meilensteine.

WISSENSBASIS
${FUNDING_KNOWLEDGE}

HAUSDATEN
${houseContext(d)}`;
}

export async function aiChat(turns, d, { signal, onText, tools } = {}) {
  const sample = await getSample();
  if (!sample) throw { code: 'not_granted' };
  const lim = await getLimits();
  const input = [{ role: 'user', content: chatRules(d) }, ...turns.slice(-12)];
  const options = { signal, onText, cache: false, modelTier: 'default' };
  if (tools && lim?.tools) options.tools = tools.slice(0, lim.tools.maxCount || tools.length);
  return sample(input, options);
}

// ---------- contacts ----------
const contactLine = (c) => `[${c.id}] ${c.name || '–'} · ${c.company || '–'}${c.role ? ` · ${c.role}` : ''}${c.trade ? ` · Gewerk ${c.trade}` : ''}`;

// Looks the company up on the web (server-side search, Supabase only) and returns what it found.
export async function aiEnrichContact(c, d, opts = {}) {
  const h = d.house || {};
  const prompt = `Recherchiere im Internet zu diesem Kontakt. Es geht um einen Betrieb oder eine Stelle, mit der ein Hauseigentümer in ${[h.zip, h.city].filter(Boolean).join(' ') || 'Deutschland'} seine Modernisierung plant (Handwerker, Energieberater, Behörde, Lieferant).
Gesucht: offizielle Webseite, direkter https-Link auf das Firmenlogo als Bilddatei (von der offiziellen Webseite, z. B. Logo-Grafik oder og:image – keine Suchmaschinen-Thumbnails), Adresse, Telefon, E-Mail, kurze Beschreibung, Leistungen, Öffnungszeiten, Bewertung (z. B. Google oder Handwerkerportale, mit Anzahl), Zertifizierungen/Mitgliedschaften (z. B. Meisterbetrieb, Innung, Fachbetrieb, Energieeffizienz-Expertenliste).
Gibt es mehrere Betriebe gleichen Namens, nimm den, der zu Adresse, Telefonvorwahl oder Region passt. Bist du nicht sicher, setze found auf false und erkläre es in note. Erfinde nichts; leere Felder lieber weglassen.

KONTAKT
Name: ${c.name || '–'}
Firma: ${c.company || '–'}
Funktion: ${c.role || '–'}
Telefon: ${[c.phone, c.mobile].filter(Boolean).join(', ') || '–'}
E-Mail: ${c.email || '–'}
Webseite: ${c.website || '–'}
Adresse: ${c.address || '–'}

${JSON_RULES}
Format:
{"found":true,"website":"https://…","logoUrl":"https://…/logo.png","description":"2–3 Sätze","services":["Leistung"],"address":"Straße, PLZ Ort","phone":"…","email":"…","hours":"Mo–Fr 7–16 Uhr","rating":{"value":4.7,"count":38,"source":"Google"},"certifications":["Meisterbetrieb"],"sources":[{"title":"Seitentitel","url":"https://…"}],"confidence":"hoch|mittel|niedrig","note":"Unsicherheiten"}`;
  return askJSON(prompt, { ...opts, web: true });
}

// Finds existing meetings, to-dos, costs and documents that belong to a contact.
export async function aiLinkContact(c, d, opts = {}) {
  const L = [];
  for (const p of Object.values(d.projects || {})) {
    L.push(`PROJEKT [${p.id}] ${p.title}${p.archived ? ' (deaktiviert)' : ''}${p.notes ? ` – Notizen: ${String(p.notes).slice(0, 200)}` : ''}${p.hints ? ` – Hinweise: ${String(p.hints).slice(0, 160)}` : ''}`);
    for (const m of p.meetings || []) L.push(`  BESPRECHUNG [${p.id}/${m.id}] ${m.date} ${m.title}; Teilnehmer: ${(m.participants || []).join(', ') || '–'}; ${String(m.summary || m.transcript || '').slice(0, 220)}`);
    for (const t of p.constraints || []) L.push(`  TODO [${p.id}/${t.id}] ${t.text}${t.who ? ` (zuständig: ${t.who})` : ''}`);
    for (const k of p.costs || []) L.push(`  KOSTEN [${p.id}/${k.id}] ${k.label}${k.vendor ? ` – Anbieter: ${k.vendor}` : ''}`);
  }
  for (const doc of Object.values(d.documents || {})) L.push(`DOKUMENT [${doc.id}] ${doc.name} (${doc.type})${doc.ai?.data?.vendor ? ` – Absender: ${doc.ai.data.vendor}` : ''}${doc.ai?.data?.summary ? ` – ${String(doc.ai.data.summary).slice(0, 160)}` : ''}`);
  const prompt = `Ordne einen Kontakt den Einträgen einer Hausakte zu. Wähle nur Einträge, bei denen der Kontakt eindeutig beteiligt ist (genannt als Teilnehmer, Absender, Anbieter, Zuständiger oder klar beschrieben). Ein Projekt (projects) nur, wenn der Kontakt dort ausdrücklich als Ansprechpartner genannt wird. Lieber weglassen als raten.

KONTAKT
${contactLine(c)}${c.email ? ` · ${c.email}` : ''}${c.website ? ` · ${c.website}` : ''}

EINTRÄGE
${L.join('\n').slice(0, 60000) || 'keine'}

${JSON_RULES}
Format (IDs genau wie in eckigen Klammern):
{"projects":["projektId"],"meetings":["projektId/besprechungId"],"todos":["projektId/todoId"],"costs":["projektId/kostenId"],"documents":["dokumentId"]}`;
  return askJSON(prompt, opts);
}
