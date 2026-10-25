// Test dei 20 scenari richiesti (sezione 12 della specifica) + invarianti contabili.
import { describe, expect, it } from 'vitest';
import { compute } from '../src/domain/engine';
import { planCharge, planFuel } from '../src/domain/planner';
import { emptyState, historicalEntries, ANDREA_DEFAULTS } from '../src/domain/seed';
import { entriesCsv, makeBackup, monthlyCsv, monthlyReport, parseBackup } from '../src/domain/reports';
import { toScaled, unitPriceMilli, parseDecimal } from '../src/domain/units';
import type { AppState, Entry, Settings } from '../src/domain/types';

const T = '2026-01-01T00:00';
let n = 0;
const id = () => `e${++n}`;
const base = () => ({ id: id(), createdAt: T, updatedAt: T });

const fuel = (ts: string, odo: number, L: number, eur: number | null, pay: 'personal' | 'company', full: boolean | null = true): Entry =>
  ({ ...base(), type: 'fuel', ts, odo, litersCl: toScaled(L, 100), amountCents: eur == null ? null : toScaled(eur, 100), priceMilli: null, payment: pay, full });
const work = (ts: string, km: number, odo?: number, kmMax?: number): Entry => ({ ...base(), type: 'work', ts, km, odo, kmMax });
const read = (ts: string, odo: number, extra: Partial<Entry> = {}): Entry => ({ ...base(), type: 'reading', ts, odo, ...extra } as Entry);
const charge = (ts: string, kind: 'home' | 'public', pay: 'personal' | 'company', kwh: number | null, eur: number | null, extra: Partial<Entry> = {}): Entry =>
  ({ ...base(), type: 'charge', ts, kind, payment: pay, energyWh: kwh == null ? null : toScaled(kwh, 1000), amountCents: eur == null ? null : toScaled(eur, 100), estimated: false, ...extra } as Entry);

