// Reference data: trades (Gewerke) with typical building components and service lives,
// room types, project kinds and statuses, and the funding knowledge base for the AI prompts.

// life = typical service life in years (orientation: BBSR "Nutzungsdauern von Bauteilen")
export const GEWERKE = [
  {
    key: 'rohbau', name: 'Rohbau & Tragwerk', icon: 'wall', target: 'facade',
    items: [
      { name: 'Fundament / Bodenplatte', life: 100 },
      { name: 'Tragende Außenwände', life: 100 },
      { name: 'Geschossdecken', life: 100 },
      { name: 'Innentreppe', life: 60 },
      { name: 'Balkon / Loggia', life: 50 },
    ],
  },
  {
    key: 'dach', name: 'Dach', icon: 'roof', target: 'roof',
    items: [
      { name: 'Dachstuhl / Tragwerk', life: 80 },
      { name: 'Dacheindeckung', life: 50 },
      { name: 'Dachdämmung', life: 40 },
      { name: 'Unterspannbahn / Luftdichtheit', life: 40 },
      { name: 'Dachentwässerung (Rinnen, Fallrohre)', life: 30 },
      { name: 'Dachfenster / Gauben', life: 30 },
      { name: 'Schornstein', life: 50 },
      { name: 'Oberste Geschossdecke (Dämmung)', life: 40 },
      { name: 'Blitzschutz', life: 40 },
    ],
  },
  {
    key: 'fassade', name: 'Fassade & Außenwand', icon: 'facade', target: 'facade',
    items: [
      { name: 'Außenputz / Verkleidung', life: 40 },
      { name: 'Fassadendämmung (WDVS)', life: 40 },
      { name: 'Fassadenanstrich', life: 15 },
      { name: 'Sockel / Spritzwasserschutz', life: 30 },
      { name: 'Fensterbänke außen', life: 40 },
    ],
  },
  {
    key: 'fenster', name: 'Fenster & Außentüren', icon: 'window', target: 'windows',
    items: [
      { name: 'Fenster', life: 40 },
      { name: 'Haustür', life: 35 },
      { name: 'Terrassen- / Balkontür', life: 40 },
      { name: 'Rollläden / Raffstores', life: 25 },
      { name: 'Garagentor', life: 30 },
      { name: 'Insektenschutz', life: 15 },
    ],
  },
  {
    key: 'keller', name: 'Keller & Abdichtung', icon: 'basement', target: 'floor:lowest',
    items: [
      { name: 'Kellerabdichtung außen', life: 50 },
      { name: 'Drainage', life: 30 },
      { name: 'Kellerdecke (Dämmung)', life: 40 },
      { name: 'Lichtschächte / Kellerfenster', life: 40 },
      { name: 'Kellertreppe außen', life: 50 },
    ],
  },
  {
    key: 'heizung', name: 'Heizung & Warmwasser', icon: 'flame', target: 'room:technik',
    items: [
      { name: 'Wärmeerzeuger', life: 20 },
      { name: 'Warmwasserbereitung / Speicher', life: 20 },
      { name: 'Heizkörper', life: 40 },
      { name: 'Fußbodenheizung', life: 50 },
      { name: 'Heizungsrohre / Verteilung', life: 50 },
      { name: 'Heizungspumpe', life: 15 },
      { name: 'Regelung / Thermostate', life: 15 },
      { name: 'Öltank / Brennstofflager', life: 30 },
      { name: 'Abgasanlage', life: 30 },
      { name: 'Kamin- / Kaminofen', life: 30 },
    ],
  },
  {
    key: 'lueftung', name: 'Lüftung & Klima', icon: 'wind', target: 'facade',
    items: [
      { name: 'Lüftungsanlage mit WRG', life: 20 },
      { name: 'Abluftventilatoren (Bad/Küche)', life: 15 },
      { name: 'Klimagerät', life: 15 },
    ],
  },
  {
    key: 'sanitaer', name: 'Sanitär & Wasser', icon: 'droplet', target: 'room:bad',
    items: [
      { name: 'Hausanschluss Wasser', life: 50 },
      { name: 'Trinkwasserleitungen', life: 40 },
      { name: 'Abwasserleitungen', life: 50 },
      { name: 'Bad', life: 30 },
      { name: 'Gäste-WC', life: 30 },
      { name: 'Enthärtung / Filter', life: 15 },
      { name: 'Hebeanlage / Rückstauklappe', life: 20 },
      { name: 'Regenwassernutzung / Zisterne', life: 30 },
    ],
  },
  {
    key: 'elektro', name: 'Elektro & Kommunikation', icon: 'bolt', target: 'room:technik',
    items: [
      { name: 'Hausanschluss / Zähler', life: 40 },
      { name: 'Zählerschrank / Unterverteilung', life: 35 },
      { name: 'Elektroleitungen', life: 40 },
      { name: 'FI-Schutzschalter (RCD)', life: 25 },
      { name: 'Potentialausgleich / Erdung', life: 50 },
      { name: 'Beleuchtung', life: 20 },
      { name: 'Netzwerk / Glasfaser / Telefon', life: 20 },
      { name: 'Smart Home', life: 12 },
      { name: 'Wallbox', life: 15 },
      { name: 'Klingel / Sprechanlage', life: 20 },
    ],
  },
  {
    key: 'solar', name: 'Photovoltaik & Solarthermie', icon: 'sun', target: 'roof',
    items: [
      { name: 'PV-Module', life: 30 },
      { name: 'Wechselrichter', life: 15 },
      { name: 'Batteriespeicher', life: 15 },
      { name: 'Solarthermie', life: 25 },
      { name: 'Balkonkraftwerk', life: 25 },
    ],
  },
  {
    key: 'innenausbau', name: 'Innenausbau & Trockenbau', icon: 'room', target: 'floor',
    items: [
      { name: 'Innentüren', life: 40 },
      { name: 'Innenputz', life: 50 },
      { name: 'Trockenbauwände / Decken', life: 40 },
      { name: 'Innentreppe Belag', life: 30 },
      { name: 'Einbauküche', life: 20 },
    ],
  },
  {
    key: 'boden', name: 'Bodenbeläge & Estrich', icon: 'floor', target: 'floor',
    items: [
      { name: 'Estrich', life: 50 },
      { name: 'Parkett', life: 40 },
      { name: 'Laminat / Vinyl', life: 20 },
      { name: 'Teppich', life: 12 },
      { name: 'Fliesenboden', life: 40 },
    ],
  },
  {
    key: 'maler', name: 'Maler & Fliesen', icon: 'brush', target: 'floor',
    items: [
      { name: 'Innenanstrich / Tapeten', life: 10 },
      { name: 'Wandfliesen', life: 35 },
      { name: 'Lackierung Holzbauteile', life: 10 },
    ],
  },
  {
    key: 'sicherheit', name: 'Sicherheit & Brandschutz', icon: 'shield', target: 'floor',
    items: [
      { name: 'Rauchwarnmelder', life: 10 },
      { name: 'CO-Melder', life: 7 },
      { name: 'Einbruchschutz', life: 30 },
      { name: 'Alarmanlage', life: 15 },
      { name: 'Feuerlöscher', life: 10 },
    ],
  },
  {
    key: 'aussen', name: 'Außenanlagen', icon: 'tree', target: 'plot',
    items: [
      { name: 'Zufahrt / Pflaster', life: 30 },
      { name: 'Terrasse', life: 30 },
      { name: 'Zaun / Tor', life: 25 },
      { name: 'Garage / Carport', life: 50 },
      { name: 'Gartenhaus', life: 30 },
      { name: 'Grundstücksentwässerung / Kanal', life: 50 },
      { name: 'Außenbeleuchtung', life: 20 },
    ],
  },
  {
    key: 'schadstoffe', name: 'Schadstoffe & Gutachten', icon: 'alert', target: 'facade',
    items: [
      { name: 'Asbest (z. B. Eternit, Floor-Flex)', life: null },
      { name: 'Holzschutzmittel / PCB', life: null },
      { name: 'Schimmel / Feuchte', life: null },
      { name: 'Radon', life: null },
      { name: 'Energieausweis', life: 10 },
      { name: 'Schornsteinfeger-Messung', life: 1 },
    ],
  },
];

