/*
 * Assistente "Posso fare rifornimento con la carta aziendale?"
 *
 * La simulazione NON usa formule separate: aggiunge al ledger un rifornimento ipotetico
 * e ricalcola tutto con lo stesso motore. Il risultato è quindi per costruzione coerente
 * con ciò che si vedrà dopo aver registrato l'operazione.
 */
import type { AppState, ChargeEntry, FuelEntry, Range, ReadingEntry, WorkEntry } from './types';
import { compute, type EngineResult } from './engine';
import { range, toScaled, amountFromPrice } from './units';

export type Verdict = 'aziendale' | 'parziale' | 'personale' | 'insufficienti';

export interface FuelPlanInput {
  full: boolean;
  liters: number | null;
  priceMilli: number | null;
  amountCents: number | null;
  odo: number | null;
  /** km lavorativi percorsi e non ancora registrati */
  extraWorkKm: number | null;
  ts: string;
}

export interface FuelPlanResult {
  verdict: Verdict;
  headline: string;
  reasons: string[];
  basis: 'prudente' | 'centrale';
  litersUsed: number;
  litersEstimated: boolean;
  priceMilli: number | null;
  amountCents: number | null;
  /** litri massimi pagabili con carta aziendale (secondo il criterio scelto) */
  maxCompanyL: number;
  maxCompanyLRange: Range;
  /** a cosa si riferisce maxCompanyL: pieno completo o rifornimento parziale */
  mode: 'pieno' | 'parziale';
  fullMaxL: number;
  partialMaxL: number;
  plafondMaxL: number | null;
  before: Range;
  afterCompany: Range;
  afterPersonal: Range;
  fitL: Range;
  reliability: EngineResult['fuel']['reliability'];
}

function pick(r: Range, basis: 'prudente' | 'centrale') {
  return basis === 'prudente' ? r.lo : r.mid;
}

function hypothetical(
  state: AppState, input: FuelPlanInput, liters: number, payment: 'company' | 'personal', full = input.full,
): AppState {
  const at = input.ts;
  const extra: (FuelEntry | ReadingEntry | WorkEntry)[] = [];
  const base = { createdAt: '9999', updatedAt: '9999', source: 'manuale' as const };
  if (input.extraWorkKm && input.extraWorkKm > 0) {
    extra.push({ ...base, id: 'sim-work', type: 'work', ts: at, km: input.extraWorkKm });
  }
  if (input.odo != null) extra.push({ ...base, id: 'sim-read', type: 'reading', ts: at, odo: input.odo });
  extra.push({
    ...base, id: 'sim-fuel', type: 'fuel', ts: at,
    odo: input.odo ?? -1, litersCl: toScaled(liters, 100), amountCents: null, priceMilli: null,
    payment, full,
  });
  return { ...state, entries: [...state.entries, ...extra] };
}

function withOdo(input: FuelPlanInput, now: EngineResult): FuelPlanInput {
  return { ...input, odo: input.odo ?? Math.round(now.lastOdo + (input.extraWorkKm ?? 0)) };
}

