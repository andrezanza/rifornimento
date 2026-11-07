// Logica di sincronizzazione con il cloud, indipendente da Firebase (testabile).
//
// Struttura remota (per utente): un documento per mese più uno per le impostazioni.
//   m-YYYY-MM : { e: { [idRegistrazione]: { d: Entry | null, u } }, a: { [idRettifica]: AuditRecord } }
//   settings  : { s: { d: impostazioni condivise, u } }
// d = null indica una registrazione eliminata (serve a propagare l'eliminazione agli altri dispositivi).
// u = data di ultima modifica: in caso di conflitto vince la più recente.
import type { AppState, AuditRecord, Entry, Settings } from '../domain/types';

export interface RemoteEntry { d: Entry | null; u: string }
export interface RemoteSettings { d: Partial<Settings>; u: string }

export interface RemoteData {
  entries: Record<string, RemoteEntry>;
  audit: Record<string, AuditRecord>;
  settings: RemoteSettings | null;
}

export interface PushOps {
  entries: { id: string; month: string; v: RemoteEntry }[];
  audit: { id: string; month: string; v: AuditRecord }[];
  settings: RemoteSettings | null;
}

/** Impostazioni che riguardano solo il dispositivo e non vengono sincronizzate. */
const LOCAL_ONLY: (keyof Settings)[] = ['onboarded', 'lastBackupAt'];
export const AUDIT_LIMIT = 2000;

export const emptyOps = (): PushOps => ({ entries: [], audit: [], settings: null });
export const hasOps = (o: PushOps) => o.entries.length > 0 || o.audit.length > 0 || o.settings != null;

export function sharedSettings(s: Settings): Partial<Settings> {
  const out: Partial<Settings> = { ...s };
  for (const k of LOCAL_ONLY) delete out[k];
  return out;
}

/** JSON con chiavi ordinate e senza campi undefined: il cloud non conserva l'ordine dei campi. */
function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
}
const same = (a: unknown, b: unknown) => a === b || canon(a) === canon(b);
export const sameSharedSettings = (a: Settings, b: Settings) => same(sharedSettings(a), sharedSettings(b));

export const entryMonth = (e: Entry) => (e.createdAt || e.ts || '0000-00').slice(0, 7);
export const auditMonth = (a: AuditRecord) => (a.at || '0000-00').slice(0, 7);

/** Identificativo stabile di una rettifica, uguale su tutti i dispositivi. */
export function auditId(a: AuditRecord): string {
  const s = `${a.at}|${a.action}|${a.entityId ?? ''}|${a.summary}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${a.at.replace(/[^0-9]/g, '')}-${(h >>> 0).toString(36)}`;
}

/** Modifiche da inviare al cloud dopo un salvataggio locale (da prev a next). */
export function diffForPush(prev: AppState, next: AppState, now: string): PushOps {
  const ops = emptyOps();
  const before = new Map(prev.entries.map((e) => [e.id, e]));
  const after = new Set<string>();
  for (const e of next.entries) {
    after.add(e.id);
    const p = before.get(e.id);
    if (!p || !same(p, e)) ops.entries.push({ id: e.id, month: entryMonth(e), v: { d: e, u: e.updatedAt } });
  }
  for (const [id, p] of before) if (!after.has(id)) ops.entries.push({ id, month: entryMonth(p), v: { d: null, u: now } });
  const known = new Set(prev.audit.map(auditId));
  for (const a of next.audit) {
    const id = auditId(a);
    if (!known.has(id)) ops.audit.push({ id, month: auditMonth(a), v: a });
  }
  if (!sameSharedSettings(prev.settings, next.settings)) ops.settings = { d: sharedSettings(next.settings), u: next.settingsUpdatedAt ?? now };
  return ops;
}

export interface MergeResult { state: AppState; push: PushOps; changed: boolean }

/**
 * Unisce i dati remoti con quelli locali.
 * remoteWins = prima sincronizzazione di questo dispositivo: nei conflitti vincono sempre i dati
 * remoti, così un dispositivo appena installato (con i dati precaricati) non sovrascrive il cloud.
 */
