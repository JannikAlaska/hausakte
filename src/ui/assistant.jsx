import { Icon } from './icons.jsx';
import { Btn, IconBtn, Drawer } from './common.jsx';
import { Md, useAiAvailable, AiUnavailable } from './ai-ui.jsx';
import { closeDrawer, openDrawer, toast } from './state.js';
import { aiChat, aiErrorText, isHardAiError, AI_DISCLAIMER } from '../ai.js';
import { createProject, patchProject, addFunding, addCost, addConstraint, addMilestone, deleteMilestone, addMeeting, addNote, updateNote, deleteNote } from '../actions.js';
import { resolveRef, createsCycle, msRef, sortFloors } from '../metrics.js';
import { floorPlanInfo, measurePoints, dimLength, lineLength, resizeLine, relink, r3, roomOfPoint, wallFrontPoint } from '../planops.js';
import { FURNITURE, RAD_TYPES, furnType, furnSize, placeFurniture, snapToWalls, radiatorOutput, furnName } from '../furniture.js';
import { labelPoint } from '../geometry.js';
import { lineKind } from '../catalog.js';
import { updateDoc } from '../store.js';
import { pointInPoly } from '../geometry.js';
import { setUI, go } from './state.js';
import { createContact, updateContact, deleteContact, setContactLinks } from '../contacts.js';
import { getState } from '../store.js';
import { PROJECT_KINDS, CONSTRAINT_KINDS, FUNDING_TYPES, FUNDING_STATUS, STATUS, status as statusOf } from '../catalog.js';
import { isISO } from '../util.js';

const { useState, useRef, useEffect } = React;

const SUGGESTIONS = [
  'Was muss ich nach dem Hauskauf gesetzlich nachrüsten – und bis wann?',
  'In welcher Reihenfolge sollte ich mein Haus sanieren?',
  'Lohnt sich eine PV-Anlage auf meinem Dach?',
  'Welche Förderung bekomme ich für eine Wärmepumpe?',
  'Was kostet eine Fassadendämmung bei meinem Haus ungefähr?',
];

let memory = []; // survives closing the drawer within this visit

const ITEM_LISTS = { milestone: 'milestones', cost: 'costs', constraint: 'constraints', funding: 'funding', meeting: 'meetings' };
const ITEM_NAMES = { milestone: 'Meilenstein', cost: 'Kostenposition', constraint: 'Rahmenbedingung / To-do', funding: 'Förderung', meeting: 'Besprechung' };
const num = (v) => (v === null ? null : Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v, n = 2000) => String(v ?? '').slice(0, n);