export function planFuel(state: AppState, rawInput: FuelPlanInput): FuelPlanResult {
  const s = state.settings;
  const basis = s.decisionBasis;
  const nowRes = compute(state, { now: rawInput.ts });
  const input = withOdo(rawInput, nowRes);
  const cap = s.tankCapacityL;
  const reasons: string[] = [];

  // stato prima del rifornimento (inclusi eventuali km lavorativi non registrati)
  const pre = compute(
    input.extraWorkKm || input.odo !== nowRes.lastOdo
      ? {
          ...state,
          entries: [
            ...state.entries,
            ...(input.extraWorkKm ? [{ id: 'sim-work', type: 'work' as const, ts: input.ts, km: input.extraWorkKm, createdAt: '9999', updatedAt: '9999' }] : []),
            ...(input.odo != null ? [{ id: 'sim-read', type: 'reading' as const, ts: input.ts, odo: input.odo, createdAt: '9999', updatedAt: '9999' }] : []),
          ],
        }
      : state,
    { now: input.ts },
  );
  const fitL = range.clamp({ lo: cap - pre.stockNow.hi, mid: cap - pre.stockNow.mid, hi: cap - pre.stockNow.lo }, 0, cap);

  // prezzo
  let priceMilli = input.priceMilli;
  if (priceMilli == null && input.amountCents != null && input.liters) {
    priceMilli = Math.round((input.amountCents * 1000) / (input.liters * 100));
  }
  const priceEstimated = priceMilli == null;
  if (priceMilli == null) priceMilli = pre.fuel.refPriceMilli;

  let liters = input.liters;
  let litersEstimated = false;
  if (liters == null && input.amountCents != null && priceMilli) {
    liters = input.amountCents / 10 / priceMilli;
  }
  if (liters == null) {
    litersEstimated = true;
    liters = input.full ? Math.max(1, Math.round(fitL.mid * 10) / 10) : Math.max(1, Math.min(fitL.mid, 20));
  }
  const amountCents = input.amountCents ?? (priceMilli ? amountFromPrice(priceMilli, toScaled(liters, 100), 100) : null);

  const run = (L: number, pay: 'company' | 'personal', full = input.full) =>
    compute(hypothetical(state, input, L, pay, full), { now: input.ts }).fuel.balanceL;

  const afterCompany = run(liters, 'company');
  const afterPersonal = run(liters, 'personal');

  // Ricerca dei litri massimi compatibili (saldo dopo l'operazione decrescente in L).
  // Pieno: i litri possibili vanno dallo spazio minimo stimato nel serbatoio alla capacità.
  // Parziale: da 0 allo spazio massimo stimato.
  const margin = s.safetyMarginL;
  const maxL = (sel: (r: Range) => number, full: boolean) => {
    const ok = (L: number) => sel(run(L, 'company', full)) >= margin - 1e-9;
    const lower = full ? Math.max(0.01, fitL.lo) : 0.01;
    const upper = full ? cap : Math.max(fitL.hi, 1);
    if (lower > upper || !ok(lower)) return 0;
    if (ok(upper)) return upper;
    let a = lower, b = upper;
    for (let i = 0; i < 30; i++) {
      const m = (a + b) / 2;
      if (ok(m)) a = m; else b = m;
    }
    return Math.floor(a * 10) / 10;
  };
  const rangeFor = (full: boolean) => range.of(maxL((r) => r.lo, full), maxL((r) => r.hi, full), maxL((r) => r.mid, full));
  const fullRange = input.full ? rangeFor(true) : range.zero();
  const partialRange = rangeFor(false);
  const pickR = (r: Range) => (basis === 'prudente' ? r.lo : r.mid);

  // plafond
  const plafRem = nowRes.plafond.remainingCents;
  const plafondMaxL = priceMilli ? Math.max(0, Math.floor(((plafRem * 10) / priceMilli) * 10) / 10) : null;
  const capPlafond = (x: number) => (plafondMaxL != null ? Math.min(x, plafondMaxL) : x);
  const fullMaxL = capPlafond(pickR(fullRange));
  const partialMaxL = capPlafond(pickR(partialRange));
  const plafondBinding = plafondMaxL != null && plafondMaxL < Math.max(pickR(fullRange), pickR(partialRange));
  const fullOk = input.full && fullMaxL > 0 && liters <= fullMaxL + 1e-9;
  const mode: 'pieno' | 'parziale' = fullOk ? 'pieno' : 'parziale';
  const maxCompanyLRange = fullOk ? fullRange : partialRange;
  const maxCompanyL = fullOk ? fullMaxL : partialMaxL;

  const before = pre.fuel.balanceL;
  const amountOk = amountCents == null || amountCents <= plafRem;

  // motivazioni
  reasons.push(
    `Saldo lavorativo stimato prima del rifornimento: ${fmtR(before)} (affidabilità ${pre.fuel.reliability}).`,
  );
  if (input.full) {
    reasons.push(
      `Con un pieno completo il consumo del tratto diventa misurato: una quota pari al ${pct(pre.open?.workShare)} dei litri reintegrati è attribuita al lavoro.`,
    );
  } else {
    reasons.push('Un rifornimento parziale non misura il consumo: il saldo resta una stima fino al prossimo pieno.');
  }
  reasons.push(`Criterio ${basis === 'prudente' ? 'prudente: si considera il limite inferiore della stima' : 'centrale: si considera il valore centrale della stima'}, margine di sicurezza ${margin} l.`);
  if (pre.rate.source === 'predefinito') {
    reasons.push('Consumo per km non ancora misurato (servono due pieni completi consecutivi): la stima usa un intervallo prudente.');
  }
  if (priceEstimated && priceMilli) reasons.push('Prezzo non indicato: usato quello dell\'ultimo rifornimento.');
  if (litersEstimated) reasons.push(`Litri non indicati: stimati in ${liters.toFixed(1)} l in base alla scorta stimata nel serbatoio.`);
  if (plafondBinding) reasons.push(`Il plafond residuo (${(plafRem / 100).toFixed(2)} €) limita l'importo pagabile con carta aziendale.`);
  if (!nowRes.plafond.verified) reasons.push('Condizioni del plafond non verificate: impostazione provvisoria.');

  // verdetto
  let verdict: Verdict;
  let headline: string;
  const insufficient =
    nowRes.lastOdoTs == null ||
    (pre.stale && rawInput.odo == null && !rawInput.extraWorkKm) ||
    (pre.fuel.reliability === 'bassa' && maxCompanyLRange.lo + 1e-9 < liters && maxCompanyLRange.hi >= liters);

  const okNow = amountOk && maxCompanyL > 0 && liters <= maxCompanyL + 1e-9;
  if (okNow) {
    verdict = 'aziendale';
    headline = input.full
      ? `Pieno con carta aziendale compatibile (fino a ${fmtL(maxCompanyL)}).`
      : `Rifornimento di ${fmtL(liters)} con carta aziendale compatibile.`;
  } else if (insufficient) {
    verdict = 'insufficienti';
    headline = 'Dati insufficienti per una raccomandazione attendibile: meglio pagare con carta personale o aggiornare i km.';
    if (pre.stale) reasons.push('I chilometri non sono aggiornati di recente.');
    if (pre.fuel.reliability === 'bassa') reasons.push(`L'incertezza del saldo (${fmtR(before)}) è troppo ampia rispetto ai litri previsti.`);
  } else if (partialMaxL >= s.minPartialL) {
    verdict = 'parziale';
    headline = `Rifornimento parziale aziendale potenzialmente compatibile: massimo ${fmtL(partialMaxL)}${priceMilli ? ` (≈ ${(Math.floor(partialMaxL * priceMilli / 10) / 100).toFixed(2)} €)` : ''}.`;
    reasons.push(`Un ${input.full ? 'pieno' : 'rifornimento'} di ${fmtL(liters)} supererebbe il saldo: in alternativa paga l'intero ${input.full ? 'pieno' : 'importo'} con carta personale.`);
    if (input.full) reasons.push('Un parziale aziendale lascia il consumo da misurare al prossimo pieno, che sarà quindi da valutare di nuovo.');
  } else {
    verdict = 'personale';
    headline = 'Rifornimento con carta personale consigliato.';
    reasons.push(partialMaxL > 0
      ? `Il saldo consente al massimo ${fmtL(partialMaxL)}, sotto la soglia minima di un parziale (${s.minPartialL} l).`
      : 'Il saldo lavorativo non copre un rifornimento aziendale: i litri già pagati dall\'azienda coprono i km lavorativi percorsi.');
  }
  reasons.push('Questa è una valutazione di calcolo sulle regole configurate, non un\'autorizzazione aziendale.');

  return {
    verdict, headline, reasons, basis, litersUsed: liters, litersEstimated, priceMilli, amountCents,
    maxCompanyL, maxCompanyLRange, mode, fullMaxL, partialMaxL, plafondMaxL, before, afterCompany, afterPersonal, fitL,
    reliability: pre.fuel.reliability,
  };
}