export const gewerk = (key) => GEWERKE.find((g) => g.key === key) || { key, name: key || 'Sonstiges', icon: 'wrench', items: [] };

export const CONDITION = [
  { v: 1, name: 'Neuwertig' },
  { v: 2, name: 'Gut' },
  { v: 3, name: 'Gebrauchsspuren' },
  { v: 4, name: 'Mangelhaft' },
  { v: 5, name: 'Defekt / kritisch' },
];

export const ROOM_TYPES = [
  { key: 'wohnen', name: 'Wohnen / Essen', living: true },
  { key: 'kueche', name: 'Küche', living: true },
  { key: 'schlafen', name: 'Schlafen', living: true },
  { key: 'kind', name: 'Kinderzimmer', living: true },
  { key: 'arbeiten', name: 'Arbeiten', living: true },
  { key: 'bad', name: 'Bad / WC', living: true },
  { key: 'flur', name: 'Flur / Diele', living: true },
  { key: 'abstell', name: 'Abstellraum', living: true },
  { key: 'hwr', name: 'Hauswirtschaft', living: false },
  { key: 'technik', name: 'Technik / Heizung', living: false },
  { key: 'keller', name: 'Keller / Lager', living: false },
  { key: 'garage', name: 'Garage', living: false },
  { key: 'dachboden', name: 'Dachboden', living: false },
  { key: 'balkon', name: 'Balkon / Terrasse', living: true, factor: 0.25 },
  { key: 'sonstiges', name: 'Sonstiges', living: true },
];
export const ROOM_COLORS = {
  wohnen: '#d9e8d2', kueche: '#f3e3c7', schlafen: '#dcdcf2', kind: '#f2dce4', arbeiten: '#d7e6ef', bad: '#cfe7ec',
  flur: '#ebe7df', abstell: '#e6e2da', hwr: '#e2e6e9', technik: '#e9e0d6', keller: '#e4e2dd', garage: '#dfdfdf',
  dachboden: '#ece6da', balkon: '#e3ecd9', sonstiges: '#e8e6e2',
};
export const roomType = (key) => ROOM_TYPES.find((t) => t.key === key) || ROOM_TYPES[ROOM_TYPES.length - 1];

