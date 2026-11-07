// Migrazioni dei dati e sincronizzazione cloud (logica pura, senza Firebase).
import { describe, expect, it } from 'vitest';
import { migrate, NewerDataError } from '../src/domain/migrate';
import { emptyState, historicalEntries, ANDREA_DEFAULTS, SCHEMA_VERSION } from '../src/domain/seed';
import { makeBackup, parseBackup } from '../src/domain/reports';
import { sharedSettings, auditId, diffForPush, mergeRemote, opsByDoc, remoteFromDocs, type RemoteData } from '../src/data/sync';
import type { AppState, Entry } from '../src/domain/types';

const T = '2026-11-07T10:00';
const work = (id: string, km: number, u = T): Entry => ({ id, type: 'work', ts: '2026-11-06T18:00', km, createdAt: '2026-11-06T18:00', updatedAt: u });
const state = (entries: Entry[], patch: Partial<AppState> = {}): AppState => {
  const s = emptyState();
  return { ...s, entries, settings: { ...s.settings, onboarded: true }, settingsUpdatedAt: '2026-10-25T11:00', ...patch };
};
const remote = (entries: RemoteData['entries'] = {}, settings: RemoteData['settings'] = null): RemoteData => ({ entries, audit: {}, settings });

describe('migrazioni', () => {
  it('porta un salvataggio v1 alla versione corrente senza perdere nulla', () => {
    const v1 = { schemaVersion: 1, entries: [work('a', 10)], settings: { plafondCents: 60000, onboarded: true }, audit: [{ at: '2026-11-01T10:00', action: 'settings', summary: 'x' }, { at: '2026-10-01T10:00', action: 'import', summary: 'y' }], extra: 'campo futuro' };
    const s = migrate(v1);
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.entries).toHaveLength(1);
    expect(s.settings.plafondCents).toBe(60000);
    expect(s.settings.tankCapacityL).toBe(40); // impostazione nuova con valore predefinito
    expect(s.settingsUpdatedAt).toBe('2026-11-01T10:00');
    expect((s as unknown as { extra: string }).extra).toBe('campo futuro');
  });
  it('rifiuta dati di una versione futura invece di sovrascriverli', () => {
    expect(() => migrate({ schemaVersion: SCHEMA_VERSION + 1, entries: [] })).toThrow(NewerDataError);
  });
  it('un backup v1 viene migrato al ripristino', () => {
    const s = state(historicalEntries(ANDREA_DEFAULTS, T));
    const file = { ...makeBackup(s, T), schemaVersion: 1, state: { ...s, schemaVersion: 1, settingsUpdatedAt: undefined } };
    const b = parseBackup(JSON.stringify(file));
    expect(b.state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(b.state.entries).toEqual(s.entries);
  });
});

