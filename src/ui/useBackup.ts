import { useStore } from '../data/store';
import { makeBackup } from '../domain/reports';
import { daysBetween, nowLocalIso } from '../domain/units';
import { toast } from './components';
import { shareOrDownload, stampName } from './download';

/** Giorni oltre i quali, con modifiche non salvate, l'app chiede un backup. */
export const BACKUP_REMIND_DAYS = 7;

export function useBackup() {
  const { state, markBackup } = useStore();
  const last = state.settings.lastBackupAt;

  const run = async () => {
    const json = JSON.stringify(makeBackup(state, nowLocalIso()), null, 1);
    try {
      const how = await shareOrDownload(stampName('rifornimento-backup', 'json'), json, 'application/json');
      await markBackup();
      toast(how === 'shared' ? 'Backup condiviso' : 'Backup scaricato nella cartella Download');
    } catch { toast('Backup annullato'); }
  };

  // modifiche dopo l'ultimo backup; l'importazione iniziale è ricostruibile e non conta
  const unsaved = state.audit.filter((a) => a.action !== 'import' && (!last || a.at > last)).length;
  const days = last ? daysBetween(last, nowLocalIso()) : null;
  const fuelUnsaved = state.entries.some((e) => e.type === 'fuel' && (e.source !== 'storico' || e.updatedAt !== e.createdAt) && (!last || e.updatedAt > last));
  const due = unsaved > 0 && (days == null || days >= BACKUP_REMIND_DAYS || fuelUnsaved);
  return { run, last, days, unsaved, due };
}