export const PROJECT_KINDS = [
  { key: 'pv', name: 'Photovoltaik / Speicher', gewerk: 'solar', icon: 'sun', target: 'roof' },
  { key: 'heizung', name: 'Heizungstausch', gewerk: 'heizung', icon: 'flame', target: 'room:technik' },
  { key: 'dach', name: 'Dachsanierung', gewerk: 'dach', icon: 'roof', target: 'roof' },
  { key: 'fassade', name: 'Fassade / Dämmung', gewerk: 'fassade', icon: 'facade', target: 'facade' },
  { key: 'fenster', name: 'Fenster & Türen', gewerk: 'fenster', icon: 'window', target: 'windows' },
  { key: 'daemmung', name: 'Dämmung Decke / Keller', gewerk: 'keller', icon: 'layers', target: 'floor:lowest' },
  { key: 'elektro', name: 'Elektrik', gewerk: 'elektro', icon: 'bolt', target: 'room:technik' },
  { key: 'sanitaer', name: 'Bad / Sanitär', gewerk: 'sanitaer', icon: 'droplet', target: 'room:bad' },
  { key: 'lueftung', name: 'Lüftung', gewerk: 'lueftung', icon: 'wind', target: 'facade' },
  { key: 'innen', name: 'Innenausbau', gewerk: 'innenausbau', icon: 'room', target: 'floor' },
  { key: 'aussen', name: 'Außenanlagen', gewerk: 'aussen', icon: 'tree', target: 'plot' },
  { key: 'sonstiges', name: 'Sonstiges', gewerk: 'rohbau', icon: 'wrench', target: 'house' },
];
export const projectKind = (key) => PROJECT_KINDS.find((k) => k.key === key) || PROJECT_KINDS[PROJECT_KINDS.length - 1];

