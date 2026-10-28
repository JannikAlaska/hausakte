// Starter house ("Beispielhaus"): a 1970s single-family home with basement, two storeys and gable roof.
// Every record carries example: true so the UI can mark it until the owner replaces it.

import { faceAt, roomInnerPolygon, polyArea } from './geometry.js';
import { uid } from './util.js';

let n = 0;
const id = (p) => `${p}${(++n).toString(36)}${uid().slice(0, 4)}`;

function wall(a, b, t, ext = false, openings = []) {
  return { id: id('w'), a, b, t, ext, openings: openings.map((o) => ({ id: id('o'), ...o })) };
}
const win = (pos, w, h, sill) => ({ type: 'window', pos, w, h, sill });
const door = (pos, w = 0.885, h = 2.01) => ({ type: 'door', pos, w, h, sill: 0 });
const pass = (pos, w, h = 2.1) => ({ type: 'opening', pos, w, h, sill: 0 });

function rooms(walls, defs) {
  return defs
    .map(([name, type, seed]) => {
      const f = faceAt(seed, walls);
      if (!f) return null;
      const poly = roomInnerPolygon(f.poly, walls);
      return { id: id('r'), name, type, poly, area: null, notes: '', example: true, area0: Math.abs(polyArea(poly)) };
    })
    .filter(Boolean)
    .map(({ area0, ...r }) => r);
}

