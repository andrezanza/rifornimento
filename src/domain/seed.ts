import type { AppState, Entry, Settings } from './types';

export const SCHEMA_VERSION = 1;

export function defaultSettings(): Settings {
  return {
    vehicleName: 'CUPRA Formentor e-HYBRID 2026',
    deliveryDate: '2026-09-18',
    deliveryOdo: 0,
    tankCapacityL: 40,
    batteryNetKwh: 19.7,
    deliveryFuelMinL: 0,
    deliveryFuelMaxL: 40,
    startFuelBy: 'company',
    fallbackRateL100: 5.2,
    fallbackRateMinL100: 2.0,
    fallbackRateMaxL100: 7.0,
    maxRateL100: 8.0,
    fuelLevelTol: 0.0625,
    tripComputerTol: 0.1,
    boardAvgKmL: 19.3,
    boardAvgKwh100: 5.2,
    decisionBasis: 'prudente',
    safetyMarginL: 1,
    minPartialL: 10,
    maxCarryL: null,
    historyMode: 'include',
    referenceTs: '2026-10-23T22:00',
    homeChargingInBalance: false,
    homeEnergyPriceMilli: 250,
    staleDays: 7,
    plafondCents: 50000,
    plafondResetDay: 1,
    plafondIncludesCharging: true,
    plafondVerified: false,
    policyAgreed: false,
    onboarded: false,
    lastBackupAt: null,
  };
}

export function emptyState(): AppState {
  return { schemaVersion: SCHEMA_VERSION, entries: [], settings: defaultSettings(), audit: [] };
}

export interface InitialData {
  currentOdo: number;
  currentTs: string;
  workKmMin: number;
  workKmMax: number;
  /** livello carburante alla consegna, se ricordato (0..1); null = non noto */
  deliveryLevel: number | null;
  /** livello attuale letto sull'indicatore (0..1); null = non letto */
  currentLevel: number | null;
}

export const ANDREA_DEFAULTS: InitialData = {
  currentOdo: 2910,
  currentTs: '2026-10-23T22:00',
  workKmMin: 1650,
  workKmMax: 1660,
  deliveryLevel: null,
  currentLevel: null,
};

/** Storico reale fornito da Andrea (dati certi: date, contachilometri, litri, importi, pagamento). */
export function historicalEntries(d: InitialData, at: string): Entry[] {
  const base = { source: 'storico' as const, createdAt: at, updatedAt: at };
  const entries: Entry[] = [
    { ...base, id: 'storico-fuel-1', type: 'fuel', ts: '2026-09-30T12:00', odo: 1220, litersCl: 3234, amountCents: 6400, priceMilli: null, payment: 'personal', full: null, note: 'Storico. Pieno/parziale non noto.' },
    { ...base, id: 'storico-fuel-2', type: 'fuel', ts: '2026-10-11T12:00', odo: 1981, litersCl: 3568, amountCents: 7100, priceMilli: null, payment: 'personal', full: null, note: 'Storico. Pieno/parziale non noto.' },
    { ...base, id: 'storico-fuel-3', type: 'fuel', ts: '2026-10-23T08:00', odo: 2752, litersCl: 3903, amountCents: 7767, priceMilli: null, payment: 'company', full: null, note: 'Storico. Carta UTA e+. Pieno/parziale non noto (39,03 l su serbatoio da 40 l: probabilmente quasi vuoto prima).' },
    {
      ...base, id: 'storico-work-1', type: 'work', tsFrom: '2026-09-18T00:00', ts: d.currentTs,
      km: d.workKmMin, kmMax: d.workKmMax > d.workKmMin ? d.workKmMax : undefined,
      note: 'Stima storica aggregata dalla consegna: non ripartibile per mese o per intervallo tra rifornimenti.',
    },
    {
      ...base, id: 'storico-reading-1', type: 'reading', ts: d.currentTs, odo: d.currentOdo,
      fuelLevel: d.currentLevel ?? undefined,
      note: 'Rilevazione iniziale (onboarding). Computer di bordo: 19,3 km/l e 5,2 kWh/100 km (medie, non usate come misura).',
    },
  ];
  return entries;
}