export const STATUS = [
  { key: 'idee', name: 'Idee', step: 0 },
  { key: 'planung', name: 'Planung', step: 1 },
  { key: 'angebote', name: 'Angebote', step: 2 },
  { key: 'beauftragt', name: 'Beauftragt', step: 3 },
  { key: 'umsetzung', name: 'In Umsetzung', step: 4 },
  { key: 'abgeschlossen', name: 'Abgeschlossen', step: 5 },
  { key: 'pausiert', name: 'Pausiert', step: -1 },
];
export const status = (key) => STATUS.find((s) => s.key === key) || STATUS[0];

export const CONSTRAINT_KINDS = [
  { key: 'genehmigung', name: 'Genehmigung / Bauakte' },
  { key: 'objekt', name: 'Exposé / Objektunterlagen' },
  { key: 'finanzierung', name: 'Finanzierung' },
  { key: 'technisch', name: 'Technisch' },
  { key: 'saison', name: 'Jahreszeit / Wetter' },
  { key: 'finanziell', name: 'Finanziell' },
  { key: 'rechtlich', name: 'Gesetzlich / Pflicht' },
  { key: 'organisatorisch', name: 'Organisatorisch' },
];

export const FUNDING_TYPES = [
  { key: 'zuschuss', name: 'Zuschuss' },
  { key: 'kredit', name: 'Kredit' },
  { key: 'steuer', name: 'Steuerbonus' },
  { key: 'verguetung', name: 'Vergütung' },
  { key: 'sonstiges', name: 'Sonstiges' },
];
export const FUNDING_STATUS = [
  { key: 'pruefen', name: 'Zu prüfen' },
  { key: 'geplant', name: 'Geplant' },
  { key: 'beantragt', name: 'Beantragt' },
  { key: 'bewilligt', name: 'Bewilligt' },
  { key: 'ausgezahlt', name: 'Ausgezahlt' },
  { key: 'abgelehnt', name: 'Abgelehnt' },
];

export const DOC_TYPES = [
  { key: 'objekt', name: 'Exposé / Objektunterlagen' },
  { key: 'plan', name: 'Plan / Grundriss' },
  { key: 'foto', name: 'Foto' },
  { key: 'angebot', name: 'Angebot' },
  { key: 'rechnung', name: 'Rechnung' },
  { key: 'vertrag', name: 'Vertrag' },
  { key: 'foerderung', name: 'Förderantrag / Bescheid' },
  { key: 'gutachten', name: 'Gutachten / Ausweis' },
  { key: 'genehmigung', name: 'Genehmigung / Bauakte' },
  { key: 'finanzierung', name: 'Finanzierung' },
  { key: 'sonstiges', name: 'Sonstiges' },
];

