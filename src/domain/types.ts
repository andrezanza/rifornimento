// Modello dei dati. Unità intere per evitare errori floating-point:
//   denaro  -> centesimi (int)
//   benzina -> centilitri (int)   32,34 l = 3234 cl
//   energia -> wattora (int)      12,5 kWh = 12500 Wh
//   prezzo  -> millesimi di euro per litro/kWh (int) 1,979 €/l = 1979

export type Payment = 'personal' | 'company';

/** Qualità del dato: certo (misurato/ricevuta), stimato, sconosciuto. */
export type Quality = 'certo' | 'stimato';

interface Base {
  id: string;
  /** Data e ora ISO locale (YYYY-MM-DDTHH:mm). Determina l'ordine cronologico. */
  ts: string;
  note?: string;
  /** 'storico' = importato all'onboarding, 'manuale' = inserito dall'utente */
  source?: 'storico' | 'manuale';
  createdAt: string;
  updatedAt: string;
}

export interface FuelEntry extends Base {
  type: 'fuel';
  odo: number;
  litersCl: number;
  amountCents: number | null;
  /** €/l in millesimi; se assente si ricava da importo/litri */
  priceMilli: number | null;
  payment: Payment;
  /** true = pieno fino allo scatto della pistola; false = parziale; null = non noto */
  full: boolean | null;
}

export type ChargeKind = 'home' | 'public';

export interface ChargeEntry extends Base {
  type: 'charge';
  kind: ChargeKind;
  payment: Payment;
  /** Inizio del periodo, per registrazioni aggregate (es. ricariche domestiche del mese) */
  tsFrom?: string;
  energyWh: number | null;
  amountCents: number | null;
  /** energia stimata (es. n. ricariche x kWh medi) invece che misurata */
  estimated: boolean;
  sessions?: number;
  odo?: number;
  /** quota lavorativa dichiarata dall'utente: 'proporzionale' (default) o 'lavoro' (100%) */
  attribution?: 'proporzionale' | 'lavoro';
}

export type WorkPurpose = 'casa-lavoro' | 'trasferta' | 'altro';

export interface WorkEntry extends Base {
  type: 'work';
  /** tipo di tragitto lavorativo */
  purpose?: WorkPurpose;
  /** km lavorativi (limite inferiore se kmMax presente) */
  km: number;
  /** limite superiore se il dato è un intervallo (es. storico 1650–1660) */
  kmMax?: number;
  /** inizio del periodo aggregato; se assente il dato è riferito al giorno ts */
  tsFrom?: string;
  /** contachilometri a fine registrazione, se annotato */
  odo?: number;
}

export interface ReadingEntry extends Base {
  type: 'reading';
  odo: number;
  /** livello serbatoio letto sull'indicatore (0..1), modalità avanzata */
  fuelLevel?: number;
  /** consumo medio benzina "dal rifornimento" del computer di bordo, l/100 km */
  tripAvgL100?: number;
  /** consumo medio elettrico computer di bordo, kWh/100 km (solo statistica) */
  tripAvgKwh100?: number;
  /** km percorsi in elettrico, se disponibili (solo statistica) */
  evKm?: number;
}

export type Entry = FuelEntry | ChargeEntry | WorkEntry | ReadingEntry;
export type EntryType = Entry['type'];

export interface Settings {
  vehicleName: string;
  deliveryDate: string; // YYYY-MM-DD
  deliveryOdo: number;
  tankCapacityL: number;
  batteryNetKwh: number;
  /** carburante presente alla consegna (intervallo litri). Sconosciuto = [0, capacità] */
  deliveryFuelMinL: number;
  deliveryFuelMaxL: number;
  /** chi ha fornito il carburante presente nel serbatoio all'inizio della contabilità
   *  (alla consegna, oppure alla data di riferimento in modalità 'reset') */
  startFuelBy: Payment;
  /** consumo benzina di riferimento in assenza di misure (l/100 km) e intervallo plausibile */
  fallbackRateL100: number;
  fallbackRateMinL100: number;
  fallbackRateMaxL100: number;
  /** consumo massimo fisicamente plausibile (l/100 km), usato per i limiti */
  maxRateL100: number;
  /** tolleranza lettura indicatore serbatoio (frazione di serbatoio) */
  fuelLevelTol: number;
  /** tolleranza lettura computer di bordo (frazione, 0.1 = ±10%) */
  tripComputerTol: number;
  /** consumi da computer di bordo all'onboarding (solo riferimento) */
  boardAvgKmL: number;
  boardAvgKwh100: number;

  /** criterio decisionale: limite inferiore (prudente) o valore centrale */
  decisionBasis: 'prudente' | 'centrale';
  /** margine di sicurezza in litri sottratto al saldo nelle raccomandazioni */
  safetyMarginL: number;
  /** quantità minima sensata per un rifornimento parziale */
  minPartialL: number;
  /** tetto al credito riportabile (litri). null = nessun tetto */
  maxCarryL: number | null;
  /** storico pre-riferimento: incluso nel saldo oppure azzerato alla data di riferimento */
  historyMode: 'include' | 'reset';
  referenceTs: string;
  /** ricariche domestiche nel saldo elettrico (default no: solo statistica) */
  homeChargingInBalance: boolean;
  /** valorizzazione energia domestica (€/kWh in millesimi), solo statistica */
  homeEnergyPriceMilli: number;
  /** giorni dopo i quali i km sono considerati non aggiornati */
  staleDays: number;

  plafondCents: number;
  /** giorno di rinnovo del plafond (1-28) */
  plafondResetDay: number;
  /** il plafond comprende anche le ricariche elettriche */
  plafondIncludesCharging: boolean;
  /** condizioni del plafond verificate con l'azienda/Edenred */
  plafondVerified: boolean;
  /** regole di ripartizione concordate formalmente con l'azienda */
  policyAgreed: boolean;

  onboarded: boolean;
  lastBackupAt: string | null;
}

export interface AuditRecord {
  at: string;
  action: 'create' | 'update' | 'delete' | 'import' | 'settings' | 'restore';
  entityId?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
}

export interface AppState {
  schemaVersion: number;
  entries: Entry[];
  settings: Settings;
  audit: AuditRecord[];
}

/** intervallo numerico [lo, hi] con valore centrale */
export interface Range {
  lo: number;
  mid: number;
  hi: number;
}