// floor by id, short name ("EG") or name ("Erdgeschoss")
function findFloor(q) {
  const floors = Object.values(getState().floors || {});
  const k = String(q || '').trim().toLowerCase();
  const f = floors.find((x) => x.id === q) || floors.find((x) => (x.short || '').toLowerCase() === k) || floors.find((x) => (x.name || '').toLowerCase() === k) || floors.find((x) => (x.name || '').toLowerCase().includes(k) && k);
  if (!f) throw new Error(`Unbekannte Etage ${q}. Vorhanden: ${sortFloors(floors).map((x) => `${x.short} (${x.id})`).join(', ')}`);
  return f;
}
const midRoom = (floor, a, b) => (floor.rooms || []).find((r) => r.poly?.length && pointInPoly([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r.poly));

export function makeTools(log) {
  const getProject = (id) => {
    const p = getState().projects[String(id)];
    if (!p) throw new Error('Unbekannte projectId');
    return p;
  };
  // validates dependency references (project id or "projectId#milestoneId") for `self`
  const checkRefs = (refs, self) => {
    const projects = getState().projects;
    const all = Object.values(projects);
    const out = [];
    for (const r of refs || []) {
      const ref = String(r);
      const d = resolveRef(projects, ref);
      if (!d) throw new Error(`Unbekannte Abhängigkeit ${ref}`);
      if (ref === self) throw new Error('Ein Eintrag kann nicht von sich selbst abhängen');
      if (createsCycle(all, self, ref)) throw new Error(`Abhängigkeit ${ref} würde eine Schleife erzeugen`);
      if (!out.includes(ref)) out.push(ref);
    }
    return out;
  };
  const nextDeps = (cur, input, self) => {
    let next = Array.isArray(input.dependsOn) ? checkRefs(input.dependsOn, self) : [...(cur || [])];
    if (Array.isArray(input.addDependsOn)) next = [...new Set([...next, ...checkRefs(input.addDependsOn, self)])];
    if (Array.isArray(input.removeDependsOn)) next = next.filter((r) => !input.removeDependsOn.map(String).includes(r));
    return next;
  };
  const depProps = {
    dependsOn: { type: 'array', items: { type: 'string' }, description: 'Ersetzt die Abhängigkeiten: Projekt-IDs (nach Projektende) oder "Projekt-ID#Meilenstein-ID"' },
    addDependsOn: { type: 'array', items: { type: 'string' }, description: 'Fügt Abhängigkeiten hinzu' },
    removeDependsOn: { type: 'array', items: { type: 'string' }, description: 'Entfernt Abhängigkeiten' },
  };
  return [
    {
      name: 'get_project',
      description: 'Liefert ein Projekt mit allen Details und den IDs seiner Meilensteine, Kostenpositionen, Rahmenbedingungen und Förderungen. Vor dem Ändern einzelner Positionen aufrufen.',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
      execute(input) {
        const p = getProject(input.projectId);
        return {
          id: p.id, title: p.title, kind: p.kind, status: p.status, archived: !!p.archived, priority: p.priority, start: p.start, end: p.end, notes: p.notes || '', hints: p.hints || '', dependsOn: p.dependsOn || [],
          milestones: (p.milestones || []).map((m) => ({ id: m.id, ref: msRef(p.id, m.id), title: m.title, date: m.date, done: !!m.done, dependsOn: m.dependsOn || [] })),
          costs: (p.costs || []).map((k) => ({ id: k.id, label: k.label, estimate: k.estimate, offer: k.offer, actual: k.actual, vendor: k.vendor || '' })),
          constraints: (p.constraints || []).map((c) => ({ id: c.id, text: c.text, kind: c.kind, done: !!c.done })),
          funding: (p.funding || []).map((f) => ({ id: f.id, program: f.program, provider: f.provider, type: f.type, status: f.status, rate: f.rate, amount: f.amount, deadline: f.deadline })),
          meetings: (p.meetings || []).map((m) => ({ id: m.id, date: m.date, title: m.title, summary: m.summary, milestoneIds: m.milestoneIds || [], todoIds: m.todoIds || [] })),
        };
      },
    },
    {
      name: 'update_project',
      description: 'Ändert ein bestehendes Projekt. Nur übergebene Felder werden geändert.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          title: { type: 'string' },
          kind: { type: 'string', enum: PROJECT_KINDS.map((k) => k.key) },
          status: { type: 'string', enum: STATUS.map((k) => k.key) },
          priority: { type: 'number', description: '1 hoch, 2 mittel, 3 niedrig' },
          start: { type: 'string', description: 'YYYY-MM-DD' },
          end: { type: 'string', description: 'YYYY-MM-DD' },
          notes: { type: 'string', description: 'ersetzt die Notizen' },
          hints: { type: 'string', description: 'ersetzt die Hinweise (Abhängigkeiten, Fristen, Besonderheiten)' },
          appendHints: { type: 'string', description: 'hängt einen Hinweis an die bestehenden an' },
          archived: { type: 'boolean', description: 'true deaktiviert das Projekt (aus Plan und Budget genommen), false aktiviert es wieder. Löschen kann nur der Nutzer selbst.' },
          ...depProps,
        },
        required: ['projectId'],
      },
      execute(input) {
        const p = getProject(input.projectId);
        const patch = {};
        const changed = [];
        if (input.title) (patch.title = str(input.title, 120)), changed.push('Titel');
        if (PROJECT_KINDS.some((k) => k.key === input.kind)) (patch.kind = input.kind), changed.push('Art');
        if (STATUS.some((k) => k.key === input.status)) (patch.status = input.status), changed.push(`Status ${statusOf(input.status).name}`);
        if ([1, 2, 3].includes(Number(input.priority))) (patch.priority = Number(input.priority)), changed.push('Priorität');
        if (isISO(input.start)) (patch.start = input.start), changed.push('Start');
        if (isISO(input.end)) (patch.end = input.end), changed.push('Ende');
        if ((patch.end || p.end) && (patch.start || p.start) && (patch.end || p.end) < (patch.start || p.start)) throw new Error('Ende liegt vor dem Start');
        if (typeof input.notes === 'string') (patch.notes = str(input.notes)), changed.push('Notizen');
        if (typeof input.hints === 'string') (patch.hints = str(input.hints)), changed.push('Hinweise');
        if (input.appendHints) (patch.hints = [(patch.hints ?? p.hints ?? '').trim(), str(input.appendHints, 600)].filter(Boolean).join('\n')), changed.push('Hinweise');
        if (input.dependsOn || input.addDependsOn || input.removeDependsOn) (patch.dependsOn = nextDeps(p.dependsOn, input, p.id)), changed.push('Abhängigkeiten');
        if (typeof input.archived === 'boolean' && input.archived !== !!p.archived) (patch.archived = input.archived), (patch.archivedAt = input.archived ? Date.now() : null), changed.push(input.archived ? 'deaktiviert' : 'wieder aktiviert');
        if (!changed.length) return 'Keine gültigen Änderungen übergeben';
        patchProject(p.id, (x) => ({ ...x, ...patch }));
        log({ kind: 'project', id: p.id, text: `${p.title}: ${[...new Set(changed)].join(', ')} geändert` });
        return { ok: true, changed };
      },
    },
    {
      name: 'create_project',
      description: 'Legt ein neues Modernisierungsprojekt an. Gibt die neue Projekt-ID zurück.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: PROJECT_KINDS.map((k) => k.key) },
          start: { type: 'string', description: 'YYYY-MM-DD' },
          end: { type: 'string', description: 'YYYY-MM-DD' },
          priority: { type: 'number', description: '1 hoch, 2 mittel, 3 niedrig' },
          notes: { type: 'string' },
          hints: { type: 'string', description: 'Hinweise zu Abhängigkeiten, Fristen, Besonderheiten' },
          dependsOn: depProps.dependsOn,
        },
        required: ['title', 'kind'],
      },
      execute(input) {
        const deps = checkRefs(input.dependsOn || [], '__new__');
        const id = createProject({
          title: str(input.title || 'Neues Projekt', 120),
          kind: String(input.kind || 'sonstiges'),
          start: isISO(input.start) ? input.start : undefined,
          end: isISO(input.end) ? input.end : undefined,
          priority: [1, 2, 3].includes(Number(input.priority)) ? Number(input.priority) : 2,
          notes: str(input.notes),
          hints: str(input.hints),
          dependsOn: deps,
        });
        log({ kind: 'project', id, text: `Projekt angelegt: ${input.title}` });
        return { id, title: input.title };
      },
    },
    {
      name: 'add_meeting_note',
      description: 'Legt an einem Projekt eine Besprechungsnotiz an (z. B. nach einem Termin mit einem Handwerker) und trägt die daraus abgeleiteten Termine als Meilensteine und die To-dos als Aufgaben ein. Relative Datumsangaben vorher in YYYY-MM-DD umrechnen.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          title: { type: 'string' },
          date: { type: 'string', description: 'Datum der Besprechung YYYY-MM-DD' },
          participants: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string', description: '2–4 Sätze' },
          points: { type: 'array', items: { type: 'string' } },
          decisions: { type: 'array', items: { type: 'string' } },
          openQuestions: { type: 'array', items: { type: 'string' } },
          appointments: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, note: { type: 'string' } }, required: ['title'] } },
          todos: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, who: { type: 'string' }, due: { type: 'string' }, kind: { type: 'string', enum: CONSTRAINT_KINDS.map((k) => k.key) } }, required: ['text'] } },
          transcript: { type: 'string', description: 'Wortlaut der Nachricht des Nutzers' },
        },
        required: ['projectId', 'summary'],
      },
      execute(input) {
        const p = getProject(input.projectId);
        const r = addMeeting(p.id, input, { transcript: str(input.transcript, 20000), date: isISO(input.date) ? input.date : undefined });
        log({ kind: 'project', id: p.id, tab: 'besprechungen', text: `Besprechung bei „${p.title}“${r.milestones ? ` · ${r.milestones} Termin${r.milestones > 1 ? 'e' : ''}` : ''}${r.todos ? ` · ${r.todos} To-do${r.todos > 1 ? 's' : ''}` : ''}` });
        return r;
      },
    },
    {
      name: 'manage_note',
      description: 'Allgemeine Notizen, die zu keinem Projekt gehören: anlegen (action add), ändern oder ergänzen (update, mit appendText zum Anhängen) und löschen (delete). IDs der vorhandenen Notizen stehen in den Hausdaten unter NOTIZEN.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'delete'] },
          noteId: { type: 'string', description: 'bei update und delete' },
          title: { type: 'string', description: 'kurzer Titel' },
          text: { type: 'string', description: 'Inhalt (bei update: ersetzt den Text)' },
          appendText: { type: 'string', description: 'bei update: wird an den Text angehängt' },
          date: { type: 'string', description: 'YYYY-MM-DD, Standard heute' },
        },
        required: ['action'],
      },
      execute(input) {
        const notes = getState().notes || {};
        if (input.action === 'add') {
          if (!str(input.text).trim() && !str(input.title).trim()) throw new Error('Leere Notiz');
          const id = addNote({ title: str(input.title, 140), text: str(input.text, 20000), date: isISO(input.date) ? input.date : undefined, source: 'ki' });
          log({ kind: 'note', text: `Notiz angelegt: ${input.title || str(input.text, 50)}` });
          return { id };
        }
        const n = notes[String(input.noteId)];
        if (!n) throw new Error(`Unbekannte noteId. Vorhanden: ${Object.values(notes).map((x) => `${x.id} „${x.title}“`).join(', ') || 'keine'}`);
        if (input.action === 'delete') {
          deleteNote(n.id);
          log({ kind: 'note', text: `Notiz gelöscht: ${n.title}` });
          return 'ok';
        }
        const patch = {};
        if (typeof input.title === 'string' && input.title.trim()) patch.title = str(input.title, 140);
        if (typeof input.text === 'string') patch.text = str(input.text, 20000);
        if (input.appendText) patch.text = [(patch.text ?? n.text ?? '').trim(), str(input.appendText, 5000)].filter(Boolean).join('\n');
        if (isISO(input.date)) patch.date = input.date;
        if (!Object.keys(patch).length) return 'Keine Änderung übergeben';
        updateNote(n.id, patch);
        log({ kind: 'note', text: `Notiz geändert: ${patch.title || n.title}` });
        return 'ok';
      },
    },
    {
      name: 'manage_contact',
      description: 'Kontakte (Handwerker, Berater, Behörden): anlegen (add), ändern (update), löschen (delete), mit Einträgen verknüpfen (link) oder Verknüpfungen lösen (unlink). IDs der Kontakte stehen in den Hausdaten unter KONTAKTE, die von Besprechungen, To-dos und Kosten liefert get_project. Verknüpfungen: projectId allein ordnet den Kontakt dem Projekt zu; projectId mit meetingId, todoId oder costId verknüpft den Eintrag; documentId ein Dokument.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'delete', 'link', 'unlink'] },
          contactId: { type: 'string' },
          name: { type: 'string' },
          company: { type: 'string' },
          role: { type: 'string' },
          phone: { type: 'string' },
          mobile: { type: 'string' },
          email: { type: 'string' },
          website: { type: 'string' },
          address: { type: 'string' },
          notes: { type: 'string' },
          projectId: { type: 'string' },
          meetingId: { type: 'string' },
          todoId: { type: 'string' },
          costId: { type: 'string' },
          documentId: { type: 'string' },
        },
        required: ['action'],
      },
      execute(input) {
        const contacts = getState().contacts || {};
        const fields = Object.fromEntries(['name', 'company', 'role', 'phone', 'mobile', 'email', 'website', 'address', 'notes'].filter((f) => typeof input[f] === 'string').map((f) => [f, str(input[f], f === 'notes' ? 2000 : 200)]));
        if (input.action === 'add') {
          if (!fields.name && !fields.company) throw new Error('Name oder Firma fehlt');
          const id = createContact({ ...fields, source: 'ki' });
          if (input.projectId && getState().projects[input.projectId]) setContactLinks(id, { projects: [input.projectId] });
          log({ kind: 'contact', id, text: `Kontakt angelegt: ${fields.company || fields.name}` });
          return { id };
        }
        const c = contacts[String(input.contactId)];
        if (!c) throw new Error(`Unbekannte contactId. Vorhanden: ${Object.values(contacts).map((x) => `${x.id} ${x.company || x.name}`).join(', ') || 'keine'}`);
        const title = c.company || c.name;
        if (input.action === 'delete') {
          deleteContact(c.id);
          log({ kind: 'note', text: `Kontakt gelöscht: ${title}` });
          return 'ok';
        }
        if (input.action === 'update') {
          if (!Object.keys(fields).length) return 'Keine Änderung übergeben';
          updateContact(c.id, fields);
          log({ kind: 'contact', id: c.id, text: `Kontakt geändert: ${fields.company || title}` });
          return 'ok';
        }
        const pid = input.projectId ? String(input.projectId) : null;
        if (pid && !getState().projects[pid]) throw new Error('Unbekannte projectId');
        const links = { projects: [], meetings: [], todos: [], costs: [], docs: [] };
        if (pid && input.meetingId) links.meetings.push(`${pid}/${input.meetingId}`);
        else if (pid && input.todoId) links.todos.push(`${pid}/${input.todoId}`);
        else if (pid && input.costId) links.costs.push(`${pid}/${input.costId}`);
        else if (pid) links.projects.push(pid);
        if (input.documentId) links.docs.push(String(input.documentId));
        const n = setContactLinks(c.id, links, input.action === 'link');
        if (!n) throw new Error('Nichts gefunden, was verknüpft werden könnte – IDs prüfen');
        log({ kind: 'contact', id: c.id, text: `${title}: ${input.action === 'link' ? 'verknüpft' : 'Verknüpfung gelöst'}` });
        return 'ok';
      },
    },
    {
      name: 'get_floor_plan',
      description: 'Liefert den Grundriss einer Etage: Räume mit Größe, Wänden (Lage aus Sicht des Raums als Himmelsrichtung) und Fenstern/Türen samt IDs, dazu eingetragene Maße und Leitungen. Vor add_measurement oder update_line aufrufen.',
      inputSchema: { type: 'object', properties: { floor: { type: 'string', description: 'Etagen-ID, Kürzel (z. B. EG) oder Name' } }, required: ['floor'] },
      execute(input) {
        const f = findFloor(input.floor);
        return {
          floorId: f.id,
          name: f.name,
          rooms: floorPlanInfo(f, getState().house?.northAngle || 0),
          dims: (f.dims || []).map((d) => ({ id: d.id, label: d.label, value: d.value, planLength: r3(dimLength(d)), room: midRoom(f, d.a, d.b)?.name || null })),
          lines: (f.lines || []).filter((l) => !l.auto).map((l) => ({ id: l.id, kind: lineKind(l.kind).name, label: l.label || '', riser: !!l.riser, length: r3(lineLength(l)), status: l.status || 'bestand', room: l.pts?.length ? midRoom(f, l.pts[0], l.pts[l.pts.length - 1])?.name || null : null })),
          furniture: (f.furniture || []).map((x) => {
            const { w, d, h } = furnSize(x);
            const out = radiatorOutput(x);
            return { id: x.id, type: x.type, name: furnName(x), label: x.label || '', size_cm: `${Math.round(w * 100)} × ${Math.round(d * 100)} × ${Math.round(h * 100)}`, rotation: x.rot || 0, status: x.status || 'bestand', room: roomOfPoint(f, { x: x.x, y: x.y })?.name || null, ...(out ? { heatOutput_W: out } : {}) };
          }),
        };
      },
    },
    {
      name: 'add_measurement',
      description: 'Trägt eine Maßlinie in den Grundriss ein, z. B. Türbreite (type opening), Abstand zwischen zwei Fenstern oder Türen an derselben Wand (type between_openings: Lücke zwischen den Kanten), Wandlänge (wall), Raumbreite/-tiefe (room) oder zwei Punkte in Metern (points). value ist der vor Ort gemessene Wert in Metern. IDs aus get_floor_plan.',
      inputSchema: {
        type: 'object',
        properties: {
          floor: { type: 'string', description: 'Etagen-ID oder Kürzel' },
          type: { type: 'string', enum: ['opening', 'between_openings', 'wall', 'room', 'points'] },
          label: { type: 'string', description: 'kurze Bezeichnung, z. B. "Abstand Fenster Wohnzimmer"' },
          value: { type: 'number', description: 'gemessener Wert in Metern' },
          roomId: { type: 'string', description: 'Raum, auf dessen Seite die Maßlinie liegt (bei room Pflicht)' },
          openingId: { type: 'string' },
          openingId2: { type: 'string', description: 'zweite Öffnung bei between_openings' },
          wallId: { type: 'string' },
          direction: { type: 'string', enum: ['lang', 'kurz'], description: 'bei room: lange oder kurze Raumseite' },
          a: { type: 'array', items: { type: 'number' }, description: 'bei points: [x, y] in Metern' },
          b: { type: 'array', items: { type: 'number' } },
        },
        required: ['floor', 'type'],
      },
      execute(input) {
        const f = findFloor(input.floor);
        const [a, b] = measurePoints(f, input);
        const value = Number(input.value) > 0 ? r3(Number(input.value)) : null;
        const id = 'd' + Math.random().toString(36).slice(2, 10);
        const d = { id, a, b, value, label: str(input.label, 80), by: 'ki' };
        updateDoc('floors', f.id, (x) => ({ ...x, dims: [...(x.dims || []), d] }), 50);
        const plan = r3(dimLength(d));
        log({ kind: 'plan', floorId: f.id, text: `Maß im Grundriss ${f.short || f.name}: ${d.label || 'Maß'} ${value ?? plan} m` });
        return { id, planLength: plan, value, room: midRoom(f, a, b)?.name || null, note: value && Math.abs(value - plan) > 0.05 ? `Der Plan zeigt ${plan} m – Abweichung ${r3(value - plan)} m` : undefined };
      },
    },
    {
      name: 'update_line',
      description: 'Ändert eine eingezeichnete Leitung: Länge in Metern (die Zeichnung wird am Ende bzw. Anfang verlängert oder gekürzt, bei Steigleitungen oben), Bezeichnung oder Zustand. IDs aus get_floor_plan.',
      inputSchema: {
        type: 'object',
        properties: {
          floor: { type: 'string' },
          lineId: { type: 'string' },
          length: { type: 'number', description: 'neue Länge in Metern' },
          atStart: { type: 'boolean', description: 'am Anfang statt am Ende anpassen' },
          label: { type: 'string' },
          status: { type: 'string', enum: ['bestand', 'geplant', 'stillgelegt'] },
        },
        required: ['floor', 'lineId'],
      },
      execute(input) {
        const f = findFloor(input.floor);
        const l = (f.lines || []).find((x) => x.id === String(input.lineId));
        if (!l) throw new Error('Unbekannte lineId');
        const patch = { auto: false };
        if (Number(input.length) > 0.02) patch.pts = resizeLine(l.pts, Number(input.length), !!input.atStart);
        if (typeof input.label === 'string') patch.label = str(input.label, 120);
        if (['bestand', 'geplant', 'stillgelegt'].includes(input.status)) patch.status = input.status;
        updateDoc('floors', f.id, (x) => relink({ ...x, lines: (x.lines || []).map((y) => (y.id === l.id ? { ...y, ...patch } : y)) }), 50);
        log({ kind: 'plan', floorId: f.id, text: `Leitung geändert: ${l.label || lineKind(l.kind).name}${patch.pts ? ` – ${r3(lineLength({ pts: patch.pts }))} m` : ''}` });
        return { ok: true, length: r3(lineLength({ pts: patch.pts || l.pts })) };
      },
    },
    {
      name: 'manage_furniture',
      description: 'Stellt Möbel in den Grundriss (erscheinen auch im 3D-Modell), ändert oder entfernt sie. add: type aus dem Katalog, roomId (aus get_floor_plan) und optional wallId einer Wand dieses Raums – das Möbel stellt sich mit der Rückseite an diese Wand (Mitte, along verschiebt entlang der Wand). Ohne wallId kommt es in die Raummitte. Maße in Zentimetern, ohne Angabe gelten Standardmaße. update/delete mit furnitureId aus get_floor_plan.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'delete'] },
          floor: { type: 'string', description: 'Etagen-ID oder Kürzel' },
          type: { type: 'string', enum: FURNITURE.map((x) => x.key), description: FURNITURE.map((x) => `${x.key}=${x.name}`).join(', ') },
          roomId: { type: 'string' },
          wallId: { type: 'string' },
          along: { type: 'number', description: 'Verschiebung entlang der Wand in Metern ab Wandmitte' },
          furnitureId: { type: 'string' },
          width: { type: 'number', description: 'Breite in cm' },
          depth: { type: 'number', description: 'Tiefe in cm' },
          height: { type: 'number', description: 'Höhe in cm' },
          rotation: { type: 'number', description: 'Drehung in Grad im Uhrzeigersinn (nur update)' },
          radiatorType: { type: 'string', enum: RAD_TYPES.map((x) => x.key), description: 'Bauart bei Plattenheizkörpern (z. B. 22); setzt auch die Tiefe' },
          label: { type: 'string' },
          status: { type: 'string', enum: ['bestand', 'geplant'] },
        },
        required: ['action', 'floor'],
      },
      execute(input) {
        const f = findFloor(input.floor);
        const size = {};
        const rt = RAD_TYPES.find((x) => x.key === String(input.radiatorType || ''));
        if (rt) Object.assign(size, { rtype: rt.key, d: rt.d });
        for (const [k, key] of [['w', 'width'], ['d', 'depth'], ['h', 'height']]) if (Number(input[key]) >= 1 && Number(input[key]) <= 1000) size[k] = r3(Number(input[key]) / 100);
        if (input.action === 'add') {
          if (!FURNITURE.some((x) => x.key === input.type)) throw new Error('Unbekannter type – Katalog-Schlüssel verwenden');
          const room = (f.rooms || []).find((r) => r.id === String(input.roomId || '')) || null;
          if (input.roomId && !room) throw new Error('Unbekannte roomId');
          const p = input.wallId ? wallFrontPoint(f, String(input.wallId), room?.id, input.along, (size.d ?? furnType(input.type).d) / 2) : room ? labelPoint(room.poly) : null;
          if (!p) throw new Error('roomId oder wallId angeben');
          const placed = placeFurniture(input.type, p, f.walls || [], 0.01);
          const x = { id: 'fu' + Math.random().toString(36).slice(2, 10), ...placed, ...size, label: str(input.label, 80), status: input.status === 'geplant' ? 'geplant' : 'bestand', by: 'ki' };
          // own sizes: stay flush with the wall
          if (Object.keys(size).length) Object.assign(x, (({ x: sx, y: sy }) => ({ x: sx, y: sy }))(snapToWalls(x, f.walls || [])));
          updateDoc('floors', f.id, (fl) => ({ ...fl, furniture: [...(fl.furniture || []), x] }), 50);
          log({ kind: 'plan', floorId: f.id, text: `${furnType(x.type).name} in ${roomOfPoint(f, x)?.name || f.short || f.name} gestellt` });
          return { id: x.id, room: roomOfPoint(f, x)?.name || null, rotation: x.rot, size_cm: `${Math.round((x.w ?? 0) * 100)} × ${Math.round((x.d ?? 0) * 100)}`, ...(radiatorOutput(x) ? { heatOutput_W: radiatorOutput(x) } : {}) };
        }
        const cur = (f.furniture || []).find((x) => x.id === String(input.furnitureId || ''));
        if (!cur) throw new Error('Unbekannte furnitureId');
        const name = cur.label || furnType(cur.type).name;
        if (input.action === 'delete') {
          updateDoc('floors', f.id, (fl) => ({ ...fl, furniture: (fl.furniture || []).filter((x) => x.id !== cur.id) }), 50);
          log({ kind: 'plan', floorId: f.id, text: `${name} entfernt` });
          return 'ok';
        }
        const patch = { ...size };
        if (Number.isFinite(Number(input.rotation)) && input.rotation !== null && input.rotation !== undefined) patch.rot = ((Math.round(Number(input.rotation)) % 360) + 360) % 360;
        if (typeof input.label === 'string') patch.label = str(input.label, 80);
        if (['bestand', 'geplant'].includes(input.status)) patch.status = input.status;
        updateDoc('floors', f.id, (fl) => ({ ...fl, furniture: (fl.furniture || []).map((x) => (x.id === cur.id ? { ...x, ...patch } : x)) }), 50);
        log({ kind: 'plan', floorId: f.id, text: `${name} geändert` });
        return 'ok';
      },
    },
    {
      name: 'add_milestone',
      description: 'Fügt einem Projekt einen Termin oder Meilenstein hinzu. Gibt die Meilenstein-Referenz zurück.',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, title: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, dependsOn: depProps.dependsOn }, required: ['projectId', 'title'] },
      execute(input) {
        const p = getProject(input.projectId);
        const deps = checkRefs(input.dependsOn || [], '__new__');
        const mid = addMilestone(p.id, str(input.title, 160), isISO(input.date) ? input.date : null, deps);
        log({ kind: 'project', id: p.id, text: `Meilenstein: ${input.title}` });
        return { ref: msRef(p.id, mid), id: mid };
      },
    },
    {
      name: 'update_item',
      description: 'Ändert einen Meilenstein, eine Kostenposition, Rahmenbedingung/To-do, Förderung oder Besprechung eines Projekts (IDs aus get_project). Nur übergebene Felder werden geändert.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          type: { type: 'string', enum: Object.keys(ITEM_LISTS) },
          itemId: { type: 'string' },
          title: { type: 'string', description: 'Meilenstein oder Besprechung' },
          date: { type: 'string', description: 'Meilenstein oder Besprechung: YYYY-MM-DD' },
          summary: { type: 'string', description: 'Besprechung: Zusammenfassung' },
          due: { type: 'string', description: 'To-do: fällig am YYYY-MM-DD' },
          who: { type: 'string', description: 'To-do: zuständig' },
          done: { type: 'boolean', description: 'Meilenstein oder Rahmenbedingung erledigt' },
          label: { type: 'string', description: 'Kostenposition' },
          estimate: { type: 'number', description: 'Kostenposition: Schätzung in €' },
          offer: { type: 'number', description: 'Kostenposition: Angebot in €' },
          actual: { type: 'number', description: 'Kostenposition: Ist-Kosten in €' },
          text: { type: 'string', description: 'Rahmenbedingung' },
          program: { type: 'string', description: 'Förderung' },
          status: { type: 'string', enum: FUNDING_STATUS.map((x) => x.key), description: 'Förderung' },
          amount: { type: 'number', description: 'Förderung: Betrag in €' },
          rate: { type: 'number', description: 'Förderung: Satz in %' },
          deadline: { type: 'string', description: 'Förderung: Antrag bis YYYY-MM-DD' },
          ...depProps,
        },
        required: ['projectId', 'type', 'itemId'],
      },
      execute(input) {
        const p = getProject(input.projectId);
        const key = ITEM_LISTS[input.type];
        if (!key) throw new Error('Unbekannter type');
        const item = (p[key] || []).find((x) => x.id === String(input.itemId));
        if (!item) throw new Error(`Unbekannte itemId für ${input.type}`);
        const allowed = { milestone: ['title', 'date', 'done'], cost: ['label', 'estimate', 'offer', 'actual'], constraint: ['text', 'done', 'due', 'who'], funding: ['program', 'status', 'amount', 'rate', 'deadline'], meeting: ['title', 'date', 'summary'] }[input.type];
        const patch = {};
        for (const f of allowed) {
          if (!(f in input)) continue;
          const v = input[f];
          if (f === 'date' || f === 'deadline' || f === 'due') patch[f] = isISO(v) ? v : input.type === 'meeting' ? item.date : null;
          else if (f === 'summary') patch[f] = str(v, 2000);
          else if (f === 'done') patch[f] = !!v;
          else if (['estimate', 'offer', 'actual', 'amount', 'rate'].includes(f)) { if (num(v) !== undefined) patch[f] = num(v); }
          else if (f === 'status') { if (FUNDING_STATUS.some((x) => x.key === v)) patch[f] = v; }
          else patch[f] = str(v, 300);
        }
        if (input.type === 'milestone' && (input.dependsOn || input.addDependsOn || input.removeDependsOn)) patch.dependsOn = nextDeps(item.dependsOn, input, msRef(p.id, item.id));
        if (!Object.keys(patch).length) return 'Keine gültigen Änderungen übergeben';
        patchProject(p.id, (x) => ({ ...x, [key]: (x[key] || []).map((y) => (y.id === item.id ? { ...y, ...patch } : y)) }));
        log({ kind: 'project', id: p.id, text: `${ITEM_NAMES[input.type]} geändert: ${item.title || item.label || item.text || item.program}` });
        return 'ok';
      },
    },
    {
      name: 'delete_item',
      description: 'Löscht einen Meilenstein, eine Kostenposition, Rahmenbedingung/To-do, Förderung oder Besprechung eines Projekts (IDs aus get_project). Bei Besprechungen löscht withDerived auch die daraus angelegten Termine und To-dos.',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, type: { type: 'string', enum: Object.keys(ITEM_LISTS) }, itemId: { type: 'string' }, withDerived: { type: 'boolean' } }, required: ['projectId', 'type', 'itemId'] },
      execute(input) {
        const p = getProject(input.projectId);
        const key = ITEM_LISTS[input.type];
        const item = key && (p[key] || []).find((x) => x.id === String(input.itemId));
        if (!item) throw new Error(`Unbekannte itemId für ${input.type}`);
        if (input.type === 'milestone') deleteMilestone(p.id, item.id);
        else if (input.type === 'meeting' && input.withDerived) {
          const ms = new Set(item.milestoneIds || []),
            td = new Set(item.todoIds || []);
          ms.forEach((mid) => deleteMilestone(p.id, mid));
          patchProject(p.id, (x) => ({ ...x, meetings: (x.meetings || []).filter((y) => y.id !== item.id), constraints: (x.constraints || []).filter((c) => !td.has(c.id)) }));
        } else patchProject(p.id, (x) => ({ ...x, [key]: (x[key] || []).filter((y) => y.id !== item.id) }));
        log({ kind: 'project', id: p.id, text: `${ITEM_NAMES[input.type]} gelöscht: ${item.title || item.label || item.text || item.program}` });
        return 'ok';
      },
    },
    {
      name: 'add_funding',
      description: 'Erfasst ein Förderprogramm an einem bestehenden Projekt (projectId aus den Hausdaten oder aus create_project).',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          program: { type: 'string' },
          provider: { type: 'string' },
          type: { type: 'string', enum: FUNDING_TYPES.map((t) => t.key) },
          rate: { type: 'number', description: 'Fördersatz in Prozent' },
          amount: { type: 'number', description: 'geschätzter Betrag in Euro' },
          deadline: { type: 'string', description: 'Antrag bis YYYY-MM-DD' },
          notes: { type: 'string' },
        },
        required: ['projectId', 'program'],
      },
      execute(input) {
        const p = getProject(input.projectId);
        addFunding(p.id, { ...input, program: String(input.program), deadline: isISO(input.deadline) ? input.deadline : null, source: 'ki', status: 'pruefen' });
        log({ kind: 'project', id: p.id, text: `Förderung erfasst: ${input.program}` });
        return 'ok';
      },
    },
    {
      name: 'add_cost_item',
      description: 'Fügt einem Projekt eine geschätzte Kostenposition hinzu.',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, label: { type: 'string' }, estimate: { type: 'number' } }, required: ['projectId', 'label', 'estimate'] },
      execute(input) {
        const p = getProject(input.projectId);
        addCost(p.id, { label: String(input.label), estimate: Number(input.estimate) || null });
        log({ kind: 'project', id: p.id, text: `Kostenposition: ${input.label}` });
        return 'ok';
      },
    },
    {
      name: 'add_constraint',
      description: 'Fügt einem Projekt eine Rahmenbedingung oder Aufgabe hinzu (z. B. Genehmigung, Pflicht, Witterung).',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, text: { type: 'string' }, kind: { type: 'string', enum: CONSTRAINT_KINDS.map((k) => k.key) } }, required: ['projectId', 'text'] },
      execute(input) {
        const p = getProject(input.projectId);
        addConstraint(p.id, String(input.text), String(input.kind || 'organisatorisch'));
        log({ kind: 'project', id: p.id, text: `Rahmenbedingung: ${input.text}` });
        return 'ok';
      },
    },
  ];
}