/** Auto consegnata con il pieno (40 l, noto), carburante iniziale a carico del dipendente → nessuna fornitura aziendale iniziale. */
function st(entries: Entry[], patch: Partial<Settings> = {}): AppState {
  const s = emptyState();
  s.settings = {
    ...s.settings, deliveryDate: '2026-11-01', deliveryOdo: 0, deliveryFuelMinL: 40, deliveryFuelMaxL: 40,
    startFuelBy: 'personal', onboarded: true, safetyMarginL: 0, ...patch,
  };
  s.entries = entries;
  return s;
}
const run = (s: AppState, now = '2026-11-20T20:00') => compute(s, { now });
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('Scenari di validazione', () => {
  it('1. settimana con soli km lavorativi: tutto il consumo misurato è lavorativo', () => {
    const r = run(st([work('2026-11-07T18:00', 500, 500), fuel('2026-11-07T19:00', 500, 25, 50, 'personal')]));
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].measured).toBe(true);
    close(r.segments[0].workShare.mid, 1);
    close(r.fuel.balanceL.lo, 25); close(r.fuel.balanceL.hi, 25);
    expect(r.fuel.reliability).toBe('alta');
  });

  it('2. settimana con soli km personali: nessun credito, un pieno aziendale crea un debito', () => {
    const s = st([read('2026-11-07T18:00', 400), fuel('2026-11-07T19:00', 400, 20, 40, 'company')]);
    const r = run(s);
    close(r.segments[0].workShare.mid, 0);
    close(r.fuel.balanceL.mid, -20);
    const p = planFuel(st([read('2026-11-07T18:00', 400)]), { full: true, liters: 20, priceMilli: 2000, amountCents: null, odo: null, extraWorkKm: null, ts: '2026-11-07T19:00' });
    expect(p.verdict).toBe('personale');
    expect(p.maxCompanyL).toBe(0);
  });

  it('3. alternanza: quota proporzionale ai km del tratto', () => {
    const r = run(st([
      work('2026-11-02T18:00', 60), work('2026-11-03T18:00', 40), work('2026-11-04T18:00', 150),
      fuel('2026-11-05T08:00', 500, 30, 60, 'personal'),
    ]));
    close(r.segments[0].workShare.mid, 250 / 500);
    close(r.fuel.balanceL.mid, 15);
  });

  it('4. viaggio prevalentemente elettrico: nessun credito fittizio dai consumi medi', () => {
    // 600 km tutti di lavoro, ma solo 3 l di benzina reintegrati: il credito è 3 l, non 600 km × 5,2 l/100
    const r = run(st([work('2026-11-10T18:00', 600, 600), fuel('2026-11-10T19:00', 600, 3, 6, 'personal')]));
    close(r.fuel.balanceL.mid, 3);
    close(r.segments[0].rateL100!.mid, 0.5);
  });

  it('5. rifornimento aziendale dopo diversi pieni personali: compatibile entro B/(1−w)', () => {
    const entries = [
      work('2026-11-03T18:00', 300, 500), fuel('2026-11-03T19:00', 500, 30, 60, 'personal'),
      work('2026-11-08T18:00', 300, 1000), fuel('2026-11-08T19:00', 1000, 30, 60, 'personal'),
      work('2026-11-13T18:00', 300, 1500), fuel('2026-11-13T19:00', 1500, 30, 60, 'personal'),
    ];
    const s = st(entries);
    const r = run(s);
    close(r.fuel.balanceL.mid, 54); // 3 × 30 × 0,6
    const p = planFuel(s, { full: true, liters: 30, priceMilli: 2000, amountCents: null, odo: 2000, extraWorkKm: 300, ts: '2026-11-18T19:00' });
    expect(p.verdict).toBe('aziendale');
    // B + 0,6 L − L ≥ 0  →  L ≤ 54 / 0,4 = 135, limitato dalla capacità del serbatoio
    expect(p.maxCompanyL).toBe(40);
    close(p.afterCompany.mid, 54 + 18 - 30);
    // dopo la registrazione il saldo coincide con la simulazione
    const after = run(st([...entries, work('2026-11-18T18:00', 300), fuel('2026-11-18T19:00', 2000, 30, 60, 'company')]), '2026-11-18T20:00');
    close(after.fuel.balanceL.mid, p.afterCompany.mid);
  });

  it('6. rifornimento aziendale oltre il saldo maturato: sconsigliato, e se registrato il saldo diventa negativo', () => {
    const entries = [work('2026-11-03T18:00', 250, 500), fuel('2026-11-03T19:00', 500, 25, 50, 'personal')]; // B = 12,5
    const s = st(entries);
    const p = planFuel(s, { full: true, liters: 40, priceMilli: 2000, amountCents: null, odo: 1300, extraWorkKm: 400, ts: '2026-11-10T19:00' });
    // max: 12,5 + 0,5 L − L ≥ 0 → L ≤ 25
    close(p.maxCompanyL, 25, 0.11);
    expect(p.verdict).toBe('parziale');
    const after = run(st([...entries, work('2026-11-10T18:00', 400), fuel('2026-11-10T19:00', 1300, 40, 80, 'company')]), '2026-11-10T20:00');
    close(after.fuel.balanceL.mid, 12.5 + 20 - 40);
  });

  it('7. rifornimento parziale: non chiude il tratto, il pieno successivo riconcilia senza doppi conteggi', () => {
    const e = [
      work('2026-11-02T18:00', 200, 400), fuel('2026-11-02T19:00', 400, 10, 20, 'company', false),
      work('2026-11-06T18:00', 200, 800), fuel('2026-11-06T19:00', 800, 30, 60, 'personal', true),
    ];
    const mid = run(st(e.slice(0, 2)), '2026-11-02T20:00');
    expect(mid.segments).toHaveLength(0);
    expect(mid.open?.endKind).toBe('aperto');
    const r = run(st(e));
    expect(r.segments).toHaveLength(1);
    close(r.segments[0].consumedL.mid, 40); // 10 + 30 litri reintegrati
    close(r.fuel.balanceL.mid, 40 * 0.5 - 10);
  });

  it('8. ricarica pubblica tramite UTA e+: saldo in kWh separato dalla benzina', () => {
    const base8 = [work('2026-11-05T18:00', 300, 500), charge('2026-11-04T12:00', 'public', 'personal', 30, 18)];
    const s = st(base8);
    const r = run(s);
    close(r.electric.balanceKwh.mid, 30 * 0.6);
    close(r.fuel.balanceL.mid, r.fuel.accruedWorkL.mid - r.fuel.companyL); // nessuna contaminazione
    const p = planCharge(s, { kwh: 20, priceMilliKwh: 600, amountCents: null, workDedicated: false, ts: '2026-11-06T12:00' });
    // 18 + 0,6 E − E ≥ 0 → E ≤ 45
    expect(p.verdict).toBe('aziendale');
    close(p.maxCompanyKwh, 45, 1e-6);
    const p2 = planCharge(st([]), { kwh: 20, priceMilliKwh: 600, amountCents: null, workDedicated: false, ts: '2026-11-06T12:00' });
    expect(p2.verdict).toBe('personale');
  });

  it('9. ricarica domestica senza misura precisa: registrata e stimata, nessun credito per default', () => {
    const e = [work('2026-11-05T18:00', 300, 500), charge('2026-11-30T20:00', 'home', 'personal', 6 * 21.7, null, { estimated: true, sessions: 6, tsFrom: '2026-11-01T00:00' })];
    const r = run(st(e));
    close(r.electric.homeWh, 130200);
    close(r.electric.homeEstimatedWh, 130200);
    close(r.electric.balanceKwh.mid, 0);
    expect(r.electric.homeWorkValueEur.mid).toBeGreaterThan(0); // solo statistica
    const r2 = run(st(e, { homeChargingInBalance: true }));
    expect(r2.electric.balanceKwh.mid).toBeGreaterThan(0);
  });

  it('10. km non aggiornati per più giorni: avviso e raccomandazione cauta', () => {
    const s = st([read('2026-11-02T18:00', 100)], { deliveryFuelMinL: 0, deliveryFuelMaxL: 40 });
    const r = run(s, '2026-11-20T20:00');
    expect(r.stale).toBe(true);
    expect(r.warnings.some((w) => w.text.includes('non aggiornati'))).toBe(true);
    const p = planFuel(s, { full: false, liters: 20, priceMilli: 2000, amountCents: null, odo: null, extraWorkKm: null, ts: '2026-11-20T20:00' });
    expect(['insufficienti', 'personale']).toContain(p.verdict);
    // km lavorativi registrati dopo l'ultima lettura: conteggiati, con avviso
    const r2 = run(st([read('2026-11-02T18:00', 100), work('2026-11-03T18:00', 80)]), '2026-11-04T08:00');
    expect(r2.odoExtendedByWorkKm).toBe(80);
    expect(r2.fuel.accruedWorkL.mid).toBeGreaterThan(0);
  });

  it('11. modifica retroattiva: il ricalcolo completo riconcilia i saldi', () => {
    const f = fuel('2026-11-03T19:00', 500, 25, 50, 'personal');
    const e = [work('2026-11-03T18:00', 250, 500), f];
    const before = run(st(e)).fuel.balanceL.mid;
    const edited = e.map((x) => (x.id === f.id ? { ...f, payment: 'company' as const } : x));
    const after = run(st(edited)).fuel.balanceL.mid;
    close(before - after, 25); // cambia esattamente dei litri pagati dall'azienda
    const edited2 = e.map((x) => (x.id === f.id ? { ...f, litersCl: 3000 } : x));
    close(run(st(edited2)).fuel.balanceL.mid, 15);
    // eliminazione: il tratto torna aperto
    expect(run(st([e[0]])).segments).toHaveLength(0);
  });

  it('12. rifornimento oltre il plafond residuo: limitato dal plafond', () => {
    const e = [
      work('2026-11-03T18:00', 3000, 3000), fuel('2026-11-03T19:00', 3000, 40, 80, 'personal'),
      fuel('2026-11-04T19:00', 3000, 0.01, 470, 'company', false),
    ];
    const s = st(e, { tankCapacityL: 60 });
    const r = run(s, '2026-11-10T10:00');
    expect(r.plafond.remainingCents).toBe(3000);
    const p = planFuel(s, { full: true, liters: 30, priceMilli: 2000, amountCents: null, odo: 3600, extraWorkKm: 600, ts: '2026-11-10T10:00' });
    expect(p.plafondMaxL).toBe(15);
    expect(p.maxCompanyL).toBe(15);
    expect(p.verdict).toBe('parziale');
    expect(p.reasons.join(' ')).toContain('plafond');
    // rinnovo configurabile: con rinnovo il 5, la spesa del 4 appartiene al periodo precedente
    const r2 = run(st(e, { plafondResetDay: 5 }), '2026-11-10T10:00');
    expect(r2.plafond.periodStart).toBe('2026-11-05');
    expect(r2.plafond.remainingCents).toBe(50000);
  });

  it('13. saldo iniziale non ricostruibile: dati reali di Andrea → intervallo dichiarato, nessun valore esatto', () => {
    const s = emptyState();
    s.entries = historicalEntries(ANDREA_DEFAULTS, T);
    const r = compute(s, { now: '2026-10-23T23:00' });
    expect(r.fuel.balanceL.hi - r.fuel.balanceL.lo).toBeGreaterThan(15);
    expect(r.fuel.balanceL.lo).toBeLessThan(0);
    expect(r.fuel.balanceL.hi).toBeGreaterThan(0);
    expect(r.fuel.historyWidthL).toBeGreaterThan(10);
    // la scorta attuale è delimitata fisicamente (39,03 l in un serbatoio da 40 l, poi 158 km)
    expect(r.stockNow.lo).toBeGreaterThan(27);
    expect(r.stockNow.hi).toBeLessThanOrEqual(40);
    // conoscere il carburante alla consegna restringe l'intervallo
    const s2 = { ...s, settings: { ...s.settings, deliveryFuelMinL: 17.5, deliveryFuelMaxL: 22.5 } };
    const r2 = compute(s2, { now: '2026-10-23T23:00' });
    expect(r2.fuel.balanceL.hi - r2.fuel.balanceL.lo).toBeLessThan(r.fuel.balanceL.hi - r.fuel.balanceL.lo - 10);
    // modalità ripartenza: saldo dalla data di riferimento, storico conservato nei report
    const s3 = { ...s, settings: { ...s.settings, historyMode: 'reset' as const, referenceTs: '2026-10-23T22:00' } };
    const r3 = compute(s3, { now: '2026-10-23T23:00' });
    expect(r3.start.mode).toBe('reset');
    expect(monthlyReport(s3).rows.find((m) => m.month === '2026-10')!.fuelCompanyCents).toBe(7767);
  });

  it('14. consumi medi stimati vs effettivi: dopo due pieni si usa il consumo misurato', () => {
    const e = [
      read('2026-11-02T18:00', 300), fuel('2026-11-02T19:00', 300, 10, 20, 'personal'),
      read('2026-11-08T18:00', 1100), fuel('2026-11-08T19:00', 1100, 20, 40, 'personal'),
    ];
    const r = run(st(e));
    expect(r.rate.source).toBe('misurato');
    close(r.rate.mid, 20 / 800);
    const r0 = run(st([]));
    expect(r0.rate.source).toBe('predefinito');
    // computer di bordo "dal rifornimento" (avanzato)
    const r2 = run(st([...e, read('2026-11-12T18:00', 1400, { tripAvgL100: 3 } as Partial<Entry>)]));
    expect(r2.rate.source).toBe('computer di bordo');
    close(r2.rate.mid, 0.03);
  });

  it('15. prezzo o importo mancanti: litri conteggiati, spesa segnalata come mancante', () => {
    const e = [work('2026-11-03T18:00', 250, 500), fuel('2026-11-03T19:00', 500, 25, null, 'company')];
    const r = run(st(e));
    close(r.fuel.companyL, 25);
    expect(r.totals.fuelMissingAmount).toBe(1);
    expect(r.plafond.missingAmounts).toBe(1);
    expect(monthlyReport(st(e)).rows.find((m) => m.month === '2026-11')!.fuelMissingAmount).toBe(1);
    // solo prezzo: importo calcolato
    const f: Entry = { ...fuel('2026-11-03T19:00', 500, 25, null, 'personal'), priceMilli: 1999 } as Entry;
    expect(run(st([f])).totals.fuelPersonalCents).toBe(4998); // 25 × 1,999 = 49,975 → 49,98
  });

  it('16-17. backup: esportazione, validazione e ripristino su altro dispositivo senza perdite', () => {
    const s = emptyState();
    s.entries = historicalEntries(ANDREA_DEFAULTS, T);
    s.settings.onboarded = true;
    const text = JSON.stringify(makeBackup(s, '2026-10-24T08:00'));
    const b = parseBackup(text);
    expect(b.state.entries).toEqual(s.entries);
    expect(compute(b.state, { now: '2026-10-24T08:00' }).fuel.balanceL).toEqual(compute(s, { now: '2026-10-24T08:00' }).fuel.balanceL);
    expect(() => parseBackup('{}')).toThrow(/non è un backup/);
    expect(() => parseBackup('ciao')).toThrow(/JSON/);
    expect(() => parseBackup(JSON.stringify({ ...makeBackup(s, T), schemaVersion: 99 }))).toThrow(/più recente/);
    const dup = makeBackup({ ...s, entries: [s.entries[0], s.entries[0]] }, T);
    expect(() => parseBackup(JSON.stringify(dup))).toThrow(/duplicati/);
  });

  it('18. ricostruzione automatica dello storico iniziale con date e importi reali', () => {
    const s = emptyState();
    s.entries = historicalEntries(ANDREA_DEFAULTS, T);
    const { rows, aggregates } = monthlyReport(s);
    const sep = rows.find((m) => m.month === '2026-09')!, oct = rows.find((m) => m.month === '2026-10')!;
    expect(sep.fuelPersonalCents).toBe(6400); expect(sep.fuelCompanyCents).toBe(0); expect(sep.fuelCount).toBe(1);
    expect(oct.fuelPersonalCents).toBe(7100); expect(oct.fuelCompanyCents).toBe(7767); expect(oct.fuelCount).toBe(2);
    // i km lavorativi storici non vengono attribuiti a settembre/ottobre
    expect(sep.workKm).toBe(0); expect(oct.workKm).toBe(0);
    expect(aggregates).toHaveLength(1);
    const r = compute(s, { now: '2026-10-23T23:00' });
    expect(r.totals.fuelPersonalCents).toBe(13500);
    expect(r.totals.fuelCompanyCents).toBe(7767);
    expect(r.totals.km).toBe(2910);
    expect(entriesCsv(s)).toContain('rifornimento;2026-10-23T08:00;;2752;39,03;;77,67;1,990;aziendale');
    expect(monthlyCsv(s)).toContain('2026-09;1;64,00;0,00');
  });

  it('19. prezzo unitario da litri e importo, senza errori floating-point', () => {
    expect(unitPriceMilli(6400, 3234, 100)).toBe(1979);  // 64,00 / 32,34 = 1,97897
    expect(unitPriceMilli(7100, 3568, 100)).toBe(1990);  // 1,98991
    expect(unitPriceMilli(7767, 3903, 100)).toBe(1990);  // 1,99001
    expect(toScaled(32.34, 100)).toBe(3234);
    expect(toScaled(0.1 + 0.2, 100)).toBe(30);
    expect(parseDecimal('77,67')).toBe(77.67);
    expect(parseDecimal('2.910')).toBe(2910);
    expect(parseDecimal('1.234,5')).toBe(1234.5);
    // somma di importi in centesimi interi
    const sum = [6400, 7100, 7767].reduce((a, b) => a + b, 0);
    expect(sum).toBe(21267);
  });

  it('20. distinzione spese personali/aziendali nei report mensili, incluse le ricariche', () => {
    const e = [
      fuel('2026-11-03T19:00', 500, 25, 50, 'personal'), fuel('2026-11-20T19:00', 900, 20, 41.5, 'company'),
      charge('2026-11-21T10:00', 'public', 'company', 15, 9.75), charge('2026-12-02T10:00', 'public', 'personal', 10, 7),
    ];
    const { rows } = monthlyReport(st(e));
    const nov = rows.find((m) => m.month === '2026-11')!, dec = rows.find((m) => m.month === '2026-12')!;
    expect(nov.fuelPersonalCents).toBe(5000); expect(nov.fuelCompanyCents).toBe(4150);
    expect(nov.publicCompanyCents).toBe(975); expect(dec.publicPersonalCents).toBe(700);
    const r = run(st(e), '2026-11-25T10:00');
    expect(r.plafond.spentCents).toBe(4150 + 975);
    expect(run(st(e, { plafondIncludesCharging: false }), '2026-11-25T10:00').plafond.spentCents).toBe(4150);
  });
});