export const MEDIA = [
  { key: 'strom', name: 'Strom', unit: 'kWh', heat: false, color: 'var(--c-strom)' },
  { key: 'gas', name: 'Erdgas', unit: 'kWh', heat: true, color: 'var(--c-gas)', alt: { unit: 'm³', factor: 10.3 } },
  { key: 'oel', name: 'Heizöl', unit: 'l', heat: true, color: 'var(--c-oel)', kwh: 10 },
  { key: 'pellets', name: 'Pellets', unit: 'kg', heat: true, color: 'var(--c-oel)', kwh: 4.8 },
  { key: 'fernwaerme', name: 'Fernwärme', unit: 'kWh', heat: true, color: 'var(--c-gas)' },
  { key: 'wp', name: 'Wärmepumpenstrom', unit: 'kWh', heat: true, color: 'var(--c-strom)', wp: true },
  { key: 'wasser', name: 'Wasser', unit: 'm³', heat: false, color: 'var(--c-wasser)' },
  { key: 'pv', name: 'PV-Ertrag', unit: 'kWh', heat: false, color: 'var(--c-pv)', produce: true },
];
export const medium = (key) => MEDIA.find((m) => m.key === key) || MEDIA[0];

// GEG/GModG efficiency classes (kWh/m²a, final energy)
export const ENERGY_CLASSES = [
  { c: 'A+', max: 30, color: '#1e8f4e' },
  { c: 'A', max: 50, color: '#3aa346' },
  { c: 'B', max: 75, color: '#8cc43f' },
  { c: 'C', max: 100, color: '#c7d930' },
  { c: 'D', max: 130, color: '#f2d22e' },
  { c: 'E', max: 160, color: '#f5b02a' },
  { c: 'F', max: 200, color: '#ef8a2b' },
  { c: 'G', max: 250, color: '#e5582a' },
  { c: 'H', max: Infinity, color: '#d22d2a' },
];
export const energyClass = (kwh) => ENERGY_CLASSES.find((e) => kwh < e.max) || ENERGY_CLASSES[ENERGY_CLASSES.length - 1];

export const BUNDESLAENDER = [
  'Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern',
  'Niedersachsen', 'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen', 'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen',
];

export const FUNDING_RESEARCH_DATE = '2026-10-28';