export function createTemplate() {
  n = 0;
  const E = 0.365; // exterior wall
  const extRect = (o) => [
    wall([0, 0], [10, 0], E, true, o.n || []),
    wall([10, 0], [10, 8.5], E, true, o.e || []),
    wall([10, 8.5], [0, 8.5], E, true, o.s || []),
    wall([0, 8.5], [0, 0], E, true, o.w || []),
  ];

  // --- KG ---
  const kgWalls = [
    ...extRect({
      n: [win(2.0, 0.8, 0.5, 1.6), win(8.0, 0.8, 0.5, 1.6)],
      e: [win(2.0, 0.8, 0.5, 1.6)],
      s: [win(2.5, 0.8, 0.5, 1.6), win(7.5, 0.8, 0.5, 1.6)],
      w: [win(2.25, 0.8, 0.5, 1.6)],
    }).map((w) => ({ ...w, t: 0.3 })),
    wall([5, 0], [5, 8.5], 0.24, false, [door(2.6, 0.885), door(6.0, 0.885)]),
    wall([0, 4], [5, 4], 0.175, false, [door(4.0, 0.885)]),
    wall([5, 3.5], [10, 3.5], 0.175, false, [door(1.2, 0.885)]),
  ];
  const kg = {
    id: 'f-kg', name: 'Kellergeschoss', short: 'KG', level: -1, elevation: -2.45, height: 2.45, slab: 0.2,
    walls: kgWalls, items: [], example: true,
    rooms: rooms(kgWalls, [
      ['Heizung', 'technik', [2.5, 2]],
      ['Hauswirtschaft', 'hwr', [7.5, 1.75]],
      ['Keller', 'keller', [2.5, 6.25]],
      ['Werkstatt', 'keller', [7.5, 6]],
    ]),
  };

  // --- EG ---
  const egWalls = [
    ...extRect({
      n: [win(1.8, 1.26, 1.26, 0.9), door(5.2, 1.1, 2.2), win(6.8, 0.6, 0.8, 1.4), win(8.8, 1.26, 1.135, 1.0)],
      e: [win(2.0, 1.01, 1.26, 0.9), win(6.2, 1.51, 1.385, 0.75)],
      s: [door(3.0, 2.01, 2.135), win(7.0, 2.01, 1.385, 0.75)],
      w: [win(2.25, 1.26, 1.385, 0.75), win(6.5, 1.01, 1.26, 0.9)],
    }),
    wall([3.5, 0], [3.5, 4], 0.175, false, [door(3.0)]),
    wall([6, 0], [6, 4], 0.175, false, [door(0.9, 0.76), door(3.0)]),
    wall([0, 4], [6, 4], 0.24, false, [door(4.75, 1.01)]),
    wall([6, 4], [10, 4], 0.115, false, [pass(1.0, 1.5)]),
    wall([6, 1.8], [7.6, 1.8], 0.115),
    wall([7.6, 0], [7.6, 1.8], 0.115),
  ];
  const eg = {
    id: 'f-eg', name: 'Erdgeschoss', short: 'EG', level: 0, elevation: 0, height: 2.75, slab: 0.2,
    walls: egWalls, example: true,
    items: [{ id: id('s'), type: 'stairs', x: 3.62, y: 0.3, w: 1.0, l: 3.55, dir: 'n' }],
    rooms: rooms(egWalls, [
      ['Arbeiten', 'arbeiten', [1.75, 2]],
      ['Diele', 'flur', [4.75, 2]],
      ['Gäste-WC', 'bad', [6.8, 0.9]],
      ['Küche', 'kueche', [8.8, 2.6]],
      ['Wohnen / Essen', 'wohnen', [5, 6.25]],
    ]),
  };

  // --- OG ---
  const ogWalls = [
    ...extRect({
      n: [win(1.8, 1.26, 1.26, 0.9), win(8.0, 1.01, 1.01, 1.2)],
      e: [win(6.25, 1.26, 1.26, 0.9)],
      s: [win(2.5, 1.51, 1.385, 0.75), win(7.5, 1.51, 1.385, 0.75)],
      w: [win(2.25, 1.01, 1.26, 0.9), win(6.5, 1.01, 1.26, 0.9)],
    }),
    wall([3.5, 0], [3.5, 4], 0.175, false, [door(3.0)]),
    wall([6, 0], [6, 4], 0.175, false, [door(3.2)]),
    wall([0, 4], [10, 4], 0.24, false, [door(4.2), door(5.6)]),
    wall([5, 4], [5, 8.5], 0.115),
  ];
  const og = {
    id: 'f-og', name: 'Obergeschoss', short: 'OG', level: 1, elevation: 2.75, height: 2.75, slab: 0.2,
    walls: ogWalls, items: [], example: true,
    rooms: rooms(ogWalls, [
      ['Kind 1', 'kind', [1.75, 2]],
      ['Flur', 'flur', [4.75, 2]],
      ['Bad', 'bad', [8, 2]],
      ['Schlafen', 'schlafen', [2.5, 6.25]],
      ['Kind 2', 'kind', [7.5, 6.25]],
    ]),
  };

  const house = {
    id: 'main',
    example: true,
    name: 'Beispielhaus',
    street: '',
    zip: '',
    city: '',
    state: '',
    buildYear: 1978,
    purchaseDate: '',
    houseType: 'EFH',
    construction: 'Massivbau (Mauerwerk)',
    units: 1,
    plotArea: 780,
    persons: 3,
    selfUse: true,
    northAngle: 0,
    livingAreaOverride: null,
    heritage: false,
    energyCert: { kind: 'Bedarfsausweis', cls: 'F', value: 182, validUntil: '' },
    notes: '',
    model: {
      groundLevel: -0.55,
      facadeColor: '#f1efe9',
      roofColor: '#6b5f5a',
      plot: { x: -7, y: -9, w: 25, d: 31 },
      roofSections: [{ id: 'rs1', x: -0.18, y: -0.18, w: 10.365, d: 8.865, type: 'gable', pitch: 38, ridge: 'x', overhang: 0.45, base: null }],
    },
  };

  const C = (gewerk, name, material, year, life, condition, extra = {}) => ({
    id: id('c'), gewerk, name, material, year, life, condition, maker: '', qty: null, unit: '', uValue: null,
    floorId: null, roomId: null, notes: '', example: true, ...extra,
  });
  const components = [
    C('dach', 'Dacheindeckung', 'Betondachsteine, anthrazit', 1978, 50, 3, { qty: 152, unit: 'm²' }),
    C('dach', 'Dachdämmung', 'Zwischensparren Mineralwolle 8 cm', 1978, 40, 4, { uValue: 0.55 }),
    C('dach', 'Dachentwässerung (Rinnen, Fallrohre)', 'Titanzink', 1996, 30, 3),
    C('dach', 'Oberste Geschossdecke (Dämmung)', 'Holzbalkendecke, 6 cm Dämmung', 1978, 40, 4),
    C('fassade', 'Außenputz / Verkleidung', 'Kalkzementputz auf Poroton 36,5', 1978, 40, 3, { uValue: 0.79 }),
    C('fassade', 'Fassadenanstrich', 'Silikonharzfarbe', 2011, 15, 3),
    C('fenster', 'Fenster', 'Kunststoff, 2-fach-Isolierglas', 1993, 40, 3, { uValue: 2.8, qty: 15, unit: 'Stk' }),
    C('fenster', 'Haustür', 'Aluminium mit Glaseinsatz', 1993, 35, 3),
    C('fenster', 'Rollläden / Raffstores', 'Kunststoffpanzer, Gurtwickler', 1978, 25, 4),
    C('keller', 'Kellerabdichtung außen', 'Bitumen-Dickbeschichtung', 1978, 50, 3),
    C('keller', 'Kellerdecke (Dämmung)', 'Stahlbeton, ungedämmt', 1978, 40, 4),
    C('heizung', 'Wärmeerzeuger', 'Gas-Niedertemperaturkessel 24 kW', 2001, 20, 4, { roomId: kg.rooms[0]?.id, floorId: 'f-kg' }),
    C('heizung', 'Warmwasserbereitung / Speicher', 'Speicher 150 l, indirekt beheizt', 2001, 20, 3, { roomId: kg.rooms[0]?.id, floorId: 'f-kg' }),
    C('heizung', 'Heizkörper', 'Rippen- und Kompaktheizkörper', 1978, 40, 3, { qty: 14, unit: 'Stk' }),
    C('elektro', 'Zählerschrank / Unterverteilung', 'Altanlage, Schraubsicherungen, ohne RCD', 1978, 35, 5, { roomId: kg.rooms[0]?.id, floorId: 'f-kg' }),
    C('elektro', 'Elektroleitungen', 'Stegleitung unter Putz, 2-adrig teilweise', 1978, 40, 4),
    C('sanitaer', 'Trinkwasserleitungen', 'Verzinkter Stahl', 1978, 40, 4),
    C('sanitaer', 'Bad', 'Fliesen beige, Wanne', 1994, 30, 3, { roomId: og.rooms.find((r) => r.type === 'bad')?.id, floorId: 'f-og' }),
    C('sicherheit', 'Rauchwarnmelder', '10-Jahres-Batterie', 2017, 10, 2, { qty: 7, unit: 'Stk' }),
  ];

  const P = (o) => ({
    id: o.id, title: '', kind: 'sonstiges', status: 'idee', priority: 2, start: null, end: null,
    dependsOn: [], milestones: [], constraints: [], costs: [], funding: [], documents: [],
    components: [], notes: '', ai: {}, example: true, createdAt: Date.now(), ...o,
  });
  const ms = (title, date, done = false) => ({ id: id('m'), title, date, done });
  const cst = (label, estimate, offer = null, actual = null) => ({ id: id('k'), label, estimate, offer, actual, vendor: '' });
  const con = (text, kind, done = false) => ({ id: id('b'), text, kind, done });
  const fund = (o) => ({ id: id('g'), program: '', provider: '', type: 'zuschuss', rate: null, amount: null, deadline: null, status: 'pruefen', notes: '', source: 'manuell', ...o });

  const projects = [
    P({
      id: 'p-elektro', title: 'Zählerschrank & Unterverteilung erneuern', kind: 'elektro', status: 'umsetzung', priority: 1,
      start: '2026-09-28', end: '2026-10-23',
      notes: 'Voraussetzung für PV-Anlage und Wärmepumpe (Zählerplatz nach TAR, Platz für Smart Meter).',
      milestones: [ms('Begehung Elektriker', '2026-09-22', true), ms('Termin Netzbetreiber Zählerwechsel', '2026-10-21')],
      costs: [cst('Zählerschrank inkl. APZ-Feld', 3200, 3480), cst('Unterverteilungen EG/OG mit RCD', 2100, 2260), cst('Anmeldung Netzbetreiber', 150)],
      constraints: [con('Termin Netzbetreiber für Zählerwechsel abstimmen', 'organisatorisch'), con('Stromabschaltung 1 Tag einplanen', 'organisatorisch', true)],
    }),
    P({
      id: 'p-dach', title: 'Dach neu eindecken und dämmen', kind: 'dach', status: 'umsetzung', priority: 1,
      start: '2026-10-19', end: '2026-11-27', dependsOn: [],
      notes: 'Aufsparrendämmung 16 cm, neue Unterspannbahn, Ziegel. Gleichzeitig Dachrinnen tauschen.',
      milestones: [ms('Förderantrag BAFA gestellt', '2026-09-15', true), ms('Gerüst stellen', '2026-10-19', true), ms('Abnahme Dachdecker', '2026-11-27')],
      costs: [cst('Gerüst', 2800, 2950), cst('Eindeckung & Lattung', 21000, 22400), cst('Aufsparrendämmung', 14500, 15100), cst('Dachrinnen & Fallrohre', 2400, 2380), cst('Energieberater Baubegleitung', 1800, 1650)],
      constraints: [con('Witterung: Arbeiten ab Dezember wetterabhängig', 'saison'), con('Nachrüstpflicht oberste Geschossdecke nach Kauf (2 Jahre)', 'rechtlich')],
      funding: [fund({ program: 'BEG EM – Gebäudehülle', provider: 'BAFA', type: 'zuschuss', rate: 15, amount: 6200, status: 'bewilligt', deadline: '2026-09-15', notes: 'Zuwendungsbescheid liegt vor.' }), fund({ program: 'BEG EM – Fachplanung/Baubegleitung', provider: 'BAFA', type: 'zuschuss', rate: 50, amount: 825, status: 'bewilligt' })],
    }),
    P({
      id: 'p-pv', title: 'PV-Anlage mit Batteriespeicher', kind: 'pv', status: 'planung', priority: 2,
      start: '2027-01-11', end: '2027-01-22', dependsOn: ['p-dach', 'p-elektro'],
      notes: 'Südseite voll belegen, Speicher ca. 10 kWh im Hauswirtschaftsraum.',
      costs: [cst('Module & Montage', 13500), cst('Wechselrichter', 2200), cst('Batteriespeicher 10 kWh', 6500)],
      constraints: [con('Erst nach Dachsanierung montieren', 'technisch'), con('Anmeldung Netzbetreiber vor Inbetriebnahme', 'rechtlich')],
    }),
    P({
      id: 'p-heizung', title: 'Gaskessel durch Wärmepumpe ersetzen', kind: 'heizung', status: 'idee', priority: 2,
      start: '2027-05-03', end: '2027-06-11', dependsOn: ['p-elektro'],
      notes: 'Luft-Wasser-Wärmepumpe, Heizlastberechnung und hydraulischer Abgleich nötig. Einzelne Heizkörper tauschen.',
      costs: [cst('Wärmepumpe inkl. Installation', 24000), cst('Heizkörpertausch (4 Stk)', 3200), cst('Hydraulischer Abgleich', 900)],
      constraints: [con('Heizlastberechnung vor Auslegung', 'technisch'), con('Aufstellort Außengerät: Abstand Nachbar (Schall)', 'genehmigung')],
    }),
    P({
      id: 'p-bad', title: 'Bad im OG modernisieren', kind: 'sanitaer', status: 'idee', priority: 3,
      start: '2027-09-06', end: '2027-10-15', dependsOn: [],
      costs: [cst('Sanitärinstallation & Objekte', 9000), cst('Fliesen', 5500), cst('Elektro & Lüfter', 1200)],
    }),
  ];

  const R = (medium, year, amount, cost) => ({ id: id('v'), medium, from: `${year}-01-01`, to: `${year}-12-31`, amount, cost, note: '', example: true });
  const readings = [
    R('gas', 2022, 23400, 2480), R('gas', 2023, 21500, 2390), R('gas', 2024, 20100, 2160), R('gas', 2025, 19800, 2090),
    R('strom', 2022, 4350, 1610), R('strom', 2023, 4120, 1580), R('strom', 2024, 3980, 1420), R('strom', 2025, 4050, 1390),
    R('wasser', 2024, 128, 560), R('wasser', 2025, 121, 545),
  ];

  return { house, floors: [kg, eg, og], components, projects, readings, documents: [] };
}

