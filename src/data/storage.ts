// Persistenza locale in IndexedDB: un unico documento JSON con tutto lo stato.
// Il volume di dati è minimo (qualche centinaio di registrazioni l'anno), quindi un solo
// documento rende ogni salvataggio atomico e il backup identico ai dati salvati.
// Una seconda copia va in localStorage: se IndexedDB si rovina o non risponde, l'app
// riparte dalla copia più recente delle due.
import type { AppState } from '../domain/types';
import { migrate } from '../domain/migrate';

export { migrate, NewerDataError } from '../domain/migrate';

const DB = 'rifornimento';
const STORE = 'kv';
const KEY = 'state';
const SAVED_AT = 'savedAt';
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

async function idbPut(values: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const [k, v] of Object.entries(values)) tx.objectStore(STORE).put(v, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

interface LsCopy { savedAt: number; state: unknown }

function lsRead(): LsCopy | null {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
    if (!v) return null;
    // formato precedente: lo stato salvato direttamente
    return typeof v.savedAt === 'number' && v.state ? v : { savedAt: 0, state: v };
  } catch { return null; }
}

/** Carica lo stato più recente tra IndexedDB e la copia in localStorage. Lancia NewerDataError se i dati sono di una versione futura. */
export async function loadState(): Promise<AppState> {
  let idb: { savedAt: number; state: unknown } | null = null;
  try {
    const state = await idbGet<unknown>(KEY);
    if (state) idb = { savedAt: (await idbGet<number>(SAVED_AT)) ?? 0, state };
  } catch { /* IndexedDB non disponibile: si usa la copia */ }
  const ls = lsRead();
  const best = idb && ls ? (ls.savedAt > idb.savedAt ? ls : idb) : idb ?? ls;
  return migrate(best?.state);
}

/** Salva in IndexedDB e nella copia locale. Lancia un errore solo se falliscono entrambi. */
export async function saveState(state: AppState): Promise<void> {
  const savedAt = Date.now();
  let okIdb = false, okLs = false;
  try { await idbPut({ [KEY]: state, [SAVED_AT]: savedAt }); okIdb = true; } catch { /* sotto */ }
  try { localStorage.setItem(LS_KEY, JSON.stringify({ savedAt, state })); okLs = true; } catch { /* spazio esaurito o non disponibile */ }
  if (!okIdb && !okLs) throw new Error('Impossibile salvare i dati sul dispositivo.');
}

export interface Snapshot { at: string; reason: string; state: AppState }

/** Copia di sicurezza interna (non sostituisce il backup su file). */
export async function addSnapshot(state: AppState, reason: string, at: string): Promise<void> {
  try {
    const list = (await idbGet<Snapshot[]>(SNAP_KEY)) ?? [];
    list.unshift({ at, reason, state });
    await idbPut({ [SNAP_KEY]: list.slice(0, 10) });
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