// Research summary given to the AI as context. Compiled from public sources on the date above;
// figures must be checked against the official programme pages before applying.
export const FUNDING_KNOWLEDGE = `
Förder- und Rechtslage Deutschland (Recherche-Stand ${FUNDING_RESEARCH_DATE}, Sekundärquellen, ohne Gewähr – Werte vor Antrag bei KfW/BAFA prüfen):

GESETZ
- Seit 29.07.2026 gilt das Gebäudemodernisierungsgesetz (GModG), es ersetzt das GEG. Die pauschale 65-%-Erneuerbare-Pflicht beim Heizungstausch ist entfallen. Neu eingebaute fossile Heizungen unterliegen einer "Bio-Treppe" (steigender Anteil klimaneutraler Brennstoffe ab 2029, laut Quellen ca. 10 % 2029, 15 % 2030, 30 % 2035, 60 % 2040). Details vor Entscheidung prüfen.
- Nachrüstpflichten nach Eigentümerwechsel (bisher GEG §47/§71/§72, vermutlich fortgeführt – prüfen): innerhalb von 2 Jahren nach Erwerb oberste Geschossdecke bzw. Dach dämmen (falls Mindestwärmeschutz fehlt), ungedämmte Heizungs-/Warmwasserleitungen in unbeheizten Räumen dämmen, Konstanttemperatur-Heizkessel älter als 30 Jahre außer Betrieb nehmen (Ausnahmen: Brennwert-/Niedertemperaturkessel). Beim Kauf ist ein Energieberatungsgespräch vorgesehen.

HEIZUNG – KfW 458 (Zuschuss, Antrag VOR Vorhabenbeginn; Liefer-/Leistungsvertrag mit auflösender/aufschiebender Bedingung der Förderzusage darf vorher geschlossen werden)
- Seit 21.07.2026: Grundförderung 30 %; Klimageschwindigkeitsbonus 16 % für selbstnutzende Eigentümer beim Ersatz funktionstüchtiger Öl-, Kohle-, Nachtspeicher- oder Gasheizungen (Gas/Biomasse älter als 20 Jahre); Einkommensbonus gestaffelt bis 40 % (zu versteuerndes Haushaltseinkommen bis 40.000 €; Quellen nennen Staffel 40/30/10 %); Effizienzbonus 5 % für Wärmepumpen mit natürlichem Kältemittel oder Erd-/Wasser-/Abwasserwärme (früherer Stand, prüfen).
- Deckel laut Quellen 70 % (bis 80 % bei niedrigem Einkommen, Angaben uneinheitlich); förderfähige Kosten 1. Wohneinheit 28.000 € (vorher 30.000 €).
- Klimabonus sinkt ab 01.02.2027 halbjährlich um 4 Prozentpunkte und entfällt für Anträge ab 01.08.2028 → früh beantragen lohnt sich. Eine Absenkung der Grundförderung ab 2027 wird diskutiert (unbestätigt).
- KfW 358/359 Ergänzungskredit für den Eigenanteil (Zinsverbilligung abhängig vom Einkommen).
- KfW 458 und BAFA BEG EM nicht für dieselbe Maßnahme kombinierbar.

GEBÄUDEHÜLLE & ANLAGENTECHNIK – BAFA BEG Einzelmaßnahmen (Zuschuss, Antrag VOR Vorhabenbeginn, Energieeffizienz-Experte nötig)
- 15 % Grundförderung für Dämmung von Dach, Außenwand, Kellerdecke/Bodenplatte, Fenster/Außentüren, sommerlichen Wärmeschutz, Lüftungsanlagen, Heizungsoptimierung (hydraulischer Abgleich).
- iSFP-Bonus 5 % (mit individuellem Sanierungsfahrplan) gilt seit 21.07.2026 nur noch für förderfähige Kosten oberhalb von 30.000 €. Höchstgrenze förderfähiger Kosten: 30.000 €/Wohneinheit ohne iSFP, 60.000 € mit iSFP. Mindestinvestition 2.000 € (Heizungsoptimierung 300 €).
- Fachplanung und Baubegleitung: 50 % Zuschuss. Ein Worst-Performing-Building-Bonus für Hüllenmaßnahmen ist ab Q1 2027 angekündigt (unbestätigt).
- Energieberatung für Wohngebäude (iSFP): 50 % Zuschuss, max. ca. 650 € (EFH).

KOMPLETTSANIERUNG – KfW 261 Effizienzhaus (Kredit mit Tilgungszuschuss; bis 150.000 € je WE mit EE/NH-Klasse; Tilgungszuschuss je nach EH-Stufe ca. 5–45 % inkl. Boni, Quellen widersprüchlich).
KAUF – KfW 308 "Jung kauft Alt": zinsverbilligter Kredit für Familien mit Kind beim Kauf eines Bestandsgebäudes der Effizienzklasse F/G/H; seit 03.08.2026 bis 180.000 €, Einzelmaßnahmen statt EH-Pflicht möglich; Einkommensgrenze ca. 90.000 € bei 1 Kind (+10.000 € je weiterem Kind, prüfen). Antrag vor Kaufvertrag nötig – nach Kauf meist nicht mehr möglich.

STEUER
- § 35c EStG: 20 % der Kosten energetischer Einzelmaßnahmen am selbstgenutzten Wohngebäude (älter als 10 Jahre), verteilt auf 3 Jahre (7/7/6 %), max. 40.000 € je Objekt; Fachunternehmer-Bescheinigung; für Maßnahmen bis 31.12.2029; nicht kombinierbar mit BEG/KfW-Förderung für dieselbe Maßnahme.
- § 35a EStG: 20 % der Arbeitskosten von Handwerkerleistungen, max. 1.200 €/Jahr (nicht für bereits geförderte Maßnahmen).

PHOTOVOLTAIK
- Kein Bundeszuschuss. 0 % Umsatzsteuer auf Lieferung/Installation von PV inkl. Speicher bis 30 kWp auf/an Wohngebäuden; Einkommensteuerbefreiung bis 30 kWp.
- EEG-Einspeisevergütung für Inbetriebnahme 01.08.2026–31.01.2027 bis 10 kWp ca. 7,7 ct/kWh (Teileinspeisung) bzw. ca. 12,2 ct/kWh (Volleinspeisung); Degression halbjährlich (01.02./01.08.). Satz gilt 20 Jahre ab Inbetriebnahme.
- Solarspitzengesetz: keine Vergütung bei negativen Börsenpreisen (Stunden werden angehängt); ohne Steuerbox Einspeisebegrenzung 60 % für Neuanlagen ab 7 kWp → Speicher und Eigenverbrauch wichtiger.
- EEG-Reform 2027 geplant: feste Vergütung für Neuanlagen unter 25 kWp könnte entfallen (Übergangszahlung im Gespräch) – Inbetriebnahme vor Inkrafttreten kann vorteilhaft sein.
- KfW 270 Kredit (Erneuerbare Energien Standard) für PV und Speicher. Regionale Zuschüsse (Land, Kommune, Stadtwerke) für Speicher, Balkonkraftwerke, Gründach – je nach Ort prüfen.
- Pflichten: Anmeldung beim Netzbetreiber vor Inbetriebnahme, Marktstammdatenregister binnen 1 Monat.

SONSTIGES
- KfW 159 Kredit Altersgerecht Umbauen / Einbruchschutz (Zuschuss 455-B/455-E meist ohne Mittel).
- Viele Bundesländer und Kommunen haben eigene Programme (z. B. Zuschüsse für Speicher, Wallbox, Gründach, Zisternen, Heizungstausch); Fristen und Budgets ändern sich häufig.
- Grundregel: Förderanträge (KfW/BAFA) fast immer VOR Auftragsvergabe bzw. Baubeginn stellen; Energieeffizienz-Experte frühzeitig einbinden (Wartezeiten mehrere Wochen).
`.trim();

