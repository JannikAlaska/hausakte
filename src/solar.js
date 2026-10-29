// Sun position, typical-year irradiation and PV self-consumption for the house location.
// Irradiation: clear-sky day shapes scaled to monthly climate values (global horizontal and diffuse share).

const RAD = Math.PI / 180;
export const DEFAULT_GEO = { lat: 51.16, lon: 10.45 }; // centre of Germany
export const houseGeo = (house) => (house?.geo?.lat ? house.geo : DEFAULT_GEO);

// Global horizontal irradiation per month (kWh/m²) and diffuse share, northern Harz foreland (PVGIS-like).
export const CLIMATE = {
  ghi: [22, 38, 74, 117, 146, 150, 151, 128, 89, 54, 25, 16],
  diffuse: [0.7, 0.62, 0.55, 0.5, 0.48, 0.48, 0.48, 0.48, 0.52, 0.6, 0.68, 0.72],
};
export const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MID_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

// ---------- time ----------
function lastSunday(year, month) {
  const d = new Date(Date.UTC(year, month + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}
// Europe/Berlin: CET +1, CEST +2 from the last Sunday in March to the last Sunday in October (01:00 UTC)
export function berlinOffset(dateUtc) {
  const y = dateUtc.getUTCFullYear();
  const a = lastSunday(y, 2),
    b = lastSunday(y, 9);
  a.setUTCHours(1);
  b.setUTCHours(1);
  return dateUtc >= a && dateUtc < b ? 2 : 1;
}
export function localToUtc(year, doy, minutes) {
  const base = Date.UTC(year, 0, 1) + (doy - 1) * 864e5 + minutes * 6e4;
  const off = berlinOffset(new Date(base - 3600e3));
  return new Date(base - off * 3600e3);
}
export function doyOf(date) {
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / 864e5) + 1;
}
export function dateOfDoy(year, doy) {
  return new Date(Date.UTC(year, 0, 1) + (doy - 1) * 864e5);
}

// ---------- sun position (low-precision solar ephemeris, good to ~0.5°) ----------
export function sunPosition(dateUtc, lat, lon) {
  const d = dateUtc.getTime() / 864e5 - 10957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const H = (gmst * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { altitude: alt / RAD, azimuth: ((az / RAD) % 360 + 360) % 360 };
}

// Unit vector towards the sun in world space (x = plan x, y = up, z = plan y) for a plan rotated by northAngle.
export function sunVector(pos, northAngle = 0) {
  const th = (pos.azimuth - northAngle) * RAD;
  const ca = Math.cos(pos.altitude * RAD);
  return [Math.sin(th) * ca, Math.sin(pos.altitude * RAD), -Math.cos(th) * ca];
}

// Sunrise and sunset (local minutes) by scanning the day.
export function sunTimes(year, doy, geo) {
  let rise = null,
    set = null,
    prev = null;
  for (let m = 0; m <= 1440; m += 5) {
    const a = sunPosition(localToUtc(year, doy, m), geo.lat, geo.lon).altitude > -0.83;
    if (prev !== null && a && !prev && rise == null) rise = m;
    if (prev !== null && !a && prev) set = m;
    prev = a;
  }
  return { rise, set };
}

// ---------- irradiation ----------
function clearDni(alt) {
  if (alt <= 0.5) return 0;
  const am = 1 / (Math.sin(alt * RAD) + 0.50572 * Math.pow(alt + 6.07995, -1.6364));
  return 1353 * Math.pow(0.7, Math.pow(am, 0.678));
}

// Time steps for a typical day of every month with the sun position and scaled beam/diffuse (W/m²).
export function yearSteps(geo, northAngle = 0, stepMin = 20, year = 2027) {
  const months = [];
  for (let m = 0; m < 12; m++) {
    const steps = [];
    let sb = 0,
      sd = 0;
    for (let min = stepMin / 2; min < 1440; min += stepMin) {
      const pos = sunPosition(localToUtc(year, MID_DOY[m], min), geo.lat, geo.lon);
      if (pos.altitude <= 1) continue;
      const dni = clearDni(pos.altitude);
      const sinA = Math.sin(pos.altitude * RAD);
      sb += dni * sinA;
      sd += sinA;
      steps.push({ min, pos, dni, sinA, vec: sunVector(pos, northAngle) });
    }
    const h = stepMin / 60;
    const beamDay = (CLIMATE.ghi[m] * (1 - CLIMATE.diffuse[m]) * 1000) / DAYS[m]; // Wh/m² per day
    const diffDay = (CLIMATE.ghi[m] * CLIMATE.diffuse[m] * 1000) / DAYS[m];
    const cb = sb ? beamDay / (sb * h) : 0,
      cd = sd ? diffDay / (sd * h) : 0;
    for (const s of steps) {
      s.beamN = s.dni * cb; // W/m² normal to the sun
      s.diffH = s.sinA * cd; // W/m² diffuse on the horizontal
    }
    months.push({ month: m, days: DAYS[m], hours: h, steps });
  }
  return months;
}

// Irradiance on a tilted plane for one step (W/m²); shaded removes the beam part.
export function poa(step, normal, shaded) {
  const cosI = normal[0] * step.vec[0] + normal[1] * step.vec[1] + normal[2] * step.vec[2];
  const tiltCos = normal[1];
  const beam = !shaded && cosI > 0 ? step.beamN * cosI : 0;
  const diff = step.diffH * (1 + tiltCos) / 2;
  const ground = 0.2 * (step.beamN * step.sinA + step.diffH) * (1 - tiltCos) / 2;
  return beam + diff + ground;
}

// ---------- self-consumption ----------
const H0 = [0.024, 0.019, 0.017, 0.016, 0.017, 0.022, 0.035, 0.046, 0.045, 0.043, 0.044, 0.047, 0.05, 0.047, 0.042, 0.04, 0.043, 0.053, 0.065, 0.068, 0.064, 0.056, 0.044, 0.033];
const H0_MONTH = [1.12, 1.05, 1.02, 0.97, 0.94, 0.9, 0.9, 0.92, 0.95, 1.02, 1.08, 1.13];
const HDD_SHARE = [0.17, 0.15, 0.13, 0.09, 0.05, 0.015, 0.005, 0.005, 0.03, 0.08, 0.13, 0.165];
const COP_MONTH = [0.85, 0.88, 0.95, 1.05, 1.15, 1.2, 1.2, 1.2, 1.1, 1.0, 0.9, 0.85];

// pvHourly: 12 × 24 kWh for an average day per month. Returns yearly sums and monthly values.
export function simulateSelfUse({ pvHourly, household = 3000, heatKwh = 0, wwKwh = 0, jaz = 3, battery = 0 }) {
  const h0 = H0.map((v) => v / H0.reduce((a, b) => a + b, 0));
  const mSum = H0_MONTH.reduce((s, f, m) => s + f * DAYS[m], 0);
  const hdd = HDD_SHARE.map((v) => v / HDD_SHARE.reduce((a, b) => a + b, 0));
  const out = { pv: 0, load: 0, self: 0, feed: 0, grid: 0, hp: 0, monthly: [] };
  for (let m = 0; m < 12; m++) {
    const houseDay = (household * H0_MONTH[m]) / mSum;
    const hpDay = (heatKwh * hdd[m]) / DAYS[m] / (jaz * COP_MONTH[m]) + wwKwh / 365 / 2.6;
    const load = h0.map((f) => houseDay * f + hpDay / 24);
    const pv = pvHourly[m] || new Array(24).fill(0);
    let soc = 0,
      day = null;
    for (let pass = 0; pass < 2; pass++) {
      day = { self: 0, feed: 0, grid: 0 };
      for (let h = 0; h < 24; h++) {
        const sur = pv[h] - load[h];
        if (sur >= 0) {
          day.self += load[h];
          const ch = Math.min(sur, Math.max(0, battery - soc) / 0.95, battery * 0.5);
          soc += ch * 0.95;
          day.feed += sur - ch;
        } else {
          day.self += pv[h];
          const need = -sur;
          const dis = Math.min(need, soc * 0.95, battery * 0.5);
          soc -= dis / 0.95;
          day.self += dis;
          day.grid += need - dis;
        }
      }
    }
    const pvDay = pv.reduce((a, b) => a + b, 0);
    const loadDay = load.reduce((a, b) => a + b, 0);
    const n = DAYS[m];
    out.pv += pvDay * n;
    out.load += loadDay * n;
    out.self += day.self * n;
    out.feed += day.feed * n;
    out.grid += day.grid * n;
    out.hp += hpDay * n;
    out.monthly.push({ pv: pvDay * n, load: loadDay * n, self: day.self * n });
  }
  out.selfRate = out.pv ? Math.min(1, out.self / out.pv) : 0;
  out.autarky = out.load ? out.self / out.load : 0;
  return out;
}

// Sequential shading ramp (one hue, light = little loss, dark = much loss).
export const SHADE_BINS = [
  { max: 0.02, color: '#fde7d3', label: '< 2 %' },
  { max: 0.05, color: '#f8c39a', label: '2–5 %' },
  { max: 0.1, color: '#ec9254', label: '5–10 %' },
  { max: 0.2, color: '#cf6420', label: '10–20 %' },
  { max: Infinity, color: '#9c4210', label: '> 20 %' },
];
export const shadeColor = (loss) => SHADE_BINS.find((b) => loss < b.max).color;
