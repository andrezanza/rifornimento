/*
 * Motore contabile deterministico.
 *
 * Principio: nessun saldo viene memorizzato. Tutto è ricalcolato da zero a partire
 * dalle registrazioni (ledger). Modifiche e cancellazioni retroattive si riconciliano
 * quindi automaticamente.
 *
 * Benzina (litri):
 *   - "Ancore" = punti in cui la quantità nel serbatoio è nota o delimitata:
 *     inizio contabilità, pieni completi, letture dell'indicatore (modalità avanzata).
 *   - Tra due ancore: consumo = scorta iniziale + litri acquistati − scorta finale.
 *     Con due pieni consecutivi il consumo è MISURATO (metodo pieno-a-pieno).
 *   - La scorta tra le ancore è propagata come intervallo [min, max] usando:
 *     limiti fisici (0 ≤ scorta ≤ capacità; prima di un rifornimento c'era spazio per i
 *     litri acquistati) e un intervallo di consumo per km.
 *   - Quota lavorativa del segmento w = km lavorativi / km totali del segmento.
 *   - Maturato lavorativo = Σ consumo_segmento × w_segmento.
 *   - Saldo = maturato lavorativo − litri forniti dall'azienda (carta UTA + eventuale
 *     scorta iniziale fornita con l'auto).
 *
 * Elettrico (kWh): saldo separato, mai convertito in litri.
 *   maturato = Σ kWh ammissibili × quota lavorativa cumulata; saldo = maturato − kWh pagati con carta aziendale.
 */
import type {
  AppState, ChargeEntry, Entry, FuelEntry, Range, ReadingEntry, Settings, WorkEntry,
} from './types';
import { range, daysBetween, unitPriceMilli, amountFromPrice } from './units';

export type Reliability = 'alta' | 'media' | 'bassa';

export interface Warning {
  level: 'info' | 'attenzione' | 'errore';
  text: string;
  entryId?: string;
}

export interface Segment {
  index: number;
  startTs: string;
  endTs: string;
  startOdo: number;
  endOdo: number;
  km: number;
  startKind: 'inizio' | 'pieno' | 'lettura';
  endKind: 'pieno' | 'lettura' | 'aperto';
  stockStart: Range;
  stockEnd: Range;
  purchasedL: number;
  companyL: number;
  /** scorta iniziale considerata fornita dall'azienda (solo primo segmento) */
  supplyL: Range;
  consumedL: Range;
  workKm: Range;
  workShare: Range;
  workL: Range;
  /** contributo al saldo = workL − companyL − supplyL (calcolato sugli estremi congiunti) */
  balanceDelta: Range;
  /** ampiezza dell'incertezza dovuta alla sola scorta iniziale sconosciuta (componente storica fissa) */
  startStockWidthL: number;
  balanceAfter: Range;
  measured: boolean;
  rateL100: Range | null;
  avgPriceMilli: number | null;
  fuelIds: string[];
}

export interface RateEstimate {
  lo: number; mid: number; hi: number; // l/km
  source: 'misurato' | 'computer di bordo' | 'predefinito';
  samples: number;
}

export interface PlafondStatus {
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD (escluso)
  limitCents: number;
  spentFuelCents: number;
  spentChargeCents: number;
  spentCents: number;
  remainingCents: number;
  /** operazioni aziendali senza importo nel periodo */
  missingAmounts: number;
  verified: boolean;
  includesCharging: boolean;
}

export interface ElectricStatus {
  homeWh: number;
  homeEstimatedWh: number;
  publicPersonalWh: number;
  publicCompanyWh: number;
  homeCents: number;
  publicPersonalCents: number;
  publicCompanyCents: number;
  eligibleWh: number;
  workShare: Range;
  accruedKwh: Range;
  companyKwh: number;
  balanceKwh: Range;
  /** valore stimato dell'energia domestica attribuibile al lavoro (non rimborsato) */
  homeWorkValueEur: Range;
}

