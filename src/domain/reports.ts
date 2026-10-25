import type { AppState, ChargeEntry, Entry, FuelEntry, WorkEntry } from './types';
import { sortEntries, fuelAmountCents, fuelPriceMilli, chargePriceMilli, plafondPeriod } from './engine';
import { SCHEMA_VERSION } from './seed';

export interface MonthRow {
  month: string; // YYYY-MM
  fuelCount: number;
  fuelPersonalCents: number;
  fuelCompanyCents: number;
  fuelPersonalCl: number;
  fuelCompanyCl: number;
  fuelMissingAmount: number;
  homeWh: number;
  homeCents: number;
  publicPersonalWh: number;
  publicPersonalCents: number;
  publicCompanyWh: number;
  publicCompanyCents: number;
  workKm: number;
  workKmMax: number;
  /** km totali del mese ricavati dal contachilometri (interpolato se necessario) */
  kmTotal: number | null;
  kmEstimated: boolean;
}

export interface AggregateWork {
  entry: WorkEntry;
  from: string;
  to: string;
}

const ym = (ts: string) => ts.slice(0, 7);

function odoPoints(state: AppState): { t: number; odo: number; ts: string }[] {
  const s = state.settings;
  const pts = [{ ts: `${s.deliveryDate}T00:00`, odo: s.deliveryOdo }];
  for (const e of sortEntries(state.entries)) {
    const o = e.type === 'fuel' || e.type === 'reading' ? e.odo : e.odo;
    if (o != null && o >= pts[pts.length - 1].odo) pts.push({ ts: e.ts, odo: o });
  }
  return pts.map((p) => ({ ...p, t: new Date(p.ts).getTime() }));
}

/** Contachilometri a una data, per interpolazione lineare. null se oltre l'ultima lettura. */
export function odoAt(state: AppState, ts: string): { odo: number; exact: boolean } | null {
  const pts = odoPoints(state);
  const t = new Date(ts).getTime();
  if (t < pts[0].t) return null;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].t === t) return { odo: pts[i].odo, exact: true };
    if (i + 1 < pts.length && pts[i].t < t && t < pts[i + 1].t) {
      const f = (t - pts[i].t) / (pts[i + 1].t - pts[i].t);
      return { odo: pts[i].odo + f * (pts[i + 1].odo - pts[i].odo), exact: false };
    }
  }
  return null;
}

export function monthlyReport(state: AppState): { rows: MonthRow[]; aggregates: AggregateWork[] } {
  const entries = sortEntries(state.entries);
  const map = new Map<string, MonthRow>();
  const row = (m: string): MonthRow => {
    let r = map.get(m);
    if (!r) {
      r = {
        month: m, fuelCount: 0, fuelPersonalCents: 0, fuelCompanyCents: 0, fuelPersonalCl: 0, fuelCompanyCl: 0,
        fuelMissingAmount: 0, homeWh: 0, homeCents: 0, publicPersonalWh: 0, publicPersonalCents: 0,
        publicCompanyWh: 0, publicCompanyCents: 0, workKm: 0, workKmMax: 0, kmTotal: null, kmEstimated: true,
      };
      map.set(m, r);
    }
    return r;
  };
  const aggregates: AggregateWork[] = [];
  // mesi dalla consegna all'ultima registrazione
  const first = state.settings.deliveryDate.slice(0, 7);
  const last = entries.length ? ym(entries[entries.length - 1].ts) : first;
  for (let m = first; m <= last; m = nextMonth(m)) row(m);

  for (const e of entries) {
    const r = row(ym(e.ts));
    if (e.type === 'fuel') {
      const amt = fuelAmountCents(e);
      r.fuelCount++;
      if (amt == null) r.fuelMissingAmount++;
      if (e.payment === 'company') { r.fuelCompanyCents += amt ?? 0; r.fuelCompanyCl += e.litersCl; }
      else { r.fuelPersonalCents += amt ?? 0; r.fuelPersonalCl += e.litersCl; }
    } else if (e.type === 'charge') {
      const wh = e.energyWh ?? 0, c = e.amountCents ?? 0;
      if (e.kind === 'home') { r.homeWh += wh; r.homeCents += c; }
      else if (e.payment === 'company') { r.publicCompanyWh += wh; r.publicCompanyCents += c; }
      else { r.publicPersonalWh += wh; r.publicPersonalCents += c; }
    } else if (e.type === 'work') {
      if (e.tsFrom && ym(e.tsFrom) !== ym(e.ts)) {
        aggregates.push({ entry: e, from: e.tsFrom, to: e.ts });
      } else {
        r.workKm += e.km; r.workKmMax += e.kmMax ?? e.km;
      }
    }
  }
  for (const r of map.values()) {
    const start = `${r.month}-01T00:00`;
    const end = `${nextMonth(r.month)}-01T00:00`;
    const a = r.month === first ? { odo: state.settings.deliveryOdo, exact: true } : odoAt(state, start);
    let b = odoAt(state, end);
    let partial = false;
    if (!b) {
      // mese in corso: fino all'ultima lettura disponibile
      const pts = odoPoints(state);
      const lastPt = pts[pts.length - 1];
      if (lastPt.ts >= start) { b = { odo: lastPt.odo, exact: true }; partial = true; }
    }
    if (a && b) {
      r.kmTotal = Math.max(0, Math.round(b.odo - a.odo));
      r.kmEstimated = !(a.exact && b.exact) || partial;
    }
  }
  return { rows: [...map.values()].sort((x, y) => x.month.localeCompare(y.month)), aggregates };
}