describe('Invarianti contabili', () => {
  it('nessun doppio conteggio: maturato lavorativo + personale = benzina consumata', () => {
    const e = [
      work('2026-11-03T18:00', 120, 500), fuel('2026-11-03T19:00', 500, 25, 50, 'personal'),
      work('2026-11-06T18:00', 330, 900), fuel('2026-11-06T19:00', 900, 12, 24, 'company', false),
      work('2026-11-09T18:00', 10, 1400), fuel('2026-11-09T19:00', 1400, 22, 44, 'company'),
    ];
    const r = run(st(e));
    const consumed = r.segments.reduce((a, s) => a + s.consumedL.mid, 0);
    close(consumed, 25 + 12 + 22); // pieno iniziale noto → consumo = acquistato
    const personalL = r.segments.reduce((a, s) => a + s.consumedL.mid * (1 - s.workShare.mid), 0);
    close(r.fuel.accruedWorkL.mid + personalL, consumed);
    close(r.fuel.balanceL.mid, r.fuel.accruedWorkL.mid - 34);
  });

  it('carburante iniziale fornito dall\'azienda riduce il saldo (criterio prudente)', () => {
    const e = [work('2026-11-03T18:00', 500, 500), fuel('2026-11-03T19:00', 500, 25, 50, 'personal')];
    close(run(st(e)).fuel.balanceL.mid, 25);
    close(run(st(e, { startFuelBy: 'company' })).fuel.balanceL.mid, 25 - 40);
  });

  it('km lavorativi superiori ai km percorsi: errore segnalato e quota limitata a 100%', () => {
    const r = run(st([work('2026-11-03T18:00', 700), fuel('2026-11-03T19:00', 500, 25, 50, 'personal')]));
    expect(r.warnings.some((w) => w.level === 'errore')).toBe(true);
    expect(r.segments[0].workShare.hi).toBeLessThanOrEqual(1);
  });

  it('contachilometri decrescente segnalato', () => {
    const r = run(st([read('2026-11-03T18:00', 500), read('2026-11-04T18:00', 450)]));
    expect(r.warnings.some((w) => w.text.includes('Contachilometri non coerente'))).toBe(true);
  });

  it('tetto al credito riportabile', () => {
    const e = [work('2026-11-03T18:00', 500, 500), fuel('2026-11-03T19:00', 500, 25, 50, 'personal')];
    close(run(st(e, { maxCarryL: 10 })).fuel.balanceL.mid, 10);
  });

  it('il criterio prudente non consiglia mai più del criterio centrale', () => {
    const s = emptyState();
    s.entries = historicalEntries(ANDREA_DEFAULTS, T);
    s.settings.deliveryFuelMinL = 0; s.settings.deliveryFuelMaxL = 10;
    const inp = { full: true, liters: null, priceMilli: null, amountCents: null, odo: 3600, extraWorkKm: 500, ts: '2026-11-01T10:00' };
    const pr = planFuel(s, inp);
    const ce = planFuel({ ...s, settings: { ...s.settings, decisionBasis: 'centrale' } }, inp);
    expect(pr.maxCompanyL).toBeLessThanOrEqual(ce.maxCompanyL);
  });
});