export interface EngineResult {
  settings: Settings;
  start: { ts: string; odo: number; stock: Range; mode: Settings['historyMode'] };
  segments: Segment[];
  open: Segment | null;
  rate: RateEstimate;
  stockNow: Range;
  /** contachilometri più recente noto (eventualmente esteso con km lavorativi successivi) */
  lastOdo: number;
  lastOdoTs: string | null;
  odoExtendedByWorkKm: number;
  daysSinceOdo: number | null;
  stale: boolean;
  fuel: {
    accruedWorkL: Range;
    companyL: number;
    supplyL: Range;
    balanceL: Range;
    reliability: Reliability;
    /** ampiezza dell'incertezza attuale (litri), esclusa la componente storica */
    currentWidthL: number;
    historyWidthL: number;
    refPriceMilli: number | null;
    balanceEur: Range | null;
    workCostEur: Range | null;
  };
  totals: {
    km: number;
    workKm: Range;
    personalKm: Range;
    workShare: Range;
    fuelPersonalCents: number;
    fuelCompanyCents: number;
    fuelPersonalCl: number;
    fuelCompanyCl: number;
    fuelMissingAmount: number;
  };
  electric: ElectricStatus;
  plafond: PlafondStatus;
  warnings: Warning[];
  lastFuel: FuelEntry | null;
}

const TYPE_ORDER: Record<Entry['type'], number> = { work: 0, reading: 1, charge: 2, fuel: 3 };

export function sortEntries<T extends Entry>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) =>
      a.ts.localeCompare(b.ts) ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

export function fuelAmountCents(f: FuelEntry): number | null {
  if (f.amountCents != null) return f.amountCents;
  if (f.priceMilli != null) return amountFromPrice(f.priceMilli, f.litersCl, 100);
  return null;
}

export function fuelPriceMilli(f: FuelEntry): number | null {
  if (f.priceMilli != null) return f.priceMilli;
  if (f.amountCents != null && f.litersCl > 0) return unitPriceMilli(f.amountCents, f.litersCl, 100);
  return null;
}

export function chargePriceMilli(c: ChargeEntry): number | null {
  if (c.amountCents != null && c.energyWh && c.energyWh > 0)
    return unitPriceMilli(c.amountCents, c.energyWh, 1000);
  return null;
}

function entryOdo(e: Entry): number | undefined {
  if (e.type === 'fuel' || e.type === 'reading') return e.odo;
  return e.odo;
}

interface StockEvent {
  ts: string;
  odo: number;
  entry: FuelEntry | ReadingEntry | WorkEntry | ChargeEntry | null;
}

/** Propagazione della scorta in un tratto di d km, con consumo per km [rLo, rHi]. */
function drive(stock: Range, d: number, r: { lo: number; mid: number; hi: number }, cap: number): Range {
  if (d <= 0) return stock;
  return range.clamp(
    { lo: stock.lo - d * r.hi, mid: stock.mid - d * r.mid, hi: stock.hi - d * r.lo },
    0, cap,
  );
}

