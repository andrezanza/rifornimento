import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppState, AuditRecord, Entry, Settings } from '../domain/types';
import { compute, type EngineResult } from '../domain/engine';
import { emptyState, historicalEntries, type InitialData } from '../domain/seed';
import { nowLocalIso, fmt } from '../domain/units';
import { addSnapshot, loadState, migrate, requestPersistence, saveState } from './storage';
import { FIREBASE_CONFIG } from './firebase-config';
import { diffForPush, hasOps, mergeRemote, sameSharedSettings, type PushOps, type RemoteData } from './sync';
import type { Cloud, SnapMeta } from './cloud';
import { toast } from '../ui/components';

export type CloudStatus = 'off' | 'loading' | 'signed-out' | 'syncing' | 'synced' | 'pending' | 'error';
export interface CloudState {
  status: CloudStatus;
  email?: string | null;
  error?: string;
  lastSyncAt?: string;
}

const LINK_KEY = 'rifornimento-cloud-linked';
const linkedUid = () => { try { return localStorage.getItem(LINK_KEY); } catch { return null; } };
const setLinked = (uid: string | null) => { try { if (uid) localStorage.setItem(LINK_KEY, uid); else localStorage.removeItem(LINK_KEY); } catch { /* */ } };

/** Messaggio leggibile per gli errori di accesso più comuni. */
export function cloudErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Email o password non corretti.',
    'auth/wrong-password': 'Password non corretta.',
    'auth/user-not-found': 'Nessun account con questa email.',
    'auth/email-already-in-use': 'Esiste già un account con questa email: accedi.',
    'auth/weak-password': 'Password troppo corta (almeno 6 caratteri).',
    'auth/invalid-email': 'Indirizzo email non valido.',
    'auth/network-request-failed': 'Connessione assente: riprova quando sei online.',
    'auth/popup-closed-by-user': 'Accesso annullato.',
    'auth/cancelled-popup-request': 'Accesso annullato.',
    'auth/unauthorized-domain': 'Dominio non autorizzato nel progetto Firebase.',
    'auth/operation-not-allowed': 'Metodo di accesso non attivato nel progetto Firebase.',
    'permission-denied': 'Accesso ai dati negato dalle regole di sicurezza.',
  };
  return map[code] ?? (e as Error)?.message ?? 'Errore sconosciuto';
}

export function describeEntry(e: Entry): string {
  const d = fmt.date(e.ts);
  switch (e.type) {
    case 'fuel': return `Rifornimento ${d}: ${fmt.liters(e.litersCl)}, ${fmt.eur(e.amountCents)}, ${e.payment === 'company' ? 'carta aziendale' : 'carta personale'}`;
    case 'charge': return `Ricarica ${e.kind === 'home' ? 'domestica' : 'pubblica'} ${d}: ${e.energyWh != null ? fmt.kwh(e.energyWh) : 'kWh n.d.'}`;
    case 'work': return `Km lavorativi ${d}: ${e.km}${e.kmMax ? '–' + e.kmMax : ''} km`;
    case 'reading': return `Lettura ${d}: ${fmt.km(e.odo)}`;
  }
}

