// Persistenza locale in IndexedDB: un unico documento JSON con tutto lo stato.
// Il volume di dati è minimo (qualche centinaio di registrazioni l'anno), quindi un solo
// documento rende ogni salvataggio atomico e il backup identico ai dati salvati.
import type { AppState } from '../domain/types';
import { defaultSettings, emptyState, SCHEMA_VERSION } from '../domain/seed';

const DB = 'rifornimento';
const STORE = 'kv';
const KEY = 'state';
const SNAP_KEY = 'snapshots';
const LS_KEY = 'rifornimento-state';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Completa lo stato con eventuali impostazioni introdotte da versioni successive. */
export function migrate(raw: AppState | undefined | null): AppState {
  if (!raw) return emptyState();
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: Array.isArray(raw.entries) ? raw.entries : [],
    settings: { ...defaultSettings(), ...(raw.settings ?? {}) },
    audit: Array.isArray(raw.audit) ? raw.audit : [],
  };
}

export async function loadState(): Promise<AppState> {
  try {
    return migrate(await idbGet<AppState>(KEY));
  } catch {
    try { return migrate(JSON.parse(localStorage.getItem(LS_KEY) ?? 'null')); } catch { return emptyState(); }
  }
}

export async function saveState(state: AppState): Promise<void> {
  try {
    await idbPut(KEY, state);
  } catch {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }
}

export interface Snapshot { at: string; reason: string; state: AppState }

/** Copia di sicurezza interna (non sostituisce il backup su file). */
export async function addSnapshot(state: AppState, reason: string, at: string): Promise<void> {
  try {
    const list = (await idbGet<Snapshot[]>(SNAP_KEY)) ?? [];
    list.unshift({ at, reason, state });
    await idbPut(SNAP_KEY, list.slice(0, 10));
  } catch { /* opzionale */ }
}

export async function listSnapshots(): Promise<Snapshot[]> {
  try { return (await idbGet<Snapshot[]>(SNAP_KEY)) ?? []; } catch { return []; }
}

/** Chiede al browser di non cancellare automaticamente i dati (Android Chrome lo concede alle PWA installate). */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* non supportato */ }
  return null;
}