export function nextMonth(m: string): string {
  let [y, mo] = m.split('-').map(Number);
  mo++;
  if (mo === 13) { mo = 1; y++; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/** Spese aziendali per periodo di plafond (il rinnovo può non coincidere con il 1° del mese). */
export function plafondHistory(state: AppState): { start: string; end: string; fuelCents: number; chargeCents: number }[] {
  const s = state.settings;
  const out = new Map<string, { start: string; end: string; fuelCents: number; chargeCents: number }>();
  for (const e of state.entries) {
    if ((e.type !== 'fuel' && e.type !== 'charge') || e.payment !== 'company') continue;
    const p = plafondPeriod(e.ts, s.plafondResetDay);
    const r = out.get(p.start) ?? { ...p, fuelCents: 0, chargeCents: 0 };
    if (e.type === 'fuel') r.fuelCents += fuelAmountCents(e) ?? 0;
    else r.chargeCents += e.amountCents ?? 0;
    out.set(p.start, r);
  }
  return [...out.values()].sort((a, b) => a.start.localeCompare(b.start));
}

// --- CSV --------------------------------------------------------------------

const dec = (x: number | null | undefined, d: number) =>
  x == null ? '' : x.toFixed(d).replace('.', ',');
const q = (s: string | undefined | null) => {
  const v = s ?? '';
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
const pay = (p: string) => (p === 'company' ? 'aziendale' : 'personale');

export function entriesCsv(state: AppState): string {
  const head = ['tipo', 'data_ora', 'dal', 'contachilometri', 'litri', 'kWh', 'importo_eur', 'prezzo_unitario', 'pagamento', 'pieno', 'km_lavorativi', 'km_lavorativi_max', 'stimato', 'fonte', 'note', 'id'];
  const lines = [head.join(';')];
  for (const e of sortEntries(state.entries)) {
    const base = { tipo: '', dal: '', odo: '', l: '', kwh: '', imp: '', pu: '', pag: '', pieno: '', wk: '', wkm: '', st: '' };
    if (e.type === 'fuel') {
      Object.assign(base, {
        tipo: 'rifornimento', odo: String(e.odo), l: dec(e.litersCl / 100, 2), imp: dec(fuelAmountCents(e) == null ? null : fuelAmountCents(e)! / 100, 2),
        pu: dec(fuelPriceMilli(e) == null ? null : fuelPriceMilli(e)! / 1000, 3), pag: pay(e.payment),
        pieno: e.full == null ? 'non noto' : e.full ? 'sì' : 'no',
      });
    } else if (e.type === 'charge') {
      Object.assign(base, {
        tipo: e.kind === 'home' ? 'ricarica domestica' : 'ricarica pubblica', dal: e.tsFrom ?? '', odo: e.odo != null ? String(e.odo) : '',
        kwh: dec(e.energyWh == null ? null : e.energyWh / 1000, 3), imp: dec(e.amountCents == null ? null : e.amountCents / 100, 2),
        pu: dec(chargePriceMilli(e) == null ? null : chargePriceMilli(e)! / 1000, 3), pag: pay(e.payment), st: e.estimated ? 'sì' : 'no',
      });
    } else if (e.type === 'work') {
      Object.assign(base, { tipo: e.purpose ? `km lavorativi (${e.purpose})` : 'km lavorativi', dal: e.tsFrom ?? '', odo: e.odo != null ? String(e.odo) : '', wk: String(e.km), wkm: e.kmMax != null ? String(e.kmMax) : '', st: e.kmMax != null ? 'sì' : 'no' });
    } else {
      Object.assign(base, { tipo: 'lettura', odo: String(e.odo) });
    }
    lines.push([base.tipo, e.ts, base.dal, base.odo, base.l, base.kwh, base.imp, base.pu, base.pag, base.pieno, base.wk, base.wkm, base.st, e.source ?? 'manuale', q(e.note), e.id].join(';'));
  }
  return '﻿' + lines.join('\r\n');
}

export function monthlyCsv(state: AppState): string {
  const { rows } = monthlyReport(state);
  const head = ['mese', 'rifornimenti', 'benzina_personale_eur', 'benzina_aziendale_eur', 'litri_personali', 'litri_aziendali', 'importi_mancanti', 'kWh_domestici', 'kWh_pubblici_personali', 'eur_pubblici_personali', 'kWh_pubblici_aziendali', 'eur_pubblici_aziendali', 'km_lavorativi_attribuiti', 'km_totali', 'km_totali_stimati'];
  const lines = [head.join(';')];
  for (const r of rows) {
    lines.push([r.month, r.fuelCount, dec(r.fuelPersonalCents / 100, 2), dec(r.fuelCompanyCents / 100, 2), dec(r.fuelPersonalCl / 100, 2), dec(r.fuelCompanyCl / 100, 2), r.fuelMissingAmount, dec(r.homeWh / 1000, 1), dec(r.publicPersonalWh / 1000, 1), dec(r.publicPersonalCents / 100, 2), dec(r.publicCompanyWh / 1000, 1), dec(r.publicCompanyCents / 100, 2), r.workKm === r.workKmMax ? r.workKm : `${r.workKm}-${r.workKmMax}`, r.kmTotal ?? '', r.kmEstimated ? 'sì' : 'no'].join(';'));
  }
  return '﻿' + lines.join('\r\n');
}

// --- Backup JSON -----------------------------------------------------------------

export interface BackupFile {
  app: 'rifornimento';
  schemaVersion: number;
  exportedAt: string;
  state: AppState;
}

export function makeBackup(state: AppState, at: string): BackupFile {
  return { app: 'rifornimento', schemaVersion: SCHEMA_VERSION, exportedAt: at, state };
}

const TYPES: Entry['type'][] = ['fuel', 'charge', 'work', 'reading'];

/** Valida e migra un backup. Lancia un Error con messaggio leggibile se non valido. */
export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { throw new Error('Il file non è un JSON valido.'); }
  const b = data as Partial<BackupFile>;
  if (!b || b.app !== 'rifornimento' || !b.state) throw new Error('Il file non è un backup di questa applicazione.');
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion > SCHEMA_VERSION) {
    throw new Error('Backup creato da una versione più recente dell\'app: aggiorna l\'app prima di ripristinarlo.');
  }
  const st = b.state as AppState;
  if (!Array.isArray(st.entries) || typeof st.settings !== 'object') throw new Error('Backup incompleto: mancano registrazioni o impostazioni.');
  const ids = new Set<string>();
  for (const e of st.entries) {
    if (!e || !TYPES.includes(e.type) || typeof e.id !== 'string' || typeof e.ts !== 'string') {
      throw new Error('Backup danneggiato: una registrazione non è valida.');
    }
    if (ids.has(e.id)) throw new Error('Backup danneggiato: identificativi duplicati.');
    ids.add(e.id);
    if (e.type === 'fuel' && (!Number.isInteger((e as FuelEntry).litersCl) || typeof (e as FuelEntry).odo !== 'number')) {
      throw new Error('Backup danneggiato: rifornimento non valido.');
    }
    if (e.type === 'charge' && !['home', 'public'].includes((e as ChargeEntry).kind)) {
      throw new Error('Backup danneggiato: ricarica non valida.');
    }
  }
  return { ...b, state: { ...st, schemaVersion: SCHEMA_VERSION, audit: Array.isArray(st.audit) ? st.audit : [] } } as BackupFile;
}