// An empty house with one storey: four exterior walls of 10 x 8 m.
export function createEmptyHouse() {
  n = 0;
  const t = 0.365;
  const walls = [
    wall([0, 0], [10, 0], t, true),
    wall([10, 0], [10, 8], t, true),
    wall([10, 8], [0, 8], t, true),
    wall([0, 8], [0, 0], t, true),
  ];
  const eg = { id: 'f-eg', name: 'Erdgeschoss', short: 'EG', level: 0, elevation: 0, height: 2.75, slab: 0.2, walls, items: [], rooms: [] };
  const house = {
    id: 'main', name: 'Mein Haus', street: '', zip: '', city: '', state: '', buildYear: null, purchaseDate: '', houseType: 'EFH',
    construction: '', units: 1, plotArea: null, persons: null, selfUse: true, northAngle: 0, livingAreaOverride: null, heritage: false,
    energyCert: { kind: '', cls: '', value: null, validUntil: '' }, notes: '',
    model: {
      groundLevel: -0.3, facadeColor: '#f1efe9', roofColor: '#6b5f5a', plot: { x: -6, y: -8, w: 22, d: 26 },
      roofSections: [{ id: 'rs1', x: -t / 2, y: -t / 2, w: 10 + t, d: 8 + t, type: 'gable', pitch: 35, ridge: 'x', overhang: 0.4, base: null }],
    },
  };
  return { house, floors: [eg], components: [], projects: [], readings: [], documents: [] };
}