interface Store {
  ready: boolean;
  state: AppState;
  result: EngineResult;
  persisted: boolean | null;
  add: (e: Entry) => Promise<void>;
  update: (e: Entry) => Promise<void>;
  remove: (id: string) => Promise<void>;
  saveSettings: (patch: Partial<Settings>, summary?: string) => Promise<void>;
  onboard: (d: InitialData, settings: Partial<Settings>) => Promise<void>;
  startEmpty: (settings: Partial<Settings>) => Promise<void>;
  restore: (s: AppState) => Promise<void>;
  wipe: () => Promise<void>;
  markBackup: () => Promise<void>;
  /** errore bloccante all'avvio (es. dati di una versione più recente) */
  fatal: string | null;
  cloud: CloudState;
  cloudConfigured: boolean;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, password: string, create: boolean) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(emptyState);
  const [ready, setReady] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [now, setNow] = useState(nowLocalIso());
  const [fatal, setFatal] = useState<string | null>(null);
  const [cloud, setCloud] = useState<CloudState>({ status: FIREBASE_CONFIG ? 'loading' : 'off' });
  const ref = useRef(state);
  ref.current = state;
  const cloudRef = useRef<Cloud | null>(null);
  /** utente collegato e prima sincronizzazione completata: da qui ogni salvataggio va anche nel cloud */
  const syncUid = useRef<string | null>(null);

  useEffect(() => {
    loadState().then((s) => { setState(s); ref.current = s; setReady(true); }, (e: Error) => setFatal(e.message));
    const t = setInterval(() => setNow(nowLocalIso()), 60_000);
    return () => clearInterval(t);
  }, []);

  const pushOps = useCallback((uid: string, ops: PushOps) => {
    if (!hasOps(ops) || !cloudRef.current) return;
    setCloud((c) => ({ ...c, status: 'pending' }));
    cloudRef.current.push(uid, ops).then(
      () => setCloud((c) => (c.status === 'pending' ? { ...c, status: 'synced', lastSyncAt: nowLocalIso(), error: undefined } : c)),
      (e) => setCloud((c) => ({ ...c, status: 'error', error: cloudErrorMessage(e) })),
    );
  }, []);

  // sincronizzazione cloud
  useEffect(() => {
    if (!ready || !FIREBASE_CONFIG) return;
    let unsubAuth: (() => void) | undefined;
    let unsubData: (() => void) | undefined;
    let alive = true;

    const applyRemote = async (uid: string, remote: RemoteData, meta: SnapMeta) => {
      // si lavora solo su dati confermati dal server: la cache locale potrebbe essere incompleta
      if (meta.fromCache) return;
      const at = nowLocalIso();
      const first = linkedUid() !== uid;
      const local = ref.current;
      if (first && local.entries.length) await addSnapshot(local, 'Prima della prima sincronizzazione cloud', at);
      const { state: merged, push, changed } = mergeRemote(local, remote, { now: at, remoteWins: first });
      if (changed) {
        ref.current = merged;
        setState(merged);
        await saveState(merged).catch(() => toast('Errore nel salvataggio sul dispositivo'));
      }
      setLinked(uid);
      syncUid.current = uid;
      if (hasOps(push)) pushOps(uid, push);
      else setCloud((c) => ({ ...c, status: meta.pending ? 'pending' : 'synced', lastSyncAt: meta.pending ? c.lastSyncAt : at, error: undefined }));
    };

    import('./cloud').then(({ createCloud }) => {
      if (!alive) return;
      const c = createCloud(FIREBASE_CONFIG!);
      cloudRef.current = c;
      unsubAuth = c.onAuth((u) => {
        unsubData?.();
        unsubData = undefined;
        syncUid.current = null;
        if (!u) { setCloud({ status: 'signed-out' }); return; }
        setCloud({ status: 'syncing', email: u.email });
        unsubData = c.subscribe(
          u.uid,
          (r, m) => { applyRemote(u.uid, r, m).catch((e) => setCloud((s) => ({ ...s, status: 'error', error: cloudErrorMessage(e) }))); },
          (e) => setCloud((s) => ({ ...s, status: 'error', error: cloudErrorMessage(e) })),
        );
      });
    }, () => setCloud({ status: 'error', error: 'Impossibile caricare il modulo di sincronizzazione (sei offline?).' }));

    return () => { alive = false; unsubAuth?.(); unsubData?.(); };
  }, [ready, pushOps]);

  useEffect(() => {
    if (state.settings.onboarded) requestPersistence().then(setPersisted);
  }, [state.settings.onboarded]);

  const commit = useCallback(async (next: AppState, audit?: Omit<AuditRecord, 'at'>, opts: { push?: boolean } = {}) => {
    const at = nowLocalIso();
    const prev = ref.current;
    let withAudit = audit ? { ...next, audit: [{ at, ...audit }, ...next.audit].slice(0, 2000) } : next;
    if (!sameSharedSettings(prev.settings, withAudit.settings)) withAudit = { ...withAudit, settingsUpdatedAt: at };
    ref.current = withAudit;
    setState(withAudit);
    setNow(at);
    try {
      await saveState(withAudit);
    } catch (e) {
      toast('Errore: impossibile salvare sul dispositivo. Salva subito un backup.');
      throw e;
    }
    const uid = syncUid.current;
    if (uid && opts.push !== false) pushOps(uid, diffForPush(prev, withAudit, at));
  }, [pushOps]);

  const store = useMemo<Store>(() => ({
    ready, state, persisted,
    result: compute(state, { now }),
    add: (e) => commit({ ...ref.current, entries: [...ref.current.entries, e] }, { action: 'create', entityId: e.id, summary: describeEntry(e), after: e }),
    update: (e) => {
      const before = ref.current.entries.find((x) => x.id === e.id);
      return commit(
        { ...ref.current, entries: ref.current.entries.map((x) => (x.id === e.id ? e : x)) },
        { action: 'update', entityId: e.id, summary: `Rettifica — ${describeEntry(e)}`, before, after: e },
      );
    },
    remove: (id) => {
      const before = ref.current.entries.find((x) => x.id === id);
      return commit(
        { ...ref.current, entries: ref.current.entries.filter((x) => x.id !== id) },
        { action: 'delete', entityId: id, summary: `Eliminata — ${before ? describeEntry(before) : id}`, before },
      );
    },
    saveSettings: (patch, summary) =>
      commit(
        { ...ref.current, settings: { ...ref.current.settings, ...patch } },
        summary === undefined ? { action: 'settings', summary: 'Impostazioni modificate', before: ref.current.settings, after: patch } : summary ? { action: 'settings', summary } : undefined,
      ),
    onboard: async (d, settings) => {
      const at = nowLocalIso();
      if (ref.current.entries.length) await addSnapshot(ref.current, 'Prima dell\'importazione iniziale', at);
      const keep = ref.current.entries.filter((e) => e.source !== 'storico');
      await commit(
        { ...ref.current, entries: [...historicalEntries(d, at), ...keep], settings: { ...ref.current.settings, ...settings, onboarded: true } },
        { action: 'import', summary: 'Importazione dati iniziali (3 rifornimenti, km lavorativi storici, rilevazione iniziale)' },
      );
    },
    startEmpty: (settings) => commit({ ...ref.current, settings: { ...ref.current.settings, ...settings, onboarded: true } }, { action: 'import', summary: 'Avvio senza dati storici' }),
    restore: async (s) => {
      const at = nowLocalIso();
      await addSnapshot(ref.current, 'Prima del ripristino da backup', at);
      const m = migrate(s);
      await commit({ ...m, settings: { ...m.settings, onboarded: true } }, { action: 'restore', summary: `Ripristino da backup (${m.entries.length} registrazioni)` });
    },
    wipe: async () => {
      const at = nowLocalIso();
      await addSnapshot(ref.current, 'Prima della cancellazione completa', at);
      // cancella solo questo dispositivo: ci si disconnette prima, così il cloud resta intatto
      syncUid.current = null;
      setLinked(null);
      await cloudRef.current?.signOut().catch(() => {});
      await commit(emptyState(), undefined, { push: false });
    },
    markBackup: () => commit({ ...ref.current, settings: { ...ref.current.settings, lastBackupAt: nowLocalIso() } }),
    fatal,
    cloud,
    cloudConfigured: FIREBASE_CONFIG != null,
    signInGoogle: async () => { await cloudRef.current?.signInGoogle(); },
    signInEmail: async (email, password, create) => { await cloudRef.current?.signInEmail(email, password, create); },
    resetPassword: async (email) => { await cloudRef.current?.resetPassword(email); },
    signOut: async () => { syncUid.current = null; await cloudRef.current?.signOut(); },
  }), [ready, state, persisted, now, commit, fatal, cloud]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider mancante');
  return s;
}
