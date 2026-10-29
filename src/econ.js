// Payback and lifetime economics for energy measures.
// Savings grow with energy prices; a measure counts as worthwhile when it pays back within half its
// service life, as borderline within its life, otherwise as uneconomic.

export const LIFE = { daemmung: 40, fenster: 30, waermepumpe: 20, pv: 25, speicher: 15 };
export const PRICE_RISE = 0.03; // energy prices per year

// saving: € in the first year, or a function (year 1..n) → €; maintenance: € per year
export function economics({ invest, funding = 0, saving, life, rise = PRICE_RISE, maintenance = 0 }) {
  const net = Math.max(0, (invest || 0) - (funding || 0));
  const at = typeof saving === 'function' ? saving : (y) => saving * Math.pow(1 + rise, y - 1);
  let cum = 0,
    years = null,
    total = 0;
  for (let y = 1; y <= 60; y++) {
    const s = at(y) - maintenance;
    if (years == null && s > 0 && cum + s >= net) years = y - 1 + (net - cum) / s;
    cum += s;
    if (y <= life) total += s;
  }
  const first = at(1) - maintenance;
  const verdict = first <= 0 || years == null || years > life ? 'nein' : years <= life / 2 ? 'gut' : 'knapp';
  return { invest: invest || 0, funding: funding || 0, net, first, years, life, benefit: total - net, verdict };
}

export const VERDICT = {
  gut: { label: 'wirtschaftlich', tone: 'accent' },
  knapp: { label: 'grenzwertig', tone: 'warn' },
  nein: { label: 'unwirtschaftlich', tone: 'danger' },
};

export function paybackText(e) {
  if (!e) return '';
  if (e.first <= 0) return 'spart unter diesen Annahmen nichts ein';
  if (e.years == null || e.years > e.life) return `amortisiert sich nicht innerhalb der Lebensdauer (ca. ${e.life} Jahre)`;
  const y = e.years < 1 ? 'unter 1 Jahr' : `ca. ${Math.round(e.years)} ${Math.round(e.years) === 1 ? 'Jahr' : 'Jahren'}`;
  return `amortisiert sich nach ${y} (Lebensdauer ca. ${e.life} Jahre)`;
}

// KfW 458 heat pump grant: 30 % base + 16 % for replacing a working oil/gas heating + income bonus
// (+ 5 % natural refrigerant), capped at 70 % of at most 28,000 € eligible costs (first dwelling).
export function kfw458(invest, { replaceFossil = true, incomeBonus = 0, efficiency = false } = {}) {
  const rate = Math.min(0.7, 0.3 + (replaceFossil ? 0.16 : 0) + (incomeBonus || 0) + (efficiency ? 0.05 : 0));
  return { rate, amount: Math.min(invest, 28000) * rate };
}