describe('sincronizzazione cloud', () => {
  it('invia nuove registrazioni, modifiche, eliminazioni, rettifiche e impostazioni', () => {
    const prev = state([work('a', 10), work('b', 20)]);
    const next: AppState = {
      ...prev,
      entries: [work('a', 12, '2026-11-07T11:00'), work('c', 30)],
      audit: [{ at: T, action: 'create', entityId: 'c', summary: 'nuova' }],
      settings: { ...prev.settings, plafondCents: 60000, lastBackupAt: T },
      settingsUpdatedAt: T,
    };
    const ops = diffForPush(prev, next, T);
    expect(ops.entries.map((o) => [o.id, o.v.d ? 'up' : 'del'])).toEqual([['a', 'up'], ['c', 'up'], ['b', 'del']]);
    expect(ops.audit).toHaveLength(1);
    expect(ops.settings?.d.plafondCents).toBe(60000);
    expect(ops.settings?.d).not.toHaveProperty('lastBackupAt');
    expect(diffForPush(next, next, T).entries).toHaveLength(0);
    // solo impostazioni del dispositivo: niente da inviare
    expect(diffForPush(prev, { ...prev, settings: { ...prev.settings, lastBackupAt: T } }, T).settings).toBeNull();
  });

  it('telefono che ha perso i dati: accedendo li ritrova tutti', () => {
    const phone = state(historicalEntries(ANDREA_DEFAULTS, T), { audit: [{ at: T, action: 'create', summary: 's' }] });
    const up = diffForPush(emptyState(), phone, T);
    const docs = [...opsByDoc(up)].map(([id, d]) => ({ id, data: d as unknown as Record<string, unknown> }));
    docs.push({ id: 'settings', data: { s: { d: sharedSettings(phone.settings), u: phone.settingsUpdatedAt } } });
    const r = remoteFromDocs(JSON.parse(JSON.stringify(docs)));
    const fresh = emptyState();
    const m = mergeRemote(fresh, r, { now: T, remoteWins: true });
    expect(m.changed).toBe(true);
    expect(m.state.settings.onboarded).toBe(true);
    expect(new Set(m.state.entries.map((e) => e.id))).toEqual(new Set(phone.entries.map((e) => e.id)));
    expect(m.state.audit).toHaveLength(1);
    expect(m.push.entries).toHaveLength(0);
    // una seconda unione non cambia nulla (ordine dei campi diverso dal cloud incluso)
    const again = mergeRemote(m.state, r, { now: T, remoteWins: false });
    expect(again.changed).toBe(false);
    expect(again.push.entries).toHaveLength(0);
    expect(again.push.settings).toBeNull();
  });

  it('prima sincronizzazione di un nuovo dispositivo: il cloud vince sui dati precaricati', () => {
    const local = state([work('a', 10, '2026-11-07T12:00'), work('new', 5)], { settingsUpdatedAt: '2026-11-07T12:00' });
    const r = remote({ a: { d: work('a', 99, '2026-11-01T10:00'), u: '2026-11-01T10:00' } }, { d: { plafondCents: 60000 }, u: '2026-11-01T10:00' });
    const m = mergeRemote(local, r, { now: T, remoteWins: true });
    expect(m.state.entries.find((e) => e.id === 'a')).toMatchObject({ km: 99 });
    expect(m.state.settings.plafondCents).toBe(60000);
    expect(m.push.entries.map((o) => o.id)).toEqual(['new']); // la registrazione solo locale viene inviata
  });

  it('dispositivi già collegati: vince la modifica più recente, le eliminazioni si propagano', () => {
    const local = state([work('a', 10, '2026-11-07T12:00'), work('b', 20, '2026-11-01T10:00'), work('c', 30, '2026-11-07T12:00')]);
    const r = remote({
      a: { d: work('a', 11, '2026-11-05T10:00'), u: '2026-11-05T10:00' }, // locale più recente → si invia
      b: { d: null, u: '2026-11-06T10:00' }, // eliminata altrove dopo l'ultima modifica → si elimina
      c: { d: null, u: '2026-11-06T10:00' }, // eliminata altrove ma modificata qui dopo → resta e si invia
      d: { d: work('d', 40), u: T }, // nuova da un altro dispositivo → si aggiunge
    });
    const m = mergeRemote(local, r, { now: T, remoteWins: false });
    expect(m.state.entries.map((e) => e.id).sort()).toEqual(['a', 'c', 'd']);
    expect(m.state.entries.find((e) => e.id === 'a')).toMatchObject({ km: 10 });
    expect(m.push.entries.map((o) => o.id).sort()).toEqual(['a', 'c']);
  });

  it('impostazioni: vince la più recente; il dispositivo nuovo non invia le impostazioni predefinite', () => {
    const local = state([], { settingsUpdatedAt: '2026-11-07T12:00' });
    local.settings.plafondCents = 70000;
    const m = mergeRemote(local, remote({}, { d: { plafondCents: 60000 }, u: '2026-11-01T10:00' }), { now: T, remoteWins: false });
    expect(m.push.settings?.d.plafondCents).toBe(70000);
    const fresh = emptyState();
    expect(mergeRemote(fresh, remote(), { now: T, remoteWins: true }).push.settings).toBeNull();
  });

  it('identificativo delle rettifiche stabile e unico', () => {
    const a = { at: T, action: 'create' as const, entityId: 'x', summary: 'uno' };
    expect(auditId(a)).toBe(auditId({ ...a }));
    expect(auditId(a)).not.toBe(auditId({ ...a, summary: 'due' }));
  });
});