// --- Ricarica pubblica ------------------------------------------------------

export interface ChargePlanInput {
  kwh: number | null;
  priceMilliKwh: number | null;
  amountCents: number | null;
  workDedicated: boolean;
  ts: string;
}

export interface ChargePlanResult {
  verdict: Verdict;
  headline: string;
  reasons: string[];
  kwhUsed: number;
  amountCents: number | null;
  maxCompanyKwh: number;
  before: Range;
  afterCompany: Range;
  afterPersonal: Range;
}

export function planCharge(state: AppState, input: ChargePlanInput): ChargePlanResult {
  const s = state.settings;
  const basis = s.decisionBasis;
  const res = compute(state, { now: input.ts });
  const reasons: string[] = [];
  let kwh = input.kwh;
  if (kwh == null && input.amountCents != null && input.priceMilliKwh) kwh = input.amountCents / 10 / input.priceMilliKwh;
  const kwhKnown = kwh != null;
  if (kwh == null) kwh = Math.round(s.batteryNetKwh * 0.8 * 10) / 10;
  const amountCents = input.amountCents ?? (input.priceMilliKwh ? amountFromPrice(input.priceMilliKwh, toScaled(kwh, 1000), 1000) : null);

  const mk = (pay: 'company' | 'personal'): AppState => ({
    ...state,
    entries: [...state.entries, {
      id: 'sim-charge', type: 'charge', ts: input.ts, kind: 'public', payment: pay,
      energyWh: toScaled(kwh!, 1000), amountCents, estimated: false,
      attribution: input.workDedicated ? 'lavoro' : 'proporzionale',
      createdAt: '9999', updatedAt: '9999',
    } as ChargeEntry],
  });
  const before = res.electric.balanceKwh;
  const afterCompany = compute(mk('company'), { now: input.ts }).electric.balanceKwh;
  const afterPersonal = compute(mk('personal'), { now: input.ts }).electric.balanceKwh;
  const w = input.workDedicated ? 1 : pick(res.electric.workShare, basis);
  const b = pick(before, basis);
  const maxCompanyKwh = w >= 1 ? (b >= 0 ? Infinity : 0) : Math.max(0, b / (1 - w));

  const plafRem = res.plafond.includesCharging ? res.plafond.remainingCents : Infinity;
  const amountOk = amountCents == null || amountCents <= plafRem;

  reasons.push(`Saldo elettrico stimato: ${fmtK(before)}. Elettricità e benzina hanno saldi separati: 1 kWh non equivale a 1 litro.`);
  reasons.push(input.workDedicated
    ? 'Ricarica dichiarata come interamente lavorativa (es. durante una trasferta): annotalo nelle note.'
    : `Quota lavorativa applicata: ${pct(res.electric.workShare)} (km lavorativi / km totali).`);
  if (!s.homeChargingInBalance) reasons.push('Le ricariche domestiche non generano credito (impostazione predefinita, solo statistica).');
  if (!kwhKnown) reasons.push(`kWh non indicati: ipotizzati ${kwh} kWh (80% batteria).`);
  if (!res.plafond.verified) reasons.push('Non è verificato se il plafond comprenda anche le ricariche: impostazione provvisoria.');

  let verdict: Verdict, headline: string;
  if (kwh <= maxCompanyKwh + 1e-9 && amountOk) {
    verdict = 'aziendale';
    headline = 'Ricarica con carta UTA e+ compatibile con il saldo elettrico stimato.';
  } else if (!amountOk) {
    verdict = 'personale';
    headline = 'Importo superiore al plafond residuo: carta personale consigliata.';
  } else if (maxCompanyKwh >= 5 && Number.isFinite(maxCompanyKwh)) {
    verdict = 'parziale';
    headline = `Ricarica aziendale compatibile fino a circa ${maxCompanyKwh.toFixed(1)} kWh.`;
  } else {
    verdict = 'personale';
    headline = 'Ricarica con carta personale consigliata.';
    reasons.push('Con la ripartizione proporzionale, una ricarica aziendale richiede un credito elettrico già maturato (ricariche pubbliche personali usate anche per lavoro).');
  }
  reasons.push('Valutazione di calcolo, non autorizzazione aziendale.');
  return { verdict, headline, reasons, kwhUsed: kwh, amountCents, maxCompanyKwh: Number.isFinite(maxCompanyKwh) ? maxCompanyKwh : 999, before, afterCompany, afterPersonal };
}

const nf1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function fmtL(x: number) { return `${nf1.format(x)} l`; }
function fmtR(r: Range) {
  return Math.abs(r.hi - r.lo) < 0.05 ? fmtL(r.mid) : `da ${nf1.format(r.lo)} a ${nf1.format(r.hi)} l (centrale ${nf1.format(r.mid)} l)`;
}
function fmtK(r: Range) {
  return Math.abs(r.hi - r.lo) < 0.05 ? `${nf1.format(r.mid)} kWh` : `da ${nf1.format(r.lo)} a ${nf1.format(r.hi)} kWh`;
}
function pct(r?: Range) {
  if (!r) return '—';
  return Math.abs(r.hi - r.lo) < 0.001 ? `${nf1.format(r.mid * 100)}%` : `${nf1.format(r.lo * 100)}–${nf1.format(r.hi * 100)}%`;
}
