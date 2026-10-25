import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppState, AuditRecord, Entry, Settings } from '../domain/types';
import { compute, type EngineResult } from '../domain/engine';
import { emptyState, historicalEntries, type InitialData } from '../domain/seed';
import { nowLocalIso, fmt } from '../domain/units';
import { addSnapshot, loadState, migrate, requestPersistence, saveState } from './storage';

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
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(emptyState);
  const [ready, setReady] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [now, setNow] = useState(nowLocalIso());
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => {
    loadState().then((s) => { setState(s); setReady(true); });
    const t = setInterval(() => setNow(nowLocalIso()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (state.settings.onboarded) requestPersistence().then(setPersisted);
  }, [state.settings.onboarded]);

  const commit = useCallback(async (next: AppState, audit?: Omit<AuditRecord, 'at'>) => {
    const at = nowLocalIso();
    const withAudit = audit ? { ...next, audit: [{ at, ...audit }, ...next.audit].slice(0, 2000) } : next;
    setState(withAudit);
    setNow(at);
    await saveState(withAudit);
  }, []);

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
      await commit(emptyState());
    },
    markBackup: () => commit({ ...ref.current, settings: { ...ref.current.settings, lastBackupAt: nowLocalIso() } }),
  }), [ready, state, persisted, now, commit]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider mancante');
  return s;
}