export function mergeRemote(local: AppState, remote: RemoteData, opts: { now: string; remoteWins: boolean }): MergeResult {
  const push = emptyOps();
  let changed = false;

  // registrazioni
  const byId = new Map(local.entries.map((e) => [e.id, e]));
  for (const [id, r] of Object.entries(remote.entries)) {
    const l = byId.get(id);
    if (r.d == null) {
      if (!l) continue;
      if (opts.remoteWins || r.u >= l.updatedAt) { byId.delete(id); changed = true; }
      else push.entries.push({ id, month: entryMonth(l), v: { d: l, u: l.updatedAt } });
    } else if (!l) {
      byId.set(id, r.d); changed = true;
    } else if (!same(l, r.d)) {
      if (opts.remoteWins || r.u >= l.updatedAt) { byId.set(id, r.d); changed = true; }
      else push.entries.push({ id, month: entryMonth(l), v: { d: l, u: l.updatedAt } });
    }
  }
  for (const e of local.entries) if (!(e.id in remote.entries)) push.entries.push({ id: e.id, month: entryMonth(e), v: { d: e, u: e.updatedAt } });
  const entries = changed ? [...byId.values()] : local.entries;

  // registro rettifiche: unione
  const audit = new Map<string, AuditRecord>();
  for (const a of local.audit) {
    const id = auditId(a);
    audit.set(id, a);
    if (!(id in remote.audit)) push.audit.push({ id, month: auditMonth(a), v: a });
  }
  let auditChanged = false;
  for (const [id, a] of Object.entries(remote.audit)) if (!audit.has(id)) { audit.set(id, a); auditChanged = true; }
  const auditList = auditChanged
    ? [...audit.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, AUDIT_LIMIT)
    : local.audit;
  if (auditChanged) changed = true;

  // impostazioni
  let settings = local.settings;
  let settingsUpdatedAt = local.settingsUpdatedAt;
  const rs = remote.settings;
  if (rs) {
    const lu = local.settingsUpdatedAt;
    if (opts.remoteWins || !lu || rs.u > lu) {
      const merged = { ...local.settings, ...rs.d } as Settings;
      if (!sameSharedSettings(merged, local.settings) || lu !== rs.u) { settings = merged; settingsUpdatedAt = rs.u; changed = true; }
    } else if (lu > rs.u) {
      push.settings = { d: sharedSettings(local.settings), u: lu };
    }
  } else if (local.settings.onboarded) {
    push.settings = { d: sharedSettings(local.settings), u: local.settingsUpdatedAt ?? opts.now };
  }

  // un dispositivo nuovo che trova dati nel cloud è già configurato
  const remoteHasData = rs != null || Object.values(remote.entries).some((r) => r.d != null);
  if (remoteHasData && !settings.onboarded) { settings = { ...settings, onboarded: true }; changed = true; }

  return {
    state: changed ? { ...local, entries, audit: auditList, settings, settingsUpdatedAt } : local,
    push,
    changed,
  };
}

/** Raggruppa le operazioni per documento remoto. */
export function opsByDoc(ops: PushOps): Map<string, { e: Record<string, RemoteEntry>; a: Record<string, AuditRecord> }> {
  const docs = new Map<string, { e: Record<string, RemoteEntry>; a: Record<string, AuditRecord> }>();
  const get = (m: string) => {
    const k = `m-${m}`;
    if (!docs.has(k)) docs.set(k, { e: {}, a: {} });
    return docs.get(k)!;
  };
  for (const o of ops.entries) get(o.month).e[o.id] = o.v;
  for (const o of ops.audit) get(o.month).a[o.id] = o.v;
  return docs;
}

/** Ricompone i dati remoti dai documenti letti. */
export function remoteFromDocs(docs: { id: string; data: Record<string, unknown> }[]): RemoteData {
  const out: RemoteData = { entries: {}, audit: {}, settings: null };
  for (const { id, data } of docs) {
    if (id === 'settings') {
      const s = data.s as RemoteSettings | undefined;
      if (s && typeof s.u === 'string' && s.d) out.settings = s;
      continue;
    }
    for (const [eid, r] of Object.entries((data.e ?? {}) as Record<string, RemoteEntry>)) {
      if (!r || typeof r.u !== 'string') continue;
      const prev = out.entries[eid];
      if (!prev || r.u > prev.u) out.entries[eid] = { d: r.d ?? null, u: r.u };
    }
    Object.assign(out.audit, (data.a ?? {}) as Record<string, AuditRecord>);
  }
  return out;
}