// Browser speech recognition (Chrome, Edge, Safari); null where it is missing (Firefox).
const SpeechRec = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export function AssistantDrawer({ data, drawer }) {
  const avail = useAiAvailable();
  const [msgs, setMsgs] = useState(memory);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hard, setHard] = useState(false);
  const ctl = useRef(null);
  const end = useRef(null);
  const rec = useRef(null);
  const [listening, setListening] = useState(false);
  useEffect(() => {
    memory = msgs;
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs]);
  useEffect(
    () => () => {
      ctl.current?.abort();
      rec.current?.abort();
    },
    [],
  );

  // speech: the transcript appears in the input and is sent when you stop talking
  const listen = () => {
    if (listening) return rec.current?.stop();
    if (!SpeechRec) return toast('Spracheingabe kann dieser Browser nicht – nutze das Mikrofon deiner Tastatur (Diktieren) oder Chrome/Safari.', 'warn', 6000);
    const r = new SpeechRec();
    r.lang = 'de-DE';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let final = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setInput((final + interim).trim());
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Das Mikrofon ist für diese Seite nicht freigegeben. Erlaube den Zugriff in den Browser-Einstellungen – in der Vorschau in claude.ai geht es nicht, nutze dort deine Hausakte-Adresse.', 'warn', 7000);
      else if (e.error === 'no-speech') toast('Nichts verstanden – versuche es noch einmal.', 'warn');
      else if (e.error !== 'aborted') toast('Spracheingabe fehlgeschlagen.', 'err');
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
      const t = final.trim();
      if (t) send(t);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      toast('Spracheingabe konnte nicht starten.', 'err');
    }
  };
  useEffect(() => {
    if (drawer?.voice && avail !== false && !rec.current) listen();
  }, [drawer?.voice]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    const history = [...msgs.filter((m) => m.role !== 'tool'), { role: 'user', content: q }];
    const aiIdx = msgs.length + 1;
    setMsgs((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '', pending: true }]);
    setBusy(true);
    const c = new AbortController();
    ctl.current = c;
    const toolLog = [];
    const log = (entry) => {
      toolLog.push(entry);
      setMsgs((m) => {
        const copy = [...m];
        copy.splice(copy.length - 1, 0, { role: 'tool', ...entry });
        return copy;
      });
    };
    try {
      const turns = history.map((m) => ({ role: m.role, content: m.content })).filter((m) => m.content);
      const { text: answer } = await aiChat(turns, getState(), {
        signal: c.signal,
        tools: makeTools(log),
        onText: ({ text: t }) => setMsgs((m) => m.map((x, i) => (i === m.length - 1 && x.pending ? { ...x, content: t } : x))),
      });
      setMsgs((m) => m.map((x, i) => (i === m.length - 1 && x.pending ? { role: 'assistant', content: answer } : x)));
    } catch (e) {
      if (isHardAiError(e)) setHard(true);
      setMsgs((m) =>
        m.map((x, i) =>
          i === m.length - 1 && x.pending ? { role: 'assistant', content: (e.text ? e.text + '\n\n' : '') + (e.code === 'cancelled' ? '_Abgebrochen._' : aiErrorText(e)), error: e.code !== 'cancelled' } : x,
        ),
      );
    } finally {
      setBusy(false);
      void aiIdx;
    }
  };

  return (
    <Drawer
      eyebrow="KI-Assistent"
      title="Frag deine Hausakte"
      icon="sparkles"
      onClose={closeDrawer}
      subtitle="Kennt dein Haus, deine Bauteile, Verbräuche und Projekte"
      footer={
        avail === false || hard ? (
          <AiUnavailable />
        ) : (
          <div className="chat-input" style={{ flex: 1 }}>
            <textarea
              id="chat-input"
              className="input"
              rows={2}
              placeholder={listening ? 'Ich höre zu …' : 'z. B. Welche Förderung gibt es für neue Fenster?'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {!busy ? <IconBtn icon={listening ? 'stop' : 'mic'} label={listening ? 'Zuhören beenden' : 'Sprechen'} className={`mic-btn ${listening ? 'is-listening' : ''}`} onClick={listen} /> : null}
            {busy ? <IconBtn icon="stop" label="Stoppen" onClick={() => ctl.current?.abort()} /> : <IconBtn icon="send" label="Senden" onClick={() => send()} />}
          </div>
        )
      }
    >
      <div className="chat">
        {!msgs.length ? (
          <>
            <div className="msg msg-ai">
              <p>Hallo! Ich kenne die Daten deiner Hausakte und helfe dir bei Förderung, Reihenfolge, Kosten und Pflichten rund um die Modernisierung.</p>
              <p>Ich kann auch Projekte, Förderungen, Kostenpositionen und Termine für dich anlegen und bestehende Projekte ändern – z. B. Termine verschieben, Status setzen, Hinweise ergänzen oder Abhängigkeiten festlegen.</p>
              <p>Besprechungsnotizen an Projekten und allgemeine Notizen lege ich auf Zuruf an, ändere oder lösche sie – z. B. „Notiere: Schornsteinfeger kommt am 12. November“.</p>
              <p>Im Grundriss trage ich Maße ein und passe Leitungslängen an – z. B. „Erfasse den Abstand zwischen den zwei Fenstern im Wohnzimmer: 1,5 Meter“. Tippe aufs Mikrofon, um mir das einfach zu sagen.</p>
            </div>
            <div className="suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)} disabled={avail === false}>
                  {s}
                </button>
              ))}
            </div>
          </>
        ) : null}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="msg msg-user">
              {m.content}
            </div>
          ) : m.role === 'tool' ? (
            <button
              key={i}
              className="msg-tool"
              onClick={() => {
                if (m.kind === 'plan') {
                  closeDrawer();
                  setUI({ floorId: m.floorId, planFull: false });
                  go('grundriss');
                } else if (m.kind === 'contact') {
                  openDrawer({ type: 'contact', id: m.id });
                } else if (m.kind === 'note') {
                  closeDrawer();
                  setUI({ docTab: 'notizen' });
                  go('dokumente');
                } else if (m.id) openDrawer({ type: 'project', id: m.id, tab: m.tab });
              }}
              style={{ border: 0 }}
            >
              <Icon name="check" size={13} /> {m.text}
            </button>
          ) : (
            <div key={i} className="msg msg-ai" style={m.error ? { borderColor: 'var(--danger)' } : undefined}>
              {m.pending && !m.content ? (
                <span className="ai-thinking">
                  <span className="dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  denkt nach …
                </span>
              ) : (
                <Md text={m.content} />
              )}
            </div>
          ),
        )}
        {msgs.length ? (
          <div className="ai-note">
            <Icon name="info" size={13} />
            <span>{AI_DISCLAIMER}</span>
          </div>
        ) : null}
        {msgs.length && !busy ? (
          <div>
            <Btn small kind="ghost" icon="trash" onClick={() => setMsgs([])}>
              Unterhaltung leeren
            </Btn>
          </div>
        ) : null}
        <div ref={end} />
      </div>
    </Drawer>
  );
}
