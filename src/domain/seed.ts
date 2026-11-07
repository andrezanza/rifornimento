import type { AppState, Entry, Settings, WorkPurpose } from './types';

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
    referenceTs: '2026-10-25T11:00',
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
  /** livello attuale letto sull'indicatore (0..1); null = non letto */
  currentLevel: number | null;
}

/** Ultima rilevazione comunicata da Andrea il 25/10/2026: 3.073 km, indicatore circa a metà. */
export const ANDREA_DEFAULTS: InitialData = {
  currentOdo: 3073,
  currentTs: '2026-10-25T11:00',
  currentLevel: 0.5,
};

/**
 * Consegna 18/09/2026 a 40 km (verbale). Benzina alla consegna:
 * - dal pieno di 35,87 l a 48 km su serbatoio nominale da 40 l → 4,1–4,8 l;
 * - dal ricordo "circa 1/4, un po' meno, non in riserva" → fino a circa 8 l
 *   (compatibile se la capacità reale supera di poco i 40 l nominali).
 * Si usa l'intervallo che copre entrambe le indicazioni; il criterio prudente usa il valore più alto.
 */
export const ANDREA_SETTINGS: Partial<Settings> = {
  deliveryOdo: 40,
  deliveryFuelMinL: 4.1,
  deliveryFuelMaxL: 8,
  plafondCents: 60000,
};

/** Tragitti lavorativi ricostruiti da Andrea (dati certi: data, tipo, km). */
export const ANDREA_TRIPS: { date: string; km: number; purpose: WorkPurpose; note: string }[] = [
  { date: '2026-09-21', km: 169, purpose: 'casa-lavoro', note: 'Casa-lavoro e ritorno' },
  { date: '2026-09-24', km: 169, purpose: 'casa-lavoro', note: 'Casa-lavoro e ritorno' },
  { date: '2026-09-29', km: 169, purpose: 'casa-lavoro', note: 'Casa-lavoro e ritorno' },
  { date: '2026-10-02', km: 155, purpose: 'casa-lavoro', note: 'Casa-lavoro e ritorno' },
  { date: '2026-10-06', km: 151, purpose: 'casa-lavoro', note: 'Casa-lavoro e ritorno' },
  { date: '2026-10-07', km: 99, purpose: 'trasferta', note: 'Trasferta: casa-cliente e ritorno' },
  { date: '2026-10-09', km: 151, purpose: 'casa-lavoro', note: 'Casa-lavoro e ritorno' },
  { date: '2026-10-13', km: 155, purpose: 'casa-lavoro', note: 'Casa-lavoro e ritorno' },
  { date: '2026-10-16', km: 148, purpose: 'casa-lavoro', note: 'Casa-lavoro e ritorno' },
  { date: '2026-10-21', km: 148, purpose: 'casa-lavoro', note: 'Casa-lavoro e ritorno' },
  { date: '2026-10-23', km: 148, purpose: 'casa-lavoro', note: 'Casa-lavoro e ritorno (dopo il rifornimento delle 08:00)' },
];

/** Storico reale fornito da Andrea (dati certi: date, contachilometri, litri, importi, pagamento, pieni). */
export function historicalEntries(d: InitialData, at: string): Entry[] {
  const base = { source: 'storico' as const, createdAt: at, updatedAt: at };
  const full = 'Storico. Pieno completo (confermato).';
  const derived = (p: string) => `Storico. Pieno completo. Importo certo; litri ricavati dal prezzo ricordato (${p} €/l), coerente con le medie MIMIT del giorno ma non verificato sull'impianto.`;
  const entries: Entry[] = [
    { ...base, id: 'storico-fuel-0a', type: 'fuel', ts: '2026-09-18T12:00', odo: 48, litersCl: 3587, amountCents: 7601, priceMilli: null, payment: 'personal', full: true, litersEstimated: true, note: `${derived('2,119')} Eni, Via Altinia 282, Venezia.` },
    { ...base, id: 'storico-fuel-0b', type: 'fuel', ts: '2026-09-20T12:00', odo: 512, litersCl: 2968, amountCents: 6200, priceMilli: null, payment: 'personal', full: true, litersEstimated: true, note: `${derived('2,089')} Iper Staroil, Via E. Bacchion 3, Venezia.` },
    { ...base, id: 'storico-fuel-1', type: 'fuel', ts: '2026-09-30T12:00', odo: 1220, litersCl: 3234, amountCents: 6400, priceMilli: null, payment: 'personal', full: true, note: full },
    { ...base, id: 'storico-fuel-2', type: 'fuel', ts: '2026-10-11T12:00', odo: 1981, litersCl: 3568, amountCents: 7100, priceMilli: null, payment: 'personal', full: true, note: full },
    { ...base, id: 'storico-fuel-3', type: 'fuel', ts: '2026-10-23T08:00', odo: 2752, litersCl: 3903, amountCents: 7767, priceMilli: null, payment: 'company', full: true, note: full + ' Carta UTA e+.' },
    ...ANDREA_TRIPS.map((t, i): Entry => ({
      ...base, id: `storico-work-${i + 1}`, type: 'work', ts: `${t.date}T18:00`, km: t.km, purpose: t.purpose, note: t.note,
    })),
    {
      ...base, id: 'storico-reading-1', type: 'reading', ts: '2026-10-23T22:00', odo: 2910,
      note: 'Rilevazione del 23/10. Computer di bordo: 19,3 km/l e 5,2 kWh/100 km (medie, non usate come misura).',
    },
  ];
  if (d.currentOdo !== 2910 || d.currentTs !== '2026-10-23T22:00') {
    // rilevazione corrente (onboarding)
    entries.push({
      ...base, id: 'storico-reading-2', type: 'reading', ts: d.currentTs, odo: d.currentOdo,
      fuelLevel: d.currentLevel ?? undefined, note: 'Rilevazione iniziale (onboarding).',
    });
  }
  return entries;
}