function corners(
  s0: Range, s1: Range, w: Range, fn: (s0: number, s1: number, w: number) => number,
  midFn?: () => number,
): Range {
  let lo = Infinity, hi = -Infinity;
  for (const a of [s0.lo, s0.hi]) for (const b of [s1.lo, s1.hi]) for (const c of [w.lo, w.hi]) {
    const v = fn(a, b, c);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const mid = midFn ? midFn() : fn(s0.mid, s1.mid, w.mid);
  return { lo, hi, mid: Math.min(hi, Math.max(lo, mid)) };
}

function addDaysIso(d: string, n: number): string {
  const dt = new Date(d + 'T12:00');
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function plafondPeriod(nowTs: string, resetDay: number): { start: string; end: string } {
  const [y, m, d] = nowTs.slice(0, 10).split('-').map(Number);
  const day = Math.min(Math.max(1, resetDay), 28);
  let sy = y, sm = m;
  if (d < day) { sm -= 1; if (sm === 0) { sm = 12; sy -= 1; } }
  let ey = sy, em = sm + 1;
  if (em === 13) { em = 1; ey += 1; }
  const p = (n: number) => String(n).padStart(2, '0');
  return { start: `${sy}-${p(sm)}-${p(day)}`, end: `${ey}-${p(em)}-${p(day)}` };
}

export interface EngineOptions {
  now: string; // ISO locale
}

export function compute(state: AppState, opts: EngineOptions): EngineResult {
  const s = state.settings;
  const cap = s.tankCapacityL;
  const warnings: Warning[] = [];
  const all = sortEntries(state.entries);

  const deliveryTs = `${s.deliveryDate}T00:00`;
  const physical = { lo: 0, mid: s.fallbackRateL100 / 100, hi: s.maxRateL100 / 100 };

  // --- Controlli di coerenza del contachilometri -----------------------------
  let prevOdo = s.deliveryOdo;
  let prevOdoEntry: Entry | null = null;
  for (const e of all) {
    const o = entryOdo(e);
    if (o == null) continue;
    if (o < prevOdo) {
      warnings.push({
        level: 'errore',
        entryId: e.id,
        text: `Contachilometri non coerente: ${o} km il ${e.ts.slice(0, 10)} è inferiore a ${prevOdo} km${prevOdoEntry ? ' registrati in precedenza' : ' della consegna'}.`,
      });
    } else {
      prevOdo = o;
      prevOdoEntry = e;
    }
  }

  // --- Eventi con contachilometri, per la propagazione della scorta -----------
  const stockEvents: StockEvent[] = [{ ts: deliveryTs, odo: s.deliveryOdo, entry: null }];
  let lastO = s.deliveryOdo;
  for (const e of all) {
    const o = entryOdo(e);
    if (o == null || e.ts < deliveryTs) continue;
    const odo = Math.max(o, lastO); // valori incoerenti non fanno "tornare indietro" l'auto
    lastO = odo;
    stockEvents.push({ ts: e.ts, odo, entry: e as StockEvent['entry'] });
  }

  const deliveryStock = range.of(
    Math.min(s.deliveryFuelMinL, cap), Math.min(s.deliveryFuelMaxL, cap),
  );

  /**
   * Una passata completa: propagazione scorta, costruzione dei segmenti tra ancore.
   * `rateFor(evIdx)` restituisce l'intervallo di consumo da usare nel tratto che termina all'evento.
   */
  function pass(rateFor: (ev: StockEvent, afterLastFill: boolean) => { lo: number; mid: number; hi: number }, collectWarnings: boolean) {
    const startMode = s.historyMode;
    const refTs = startMode === 'reset' ? s.referenceTs : deliveryTs;
    let stock = deliveryStock;
    let odo = s.deliveryOdo;
    let started = startMode === 'include';
    let startInfo = { ts: deliveryTs, odo: s.deliveryOdo, stock: deliveryStock };
    const anchors: { ts: string; odo: number; stock: Range; kind: Segment['startKind']; idx: number }[] = [];
    if (started) anchors.push({ ...startInfo, kind: 'inizio', idx: 0 });
    const stockAfter: Range[] = [stock];
    const lastFillIdx = (() => {
      let k = -1;
      stockEvents.forEach((ev, i) => { if (ev.entry?.type === 'fuel') k = i; });
      return k;
    })();

    for (let i = 1; i < stockEvents.length; i++) {
      const ev = stockEvents[i];
      if (!started && ev.ts > refTs) {
        // inizio contabilità alla data di riferimento (modalità reset)
        started = true;
        startInfo = { ts: refTs, odo, stock };
        anchors.push({ ...startInfo, kind: 'inizio', idx: i - 1 });
      }
      const r = rateFor(ev, i > lastFillIdx);
      stock = drive(stock, ev.odo - odo, r, cap);
      odo = ev.odo;
      const e = ev.entry;
      if (e?.type === 'fuel') {
        const L = e.litersCl / 100;
        const room = cap - L;
        if (room < -0.5 && collectWarnings) {
          warnings.push({ level: 'attenzione', entryId: e.id, text: `Rifornimento di ${L.toFixed(2)} l superiore alla capacità del serbatoio impostata (${cap} l): verifica il dato o la capacità.` });
        }
        let lo = stock.lo, hi = Math.min(stock.hi, Math.max(0, room));
        if (hi < lo) {
          if (collectWarnings && lo - hi > 1.5) {
            warnings.push({ level: 'info', entryId: e.id, text: `Il rifornimento del ${e.ts.slice(0, 10)} indica un consumo superiore alla stima: la stima è stata corretta.` });
          }
          lo = hi;
        }
        const mid = Math.min(hi, Math.max(lo, stock.mid));
        if (e.full === true) {
          stock = range.exact(cap);
        } else {
          stock = range.clamp({ lo: lo + L, mid: mid + L, hi: hi + L }, 0, cap);
          stock.lo = Math.max(stock.lo, Math.min(L, cap));
        }
        if (started && e.full === true) anchors.push({ ts: ev.ts, odo, stock, kind: 'pieno', idx: i });
      } else if (e?.type === 'reading' && e.fuelLevel != null) {
        const obs = range.clamp(
          range.of(e.fuelLevel * cap - s.fuelLevelTol * cap, e.fuelLevel * cap + s.fuelLevelTol * cap, e.fuelLevel * cap),
          0, cap,
        );
        const lo = Math.max(stock.lo, obs.lo), hi = Math.min(stock.hi, obs.hi);
        if (lo > hi) {
          if (collectWarnings) warnings.push({ level: 'attenzione', entryId: e.id, text: `La lettura del serbatoio del ${e.ts.slice(0, 10)} non è coerente con i rifornimenti registrati: viene usata la lettura.` });
          stock = obs;
        } else {
          stock = { lo, hi, mid: Math.min(hi, Math.max(lo, obs.mid)) };
        }
        if (started) anchors.push({ ts: ev.ts, odo, stock, kind: 'lettura', idx: i });
      }
      stockAfter.push(stock);
    }
    if (!started) {
      started = true;
      startInfo = { ts: refTs, odo, stock };
      anchors.push({ ...startInfo, kind: 'inizio', idx: stockEvents.length - 1 });
    }
    return { anchors, stockNow: stock, stockAfter, startInfo, odoNow: odo };
  }

  // Passata 1: limiti fisici, per misurare i consumi nei segmenti pieno-a-pieno.
  const p1 = pass(() => physical, false);
  const measuredRates: { km: number; l: number }[] = [];
  for (let k = 0; k + 1 < p1.anchors.length; k++) {
    const a = p1.anchors[k], b = p1.anchors[k + 1];
    if (a.kind !== 'pieno' || b.kind !== 'pieno') continue;
    const km = b.odo - a.odo;
    let P = 0;
    for (let i = a.idx + 1; i <= b.idx; i++) {
      const e = stockEvents[i].entry;
      if (e?.type === 'fuel') P += e.litersCl / 100;
    }
    if (km >= 150) measuredRates.push({ km, l: P });
  }

  // Stima del consumo per km (usata solo dove manca una misura).
  let rate: RateEstimate;
  const recent = measuredRates.slice(-5);
  if (recent.length) {
    const sk = recent.reduce((a, x) => a + x.km, 0), sl = recent.reduce((a, x) => a + x.l, 0);
    const mid = sl / sk;
    const rs = recent.map((x) => x.l / x.km);
    rate = {
      lo: Math.min(Math.min(...rs) * 0.85, mid * 0.8),
      mid,
      hi: Math.min(Math.max(Math.max(...rs) * 1.15, mid * 1.2), physical.hi),
      source: 'misurato',
      samples: recent.length,
    };
  } else {
    rate = {
      lo: s.fallbackRateMinL100 / 100, mid: s.fallbackRateL100 / 100, hi: s.fallbackRateMaxL100 / 100,
      source: 'predefinito', samples: 0,
    };
  }
  // Computer di bordo "dal rifornimento" (modalità avanzata): restringe la stima dopo l'ultimo rifornimento.
  let tripRate: { lo: number; mid: number; hi: number } | null = null;
  const lastFillTs = [...all].reverse().find((e) => e.type === 'fuel')?.ts ?? '';
  const tripReading = [...all].reverse().find(
    (e): e is ReadingEntry => e.type === 'reading' && e.tripAvgL100 != null && e.ts > lastFillTs,
  );
  if (tripReading?.tripAvgL100 != null) {
    const m = tripReading.tripAvgL100 / 100;
    tripRate = { lo: m * (1 - s.tripComputerTol), mid: m, hi: m * (1 + s.tripComputerTol) };
  }
  const p2 = pass((_ev, afterLastFill) => (afterLastFill && tripRate ? tripRate : rate), true);
  if (tripRate) rate = { ...tripRate, source: 'computer di bordo', samples: 1 };

  // --- Km lavorativi -----------------------------------------------------------
  const work = all.filter((e): e is WorkEntry => e.type === 'work');
  const fuels = all.filter((e): e is FuelEntry => e.type === 'fuel');
  const charges = all.filter((e): e is ChargeEntry => e.type === 'charge');
  const startTs = p2.startInfo.ts;
  const inAccounting = (ts: string) => (s.historyMode === 'include' ? true : ts > startTs);

  const workIn = (fromTs: string, toTs: string | null) => {
    let lo = 0, hi = 0;
    for (const w of work) {
      if (w.ts > fromTs && (toTs == null || w.ts <= toTs)) {
        lo += w.km;
        hi += w.kmMax ?? w.km;
      }
    }
    return range.of(lo, hi);
  };

  // Contachilometri attuale ed eventuali km lavorativi registrati dopo l'ultima lettura
  const odoEntries = all.filter((e) => entryOdo(e) != null);
  const lastOdoEntry = odoEntries.length ? odoEntries[odoEntries.length - 1] : null;
  const lastOdoTs = lastOdoEntry ? lastOdoEntry.ts : null;
  let lastOdo = Math.max(p2.odoNow, s.deliveryOdo);
  const workAfterOdo = workIn(lastOdoTs ?? deliveryTs, null);
  const odoExtendedByWorkKm = workAfterOdo.lo;
  // i km lavorativi successivi all'ultima lettura sono comunque km percorsi
  let stockNow = p2.stockNow;
  if (odoExtendedByWorkKm > 0) {
    stockNow = drive(stockNow, odoExtendedByWorkKm, tripRate ?? rate, cap);
    lastOdo += odoExtendedByWorkKm;
  }

  // --- Segmenti -------------------------------------------------------------
  const segments: Segment[] = [];
  let balance = range.zero();
  const anchors = p2.anchors;
  const carry = (b: Range): Range =>
    s.maxCarryL == null ? b : { lo: Math.min(b.lo, s.maxCarryL), mid: Math.min(b.mid, s.maxCarryL), hi: Math.min(b.hi, s.maxCarryL) };

  const buildSegment = (k: number, a: typeof anchors[number], b: typeof anchors[number] | null): Segment => {
    const endIdx = b ? b.idx : stockEvents.length - 1;
    const endOdo = b ? b.odo : lastOdo;
    const endTs = b ? b.ts : opts.now;
    const stockEnd = b ? b.stock : stockNow;
    let P = 0, C = 0, priceNum = 0, priceDen = 0;
    const fuelIds: string[] = [];
    for (let i = a.idx + 1; i <= endIdx; i++) {
      const e = stockEvents[i].entry;
      if (e?.type === 'fuel') {
        const L = e.litersCl / 100;
        P += L;
        if (e.payment === 'company') C += L;
        fuelIds.push(e.id);
        const amt = fuelAmountCents(e);
        if (amt != null) { priceNum += amt; priceDen += e.litersCl; }
      }
    }
    const km = Math.max(0, endOdo - a.odo);
    let wk = workIn(a.ts, b ? b.ts : null);
    if (wk.hi > km + 0.5 && km > 0) {
      warnings.push({ level: 'errore', text: `Nel tratto ${a.odo}–${endOdo} km i km lavorativi (${Math.round(wk.hi)}) superano i km percorsi (${km}): verifica le registrazioni.` });
      wk = range.clamp(wk, 0, km);
    }
    const kmTot = Math.max(km, wk.hi);
    const wShare = kmTot > 0 ? range.of(wk.lo / kmTot, wk.hi / kmTot, wk.mid / kmTot) : range.zero();
    const supplyIsCompany = k === 0 && s.startFuelBy === 'company';
    // consumo fisicamente possibile: tra 0 e km × consumo massimo plausibile
    const cons = (s0: number, s1: number) => Math.min(Math.max(0, s0 + P - s1), km > 0 ? km * physical.hi : Infinity);
    const consumedL = corners(a.stock, stockEnd, range.exact(0), (s0, s1) => cons(s0, s1));
    const workL = corners(a.stock, stockEnd, wShare, (s0, s1, w) => w * cons(s0, s1));
    const supplyL = supplyIsCompany ? a.stock : range.zero();
    const deltaFn = (s0: number, s1: number, w: number) => w * cons(s0, s1) - C - (supplyIsCompany ? s0 : 0);
    const delta = corners(a.stock, stockEnd, wShare, deltaFn);
    const pinned = a.kind === 'inizio' ? corners(range.exact(a.stock.mid), stockEnd, wShare, deltaFn) : delta;
    const startStockWidthL = Math.max(0, range.width(delta) - range.width(pinned));
    balance = carry(range.add(balance, delta));
    const measured = !!b && range.width(a.stock) < 0.01 && range.width(stockEnd) < 0.01;
    return {
      index: k,
      startTs: a.ts, endTs, startOdo: a.odo, endOdo, km,
      startKind: a.kind, endKind: b ? (b.kind === 'pieno' ? 'pieno' : 'lettura') : 'aperto',
      stockStart: a.stock, stockEnd, purchasedL: P, companyL: C, supplyL, consumedL,
      workKm: wk, workShare: wShare, workL, balanceDelta: delta, startStockWidthL, balanceAfter: balance,
      measured,
      rateL100: km > 0 ? range.scale(consumedL, 100 / km) : null,
      avgPriceMilli: priceDen > 0 ? Math.round((priceNum * 1000) / priceDen) : null,
      fuelIds,
    };
  };

  for (let k = 0; k + 1 < anchors.length; k++) segments.push(buildSegment(k, anchors[k], anchors[k + 1]));
  // Consumo quasi nullo su molti km: possibile in elettrico puro, ma spesso indica un rifornimento non registrato
  // o una scorta iniziale sottostimata. Il calcolo resta prudente (meno credito), ma va segnalato.
  for (const sg of segments) {
    if (sg.km >= 300 && sg.consumedL.hi < sg.km * 0.01) {
      warnings.push({
        level: 'attenzione',
        text: `Tratto ${sg.startOdo}–${sg.endOdo} km: risultano consumati al massimo ${sg.consumedL.hi.toFixed(1)} l di benzina su ${sg.km} km (${(sg.consumedL.hi / sg.km * 100).toFixed(1)} l/100 km). Se non è stato percorso quasi tutto in elettrico, manca un rifornimento o la benzina iniziale era di più.`,
      });
    }
  }
  const lastAnchor = anchors[anchors.length - 1];
  const open = buildSegment(segments.length, lastAnchor, null);

  const accruedWorkL = [...segments, open].reduce((acc, sg) => range.add(acc, sg.workL), range.zero());
  const companyL = [...segments, open].reduce((a, sg) => a + sg.companyL, 0);
  const supplyL = segments.length ? segments[0].supplyL : open.supplyL;
  const balanceL = open.balanceAfter;
  // L'affidabilità riguarda la stima corrente; l'incertezza storica (scorta iniziale sconosciuta)
  // è fissa, dichiarata a parte e gestita dal criterio prudente.
  const historyWidthL = segments.length ? segments[0].startStockWidthL : open.startStockWidthL;
  const width = Math.max(0, range.width(open.balanceDelta) - (segments.length ? 0 : open.startStockWidthL));
  const reliability: Reliability = width <= 2 ? 'alta' : width <= 6 ? 'media' : 'bassa';

  // --- Totali economici e chilometrici -----------------------------------------
  const allWork = workIn('0000', null);
  const totalKm = Math.max(0, lastOdo - s.deliveryOdo);
  const allShare = totalKm > 0 ? range.clamp(range.scale(allWork, 1 / totalKm), 0, 1) : range.zero();
  let fpc = 0, fcc = 0, fpl = 0, fcl = 0, missing = 0;
  let accNum = 0, accDen = 0;
  for (const f of fuels) {
    const amt = fuelAmountCents(f);
    if (amt == null) missing++;
    if (f.payment === 'company') { fcc += amt ?? 0; fcl += f.litersCl; } else { fpc += amt ?? 0; fpl += f.litersCl; }
    if (amt != null && inAccounting(f.ts)) { accNum += amt; accDen += f.litersCl; }
  }
  const lastFuel = fuels.length ? fuels[fuels.length - 1] : null;
  const refPriceMilli = lastFuel ? fuelPriceMilli(lastFuel) : null;
  const avgPrice = accDen > 0 ? (accNum * 10) / accDen : null; // €/l
  const balanceEur = refPriceMilli != null ? range.scale(balanceL, refPriceMilli / 1000) : null;
  const workCostEur = avgPrice != null ? range.scale(accruedWorkL, avgPrice) : null;

  // --- Elettrico ---------------------------------------------------------------
  const kmSinceStart = Math.max(0, lastOdo - p2.startInfo.odo);
  const workSinceStart = s.historyMode === 'include' ? allWork : workIn(startTs, null);
  const wEl = kmSinceStart > 0 ? range.clamp(range.scale(workSinceStart, 1 / kmSinceStart), 0, 1) : allShare;
  const el: ElectricStatus = {
    homeWh: 0, homeEstimatedWh: 0, publicPersonalWh: 0, publicCompanyWh: 0,
    homeCents: 0, publicPersonalCents: 0, publicCompanyCents: 0,
    eligibleWh: 0, workShare: wEl, accruedKwh: range.zero(), companyKwh: 0, balanceKwh: range.zero(),
    homeWorkValueEur: range.zero(),
  };
  for (const c of charges) {
    const wh = c.energyWh ?? 0;
    if (c.energyWh == null) {
      warnings.push({ level: 'info', entryId: c.id, text: `Ricarica del ${c.ts.slice(0, 10)} senza kWh: esclusa dai saldi energetici.` });
    }
    if (c.kind === 'home') {
      el.homeWh += wh;
      if (c.estimated) el.homeEstimatedWh += wh;
      el.homeCents += c.amountCents ?? 0;
    } else if (c.payment === 'company') {
      el.publicCompanyWh += wh; el.publicCompanyCents += c.amountCents ?? 0;
    } else {
      el.publicPersonalWh += wh; el.publicPersonalCents += c.amountCents ?? 0;
    }
    if (!inAccounting(c.ts)) continue;
    const eligible = c.kind === 'public' || s.homeChargingInBalance;
    if (eligible && wh > 0) {
      el.eligibleWh += wh;
      const share = c.attribution === 'lavoro' ? range.exact(1) : wEl;
      el.accruedKwh = range.add(el.accruedKwh, range.scale(share, wh / 1000));
    }
    if (c.payment === 'company' && c.kind === 'public') el.companyKwh += wh / 1000;
  }
  el.balanceKwh = range.shift(el.accruedKwh, -el.companyKwh);
  el.homeWorkValueEur = range.scale(wEl, (el.homeWh / 1000) * (s.homeEnergyPriceMilli / 1000));

  // --- Plafond -------------------------------------------------------------------
  const per = plafondPeriod(opts.now, s.plafondResetDay);
  let spF = 0, spC = 0, miss = 0;
  for (const f of fuels) {
    const d = f.ts.slice(0, 10);
    if (f.payment !== 'company' || d < per.start || d >= per.end) continue;
    const a = fuelAmountCents(f);
    if (a == null) miss++; else spF += a;
  }
  for (const c of charges) {
    const d = c.ts.slice(0, 10);
    if (c.payment !== 'company' || d < per.start || d >= per.end) continue;
    if (c.amountCents == null) miss++; else spC += c.amountCents;
  }
  const spent = spF + (s.plafondIncludesCharging ? spC : 0);
  const plafond: PlafondStatus = {
    periodStart: per.start, periodEnd: per.end, limitCents: s.plafondCents,
    spentFuelCents: spF, spentChargeCents: spC, spentCents: spent,
    remainingCents: s.plafondCents - spent, missingAmounts: miss,
    verified: s.plafondVerified, includesCharging: s.plafondIncludesCharging,
  };
  if (plafond.remainingCents < 0) {
    warnings.push({ level: 'errore', text: `Plafond del periodo superato di ${((-plafond.remainingCents) / 100).toFixed(2)} €.` });
  }

  // --- Aggiornamento dei dati ---------------------------------------------------
  const daysSinceOdo = lastOdoTs ? daysBetween(lastOdoTs, opts.now) : null;
  const lastWorkTs = work.length ? work[work.length - 1].ts : null;
  const lastActivity = [lastOdoTs, lastWorkTs].filter(Boolean).sort().pop() ?? null;
  const stale = lastActivity == null || daysBetween(lastActivity, opts.now) > s.staleDays;
  if (stale) {
    warnings.push({ level: 'attenzione', text: `Chilometri non aggiornati da più di ${s.staleDays} giorni: il saldo potrebbe non includere i km lavorativi recenti (stima prudente, per difetto).` });
  }
  if (odoExtendedByWorkKm > 0) {
    warnings.push({ level: 'info', text: `${Math.round(odoExtendedByWorkKm)} km lavorativi sono successivi all'ultima lettura del contachilometri: inserisci il contachilometri per calcolare anche i km personali.` });
  }

  return {
    settings: s,
    start: { ...p2.startInfo, mode: s.historyMode },
    segments, open, rate, stockNow, lastOdo, lastOdoTs, odoExtendedByWorkKm,
    daysSinceOdo, stale,
    fuel: { accruedWorkL, companyL, supplyL, balanceL, reliability, currentWidthL: width, historyWidthL, refPriceMilli, balanceEur, workCostEur },
    totals: {
      km: totalKm, workKm: allWork,
      personalKm: range.of(Math.max(0, totalKm - allWork.hi), Math.max(0, totalKm - allWork.lo)),
      workShare: allShare,
      fuelPersonalCents: fpc, fuelCompanyCents: fcc, fuelPersonalCl: fpl, fuelCompanyCl: fcl,
      fuelMissingAmount: missing,
    },
    electric: el,
    plafond,
    warnings,
    lastFuel,
  };
}

export { addDaysIso };