// Installation lines drawn into the floor plans (cables, pipes, ducts).
// r = tube radius in the 3D model (exaggerated a little so they stay visible), z = default height above the floor.
export const LINE_KINDS = [
  { key: 'strom', name: 'Strom', color: '#e8b10b', r: 0.022, z: 0.3 },
  { key: 'netzwerk', name: 'Netzwerk / Telefon', color: '#8e5cd9', r: 0.02, z: 0.3 },
  { key: 'wasser', name: 'Trinkwasser kalt', color: '#2f80ed', r: 0.028, z: 0.25 },
  { key: 'warmwasser', name: 'Trinkwasser warm', color: '#e5484d', r: 0.028, z: 0.3 },
  { key: 'heizung', name: 'Heizung', color: '#ef6c00', r: 0.032, z: 0.15 },
  { key: 'abwasser', name: 'Abwasser', color: '#7d838c', r: 0.05, z: 0.08 },
  { key: 'gas', name: 'Gas', color: '#a3712a', r: 0.028, z: 0.2 },
  { key: 'lueftung', name: 'Lüftung', color: '#2fa39a', r: 0.07, z: null },
];
export const lineKind = (k) => LINE_KINDS.find((x) => x.key === k) || LINE_KINDS[0];
// Installation zones for cables in walls (DIN 18015-3), used as height presets.
export const LINE_ZONES = [
  { key: 'boden', name: 'Im Fußboden', z: () => 0.05 },
  { key: 'unten', name: 'Untere Zone (30 cm)', z: () => 0.3 },
  { key: 'mitte', name: 'Mittlere Zone (1,15 m)', z: () => 1.15 },
  { key: 'oben', name: 'Obere Zone (30 cm unter Decke)', z: (f) => Math.max(0.5, (f?.height ?? 2.75) - (f?.slab ?? 0.2) - 0.3) },
];
