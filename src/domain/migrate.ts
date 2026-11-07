// Migrazioni dei dati salvati, una per versione dello schema.
// Ogni passo trasforma lo stato dalla versione N alla N+1 e non elimina mai campi sconosciuti:
// così un aggiornamento dell'app non può perdere dati, nemmeno quelli introdotti da versioni future.
import type { AppState, AuditRecord } from './types';
import { defaultSettings, emptyState, SCHEMA_VERSION } from './seed';

/** Dati scritti da una versione dell'app più recente di quella in uso. */
export class NewerDataError extends Error {
  constructor() { super('I dati sono stati salvati da una versione più recente dell\'app: aggiorna l\'app prima di continuare.'); }
}

type Raw = Record<string, unknown>;

function latestAudit(audit: unknown, actions: AuditRecord['action'][]): string | null {
  if (!Array.isArray(audit)) return null;
  let best: string | null = null;
  for (const a of audit as AuditRecord[]) if (a && actions.includes(a.action) && (!best || a.at > best)) best = a.at;
  return best;
}

/** MIGRATIONS[n] porta lo stato dalla versione n alla n+1. */
export const MIGRATIONS: Record<number, (s: Raw) => Raw> = {
  // v1 → v2: data di ultima modifica delle impostazioni, necessaria alla sincronizzazione cloud.
  1: (s) => ({ ...s, settingsUpdatedAt: (s.settingsUpdatedAt as string | undefined) ?? latestAudit(s.audit, ['settings', 'restore', 'import']) }),
};

/** Porta uno stato salvato (di qualunque versione precedente) alla versione corrente. */
export function migrate(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') return emptyState();
  let s: Raw = { ...(raw as Raw) };
  let v = typeof s.schemaVersion === 'number' ? s.schemaVersion : 1;
  if (v > SCHEMA_VERSION) throw new NewerDataError();
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`Migrazione dei dati mancante dalla versione ${v}.`);
    s = step(s);
    v += 1;
  }
  return {
    ...s,
    schemaVersion: SCHEMA_VERSION,
    entries: Array.isArray(s.entries) ? s.entries : [],
    settings: { ...defaultSettings(), ...((s.settings as object) ?? {}) },
    audit: Array.isArray(s.audit) ? s.audit : [],
    settingsUpdatedAt: typeof s.settingsUpdatedAt === 'string' ? s.settingsUpdatedAt : null,
  } as AppState;
}