/** Movimenti dal 25/10 al 07/11/2026, ricostruiti da Andrea dopo la perdita dei dati sul telefono. */
export function recoveredEntries(at: string): Entry[] {
  const base = { source: 'manuale' as const, createdAt: at, updatedAt: at };
  const rec = 'Ricostruito il 07/11 (dati persi sul telefono).';
  return [
    { ...base, id: 'rec-work-1', type: 'work', ts: '2026-10-27T18:00', km: 146, purpose: 'casa-lavoro', note: `Casa-lavoro e ritorno. ${rec}` },
    { ...base, id: 'rec-work-2', type: 'work', ts: '2026-10-28T17:00', km: 143, purpose: 'casa-lavoro', odo: 3369, note: `Casa-lavoro-distributore (prima del rifornimento). ${rec}` },
    { ...base, id: 'rec-fuel-1', type: 'fuel', ts: '2026-10-28T17:15', odo: 3369, litersCl: 3800, amountCents: 7558, priceMilli: 1989, payment: 'company', full: true, note: `Pieno fino allo scatto. Carta UTA e+. Tatanka, Via E. Bacchion 6, Venezia. ${rec}` },
    { ...base, id: 'rec-work-3', type: 'work', ts: '2026-10-28T17:30', km: 6, purpose: 'casa-lavoro', note: `Distributore-casa (ritorno del casa-lavoro). ${rec}` },
    { ...base, id: 'rec-work-4', type: 'work', ts: '2026-11-03T18:00', km: 92, purpose: 'trasferta', note: `Trasferta casa-cliente e ritorno. ${rec}` },
    { ...base, id: 'rec-work-5', type: 'work', ts: '2026-11-04T18:00', km: 148, purpose: 'casa-lavoro', note: `Casa-lavoro e ritorno. ${rec}` },
    {
      ...base, id: 'rec-charge-1', type: 'charge', ts: '2026-11-05T15:41', kind: 'public', payment: 'company', energyWh: 21704, amountCents: 2127, estimated: false,
      note: `Ricarica rapida CCS (DC) 0→100%, 49 min 45 s, media 26,22 kW. Magic Smart, Via Vecchia Ferriera 13, Vicenza. Carta UTA e+. Importo stimato: 21,704 kWh × 0,980 €/kWh, da verificare sul movimento Edenred UTA. ${rec}`,
    },
    { ...base, id: 'rec-work-6', type: 'work', ts: '2026-11-05T18:00', km: 173, purpose: 'casa-lavoro', note: `Casa-lavoro e ritorno. ${rec}` },
    {
      ...base, id: 'rec-reading-1', type: 'reading', ts: '2026-11-07T15:40', odo: 3886, fuelLevel: 0.4375, tripAvgL100: 5.21, tripAvgKwh100: 7.3,
      note: 'Indicatore poco meno di metà, batteria al 58%. Computer di bordo dal 28/10 (517 km): 19,2 km/l, 7,3 kWh/100 km. Totale: 18,8 km/l, 5,2 kWh/100 km.',
    },
  ];
}
