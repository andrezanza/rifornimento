import type { Range } from './types';

/** Converte un numero decimale in intero scalato, arrotondando correttamente (es. 32.34 l -> 3234 cl). */
export function toScaled(value: number, scale: number): number {
  return Math.round(value * scale + (value >= 0 ? 1e-9 : -1e-9));
}

/** Parsing di input italiano: "1.234,56" / "1234,56" / "1234.56" */
export function parseDecimal(input: string): number | null {
  const s = input.trim().replace(/\s/g, '').replace(/€|l|km/gi, '');
  if (!s) return null;
  let norm = s;
  if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) norm = s.replace(/\./g, '');
  else if (/^\d{1,3}\.\d{3}$/.test(s)) norm = s.replace('.', ''); // "2.910" = migliaia
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/** Prezzo unitario in millesimi di €/unità, da centesimi e unità scalate (cl o Wh). */
export function unitPriceMilli(amountCents: number, qtyScaled: number, scale: number): number {
  if (qtyScaled <= 0) return 0;
  // amountCents/100 € ÷ (qty/scale) unità × 1000 = amountCents × scale × 10 / qty
  return Math.round((amountCents * scale * 10) / qtyScaled);
}

/** Importo in centesimi da prezzo (millesimi) e quantità scalata. */
export function amountFromPrice(priceMilli: number, qtyScaled: number, scale: number): number {
  return Math.round((priceMilli * qtyScaled) / (scale * 10));
}

const nf = (min: number, max: number) =>
  new Intl.NumberFormat('it-IT', { minimumFractionDigits: min, maximumFractionDigits: max });
const f0 = nf(0, 0), f1 = nf(1, 1), f2 = nf(2, 2), f3 = nf(3, 3);

export const fmt = {
  eur: (cents: number | null | undefined) =>
    cents == null ? '—' : `${f2.format(cents / 100)} €`,
  eurF: (euros: number) => `${f2.format(euros)} €`,
  liters: (cl: number) => `${f2.format(cl / 100)} l`,
  l: (liters: number, digits = 1) => `${(digits === 2 ? f2 : digits === 0 ? f0 : f1).format(liters)} l`,
  kwh: (wh: number) => `${f1.format(wh / 1000)} kWh`,
  kwhF: (kwh: number) => `${f1.format(kwh)} kWh`,
  km: (km: number) => `${f0.format(km)} km`,
  pct: (x: number) => `${f1.format(x * 100)}%`,
  price: (milli: number | null) => (milli == null ? '—' : `${f3.format(milli / 1000)} €/l`),
  priceKwh: (milli: number | null) => (milli == null ? '—' : `${f3.format(milli / 1000)} €/kWh`),
  num: (x: number, d = 1) => (d === 0 ? f0 : d === 2 ? f2 : d === 3 ? f3 : f1).format(x),
  date: (ts: string) => {
    const [d] = ts.split('T');
    const [y, m, dd] = d.split('-');
    return `${dd}/${m}/${y}`;
  },
  dateTime: (ts: string) => {
    const [d, t] = ts.split('T');
    const [y, m, dd] = d.split('-');
    return `${dd}/${m}/${y}${t ? ' ' + t.slice(0, 5) : ''}`;
  },
  month: (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  },
  rangeL: (r: Range, digits = 1) =>
    Math.abs(r.hi - r.lo) < 0.05
      ? fmt.l(r.mid, digits)
      : `${fmt.num(r.lo, digits)} … ${fmt.num(r.hi, digits)} l`,
  signedL: (x: number, digits = 1) => `${x > 0.049 ? '+' : ''}${fmt.l(x, digits)}`,
};

export const range = {
  of: (lo: number, hi: number, mid?: number): Range => {
    const a = Math.min(lo, hi), b = Math.max(lo, hi);
    return { lo: a, hi: b, mid: mid ?? (a + b) / 2 };
  },
  exact: (x: number): Range => ({ lo: x, mid: x, hi: x }),
  add: (a: Range, b: Range): Range => ({ lo: a.lo + b.lo, mid: a.mid + b.mid, hi: a.hi + b.hi }),
  sub: (a: Range, b: Range): Range => ({ lo: a.lo - b.hi, mid: a.mid - b.mid, hi: a.hi - b.lo }),
  shift: (a: Range, x: number): Range => ({ lo: a.lo + x, mid: a.mid + x, hi: a.hi + x }),
  scale: (a: Range, k: number): Range =>
    k >= 0 ? { lo: a.lo * k, mid: a.mid * k, hi: a.hi * k } : { lo: a.hi * k, mid: a.mid * k, hi: a.lo * k },
  clamp: (a: Range, min: number, max: number): Range => {
    const c = (x: number) => Math.min(max, Math.max(min, x));
    return { lo: c(a.lo), mid: c(a.mid), hi: c(a.hi) };
  },
  width: (a: Range) => a.hi - a.lo,
  zero: (): Range => ({ lo: 0, mid: 0, hi: 0 }),
};

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function nowLocalIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function daysBetween(aTs: string, bTs: string): number {
  const a = new Date(aTs.length <= 10 ? aTs + 'T00:00' : aTs).getTime();
  const b = new Date(bTs.length <= 10 ? bTs + 'T00:00' : bTs).getTime();
  return (b - a) / 86400000;
}
