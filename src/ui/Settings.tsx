import { useEffect, useRef, useState } from 'react';
import { useStore } from '../data/store';
import { listSnapshots, type Snapshot } from '../data/storage';
import type { Settings as S } from '../domain/types';
import { fmt, nowLocalIso, parseDecimal, toScaled } from '../domain/units';
import { entriesCsv, makeBackup, monthlyCsv, parseBackup } from '../domain/reports';
import { Badge, Card, Field, Icon, NumInput, Segmented, Toggle, toast, Details } from './components';
import { shareOrDownload, downloadFile, stampName } from './download';
import { Methodology } from './Methodology';

const str = (n: number | null | undefined, d = 2) => (n == null ? '' : String(Number(n.toFixed(d))).replace('.', ','));

export function Settings({ section }: { section?: string }) {
  const backupRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (section === 'backup') backupRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [section]);
  return (
    <div className="stack">
      <div ref={backupRef}><Backup /></div>
      <Policy />
      <Plafond />
      <Vehicle />
      <Card title="Metodologia di calcolo"><Methodology /></Card>
      <About />
    </div>
  );
}

function useDraft() {
  const { state, saveSettings } = useStore();
  const [d, setD] = useState<S>(state.settings);
  useEffect(() => setD(state.settings), [state.settings]);
  const set = <K extends keyof S>(k: K, v: S[K]) => setD((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(d) !== JSON.stringify(state.settings);
  const save = async () => { await saveSettings(d); toast('Impostazioni salvate: calcoli aggiornati'); };
  return { d, set, dirty, save };
}

function NumSetting({ label, value, onChange, suffix, hint, digits = 2 }: { label: string; value: number | null; onChange: (v: number | null) => void; suffix?: string; hint?: string; digits?: number }) {
  const [t, setT] = useState(str(value, digits));
  useEffect(() => setT(str(value, digits)), [value, digits]);
  return (
    <Field label={label} hint={hint}>
      <NumInput value={t} onChange={(v) => { setT(v); onChange(parseDecimal(v)); }} suffix={suffix} />
    </Field>
  );
}

function SaveRow({ dirty, save }: { dirty: boolean; save: () => void }) {
  return dirty ? <button className="btn btn-primary btn-block" onClick={save}><Icon name="check" /> Salva modifiche</button> : null;
}

function Policy() {
  const { d, set, dirty, save } = useDraft();
  return (
    <Card title="Regole di ripartizione" actions={d.policyAgreed ? <Badge tone="ok">concordate</Badge> : <Badge tone="warn">ipotesi operative</Badge>}>
      <p className="muted small">Regole verificate: carta solo per consumi lavorativi; casa-lavoro e trasferte sono lavoro. Tutto il resto qui sotto è un'ipotesi operativa configurabile, da concordare eventualmente con l'azienda.</p>
      <Field label="Criterio per le raccomandazioni">
        <Segmented value={d.decisionBasis} onChange={(v) => set('decisionBasis', v)} options={[{ value: 'prudente', label: 'Prudente (limite inferiore)' }, { value: 'centrale', label: 'Valore centrale' }]} />
      </Field>
      <NumSetting label="Margine di sicurezza" value={d.safetyMarginL} onChange={(v) => set('safetyMarginL', v ?? 0)} suffix="l" hint="Litri sottratti al saldo prima di consigliare la carta aziendale." />
      <NumSetting label="Quantità minima per un parziale aziendale" value={d.minPartialL} onChange={(v) => set('minPartialL', v ?? 0)} suffix="l" />
      <NumSetting label="Tetto al credito riportabile" value={d.maxCarryL} onChange={(v) => set('maxCarryL', v)} suffix="l" hint="Vuoto = compensazione nel tempo senza limite. Es. 20: il credito oltre 20 l non si accumula." />
      <Field label="Storico prima della data di riferimento">
        <Segmented value={d.historyMode} onChange={(v) => set('historyMode', v)} options={[{ value: 'include', label: 'Incluso nel saldo' }, { value: 'reset', label: 'Ripartenza da data' }]} />
      </Field>
      {d.historyMode === 'reset' && (
        <Field label="Data di riferimento" hint="Il saldo parte da zero; il carburante nel serbatoio a quella data è attribuito a chi è indicato sotto. Lo storico resta visibile nei report.">
          <input type="datetime-local" value={d.referenceTs} onChange={(e) => set('referenceTs', e.target.value)} />
        </Field>
      )}
      <Field label="Carburante nel serbatoio all'inizio della contabilità fornito da" hint="Alla consegna il carburante è di norma fornito con l'auto (azienda): criterio prudente.">
        <Segmented value={d.startFuelBy} onChange={(v) => set('startFuelBy', v)} options={[{ value: 'company', label: 'Azienda' }, { value: 'personal', label: 'Me' }]} />
      </Field>
      <div className="row2">
        <NumSetting label="Carburante alla consegna: min" value={d.deliveryFuelMinL} onChange={(v) => set('deliveryFuelMinL', v ?? 0)} suffix="l" />
        <NumSetting label="max" value={d.deliveryFuelMaxL} onChange={(v) => set('deliveryFuelMaxL', v ?? d.tankCapacityL)} suffix="l" />
      </div>
      <Toggle checked={d.homeChargingInBalance} onChange={(v) => set('homeChargingInBalance', v)} label="Le ricariche domestiche generano credito elettrico" hint="Disattivato: le ricariche di casa sono solo statistica (nessun diritto al rimborso presunto)." />
      <NumSetting label="Valore energia domestica (solo statistica)" value={d.homeEnergyPriceMilli / 1000} onChange={(v) => set('homeEnergyPriceMilli', toScaled(v ?? 0, 1000))} suffix="€/kWh" digits={3} hint="Anche il fotovoltaico ha un costo opportunità. 0 = non valorizzare." />
      <NumSetting label="Avviso dati non aggiornati dopo" value={d.staleDays} onChange={(v) => set('staleDays', Math.max(1, Math.round(v ?? 7)))} suffix="giorni" digits={0} />
      <Toggle checked={d.policyAgreed} onChange={(v) => set('policyAgreed', v)} label="Criterio concordato con l'azienda" hint="Segnalo solo dopo un accordo esplicito: comparirà nel riepilogo documentabile." />
      <SaveRow dirty={dirty} save={save} />
    </Card>
  );
}

function Plafond() {
  const { d, set, dirty, save } = useDraft();
  return (
    <Card title="Plafond carta UTA e+" actions={d.plafondVerified ? <Badge tone="ok">verificato</Badge> : <Badge tone="warn">provvisorio</Badge>}>
      <NumSetting label="Soglia mensile" value={d.plafondCents / 100} onChange={(v) => set('plafondCents', toScaled(v ?? 0, 100))} suffix="€" />
      <NumSetting label="Giorno di rinnovo" value={d.plafondResetDay} onChange={(v) => set('plafondResetDay', Math.min(28, Math.max(1, Math.round(v ?? 1))))} digits={0} hint="1–28. Non è detto che il plafond si azzeri il primo del mese: verifica sul portale o con l'ufficio flotte." />
      <Toggle checked={d.plafondIncludesCharging} onChange={(v) => set('plafondIncludesCharging', v)} label="Il plafond comprende anche le ricariche elettriche" hint="La carta UTA e+ è multienergia; non è stato possibile verificare se il limite sia unico." />
      <Toggle checked={d.plafondVerified} onChange={(v) => set('plafondVerified', v)} label="Condizioni verificate" hint="Attivalo dopo conferma da azienda o Edenred UTA." />
      <SaveRow dirty={dirty} save={save} />
    </Card>
  );
}

function Vehicle() {
  const { d, set, dirty, save } = useDraft();
  return (
    <Card title="Veicolo e stime">
      <Details summary={`${d.vehicleName} · serbatoio ${d.tankCapacityL} l · batteria ${str(d.batteryNetKwh, 1)} kWh`}>
        <Field label="Nome"><input value={d.vehicleName} onChange={(e) => set('vehicleName', e.target.value)} /></Field>
        <div className="row2">
          <Field label="Data consegna"><input type="date" value={d.deliveryDate} onChange={(e) => set('deliveryDate', e.target.value)} /></Field>
          <NumSetting label="Km alla consegna" value={d.deliveryOdo} onChange={(v) => set('deliveryOdo', v ?? 0)} digits={0} suffix="km" />
        </div>
        <div className="row2">
          <NumSetting label="Capacità serbatoio" value={d.tankCapacityL} onChange={(v) => set('tankCapacityL', v ?? 40)} suffix="l" hint="40 l da scheda tecnica" />
          <NumSetting label="Batteria netta" value={d.batteryNetKwh} onChange={(v) => set('batteryNetKwh', v ?? 19.7)} suffix="kWh" />
        </div>
        <p className="muted small">Consumo da usare finché non ci sono due pieni consecutivi (poi viene misurato):</p>
        <div className="row3">
          <NumSetting label="Centrale" value={d.fallbackRateL100} onChange={(v) => set('fallbackRateL100', v ?? 5.2)} suffix="l/100" />
          <NumSetting label="Min" value={d.fallbackRateMinL100} onChange={(v) => set('fallbackRateMinL100', v ?? 2)} suffix="l/100" />
          <NumSetting label="Max" value={d.fallbackRateMaxL100} onChange={(v) => set('fallbackRateMaxL100', v ?? 7)} suffix="l/100" />
        </div>
        <NumSetting label="Consumo massimo plausibile" value={d.maxRateL100} onChange={(v) => set('maxRateL100', v ?? 8)} suffix="l/100" />
        <NumSetting label="Tolleranza indicatore serbatoio" value={d.fuelLevelTol * 100} onChange={(v) => set('fuelLevelTol', (v ?? 6.25) / 100)} suffix="% serbatoio" />
        <NumSetting label="Tolleranza computer di bordo" value={d.tripComputerTol * 100} onChange={(v) => set('tripComputerTol', (v ?? 10) / 100)} suffix="%" />
        <p className="muted small">Computer di bordo all'onboarding: {str(d.boardAvgKmL, 1)} km/l, {str(d.boardAvgKwh100, 1)} kWh/100 km (solo riferimento: non coerenti con i litri acquistati su tutti i {fmt.km(2910)}).</p>
      </Details>
      <SaveRow dirty={dirty} save={save} />
    </Card>
  );
}

function Backup() {
  const { state, restore, markBackup, wipe, persisted } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  useEffect(() => { listSnapshots().then(setSnaps); }, [state]);

  const backup = async () => {
    const at = nowLocalIso();
    const json = JSON.stringify(makeBackup(state, at), null, 1);
    try {
      const how = await shareOrDownload(stampName('rifornimento-backup', 'json'), json, 'application/json');
      await markBackup();
      toast(how === 'shared' ? 'Backup condiviso' : 'Backup scaricato nella cartella Download');
    } catch { toast('Backup annullato'); }
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const b = parseBackup(await f.text());
      const n = b.state.entries.length;
      if (!confirm(`Ripristinare il backup del ${fmt.dateTime(b.exportedAt)} con ${n} registrazioni?\n\nI dati attuali verranno sostituiti (resta una copia di sicurezza interna).`)) return;
      await restore(b.state);
      toast(`Ripristinate ${n} registrazioni`);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const last = state.settings.lastBackupAt;
  return (
    <Card title="Backup e ripristino" actions={last ? <Badge tone="ok">{fmt.date(last)}</Badge> : <Badge tone="warn">mai</Badge>}>
      <p className="muted small">I dati restano solo su questo dispositivo. Il browser o la pulizia dei dati possono cancellarli: salva un backup dopo ogni rifornimento importante, o almeno una volta al mese, su Google Drive o via email.</p>
      <button className="btn btn-primary btn-block" onClick={backup}><Icon name="download" /> Salva backup (JSON)</button>
      <button className="btn btn-block" onClick={() => fileRef.current?.click()}><Icon name="upload" /> Ripristina da backup</button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} data-testid="restore-input" />
      <div className="row2">
        <button className="btn btn-sm" onClick={() => downloadFile(stampName('rifornimento-registrazioni', 'csv'), entriesCsv(state), 'text/csv;charset=utf-8')}>CSV registrazioni</button>
        <button className="btn btn-sm" onClick={() => downloadFile(stampName('rifornimento-mensile', 'csv'), monthlyCsv(state), 'text/csv;charset=utf-8')}>CSV mensile</button>
      </div>
      <p className="muted small">Archiviazione persistente: {persisted === true ? 'concessa dal browser' : persisted === false ? 'non concessa (installa l\'app sulla schermata Home)' : 'non verificabile'}.</p>
      {snaps.length > 0 && (
        <Details summary={`Copie di sicurezza interne (${snaps.length})`}>
          <p className="muted small">Create automaticamente prima di ripristini e cancellazioni. Non sostituiscono il backup su file.</p>
          {snaps.map((s, i) => (
            <div key={i} className="kv">
              <span className="kv-k">{fmt.dateTime(s.at)} · {s.reason}</span>
              <button className="btn btn-sm" onClick={async () => { if (confirm('Ripristinare questa copia?')) { await restore(s.state); toast('Copia ripristinata'); } }}>Ripristina</button>
            </div>
          ))}
        </Details>
      )}
      <Details summary="Zona pericolosa">
        <button className="btn btn-danger btn-block" onClick={async () => { if (confirm('Cancellare TUTTI i dati da questo dispositivo? Fai prima un backup.') && confirm('Confermi la cancellazione definitiva?')) { await wipe(); toast('Dati cancellati'); } }}>
          <Icon name="trash" /> Cancella tutti i dati
        </button>
      </Details>
    </Card>
  );
}

function About() {
  return (
    <Card title="Informazioni">
      <p className="small">Rifornimento v{__APP_VERSION__}. App personale local-first: nessun account, nessun server, nessun tracciamento. Funziona offline dopo la prima apertura. Gli aggiornamenti dell'app non toccano i dati salvati sul dispositivo.</p>
    </Card>
  );
}
