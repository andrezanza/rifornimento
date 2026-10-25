import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import type { ChargeEntry, Entry, FuelEntry, Payment, ReadingEntry, WorkEntry } from '../domain/types';
import { fmt, nowLocalIso, parseDecimal, toScaled, uid, unitPriceMilli, amountFromPrice } from '../domain/units';
import { sortEntries } from '../domain/engine';
import { Card, Field, Icon, NumInput, Segmented, Toggle, toast, Details } from './components';

export type EntryKind = 'work' | 'fuel' | 'charge' | 'reading';

const s2 = (n: number | null | undefined, d = 2) => (n == null ? '' : String(Number(n.toFixed(d))).replace('.', ','));

function useOdoBounds(ts: string, excludeId?: string) {
  const { state } = useStore();
  return useMemo(() => {
    let before: { odo: number; ts: string } | null = { odo: state.settings.deliveryOdo, ts: state.settings.deliveryDate };
    let after: { odo: number; ts: string } | null = null;
    for (const e of sortEntries(state.entries)) {
      if (e.id === excludeId) continue;
      const o = e.type === 'fuel' || e.type === 'reading' ? e.odo : e.odo;
      if (o == null) continue;
      if (e.ts <= ts) { if (!before || o >= before.odo) before = { odo: o, ts: e.ts }; }
      else if (!after) after = { odo: o, ts: e.ts };
    }
    return { before, after };
  }, [state.entries, state.settings, ts, excludeId]);
}

function odoError(v: number | null, b: ReturnType<typeof useOdoBounds>, required: boolean): string | null {
  if (v == null) return required ? 'Inserisci il contachilometri.' : null;
  if (!Number.isFinite(v) || v < 0) return 'Valore non valido.';
  if (b.before && v < b.before.odo) return `Deve essere ≥ ${fmt.km(b.before.odo)} (valore del ${fmt.date(b.before.ts)}).`;
  if (b.after && v > b.after.odo) return `Deve essere ≤ ${fmt.km(b.after.odo)} (valore del ${fmt.date(b.after.ts)}).`;
  return null;
}

function DateTimeField({ ts, setTs }: { ts: string; setTs: (v: string) => void }) {
  const [d, t] = ts.split('T');
  return (
    <div className="row2">
      <Field label="Data"><input type="date" value={d} onChange={(e) => e.target.value && setTs(`${e.target.value}T${t || '12:00'}`)} /></Field>
      <Field label="Ora"><input type="time" value={t?.slice(0, 5) || '12:00'} onChange={(e) => setTs(`${d}T${e.target.value || '12:00'}`)} /></Field>
    </div>
  );
}

function stamp<T extends Entry>(e: Omit<T, 'createdAt' | 'updatedAt' | 'id'> & { id?: string }, initial?: Entry): T {
  const at = nowLocalIso();
  return { ...e, id: initial?.id ?? uid(), createdAt: initial?.createdAt ?? at, updatedAt: at, source: initial?.source ?? 'manuale' } as T;
}

export function NewEntry({ kind, setKind, initial, onDone, prefill }: {
  kind: EntryKind; setKind: (k: EntryKind) => void; initial?: Entry; onDone: () => void; prefill?: Partial<FuelEntry>;
}) {
  return (
    <div className="stack">
      {!initial && (
        <Segmented<EntryKind>
          value={kind}
          onChange={setKind}
          name="kind"
          options={[
            { value: 'work', label: <><Icon name="road" size={18} /> Km lavoro</> },
            { value: 'fuel', label: <><Icon name="pump" size={18} /> Benzina</> },
            { value: 'charge', label: <><Icon name="bolt" size={18} /> Ricarica</> },
            { value: 'reading', label: <><Icon name="gauge" size={18} /> Lettura</> },
          ]}
        />
      )}
      {kind === 'work' && <WorkForm initial={initial as WorkEntry} onDone={onDone} />}
      {kind === 'fuel' && <FuelForm initial={initial as FuelEntry} onDone={onDone} prefill={prefill} />}
      {kind === 'charge' && <ChargeForm initial={initial as ChargeEntry} onDone={onDone} />}
      {kind === 'reading' && <ReadingForm initial={initial as ReadingEntry} onDone={onDone} />}
    </div>
  );
}

function SaveBar({ onSave, disabled, label = 'Salva' }: { onSave: () => void; disabled?: boolean; label?: string }) {
  return (
    <button className="btn btn-primary btn-block btn-lg" disabled={disabled} onClick={onSave}>
      <Icon name="check" /> {label}
    </button>
  );
}

// --- Km lavorativi --------------------------------------------------------------

function WorkForm({ initial, onDone }: { initial?: WorkEntry; onDone: () => void }) {
  const { add, update, result } = useStore();
  const [ts, setTs] = useState(initial?.ts ?? nowLocalIso());
  const [km, setKm] = useState(initial ? String(initial.km) : '');
  const [kmMax, setKmMax] = useState(initial?.kmMax != null ? String(initial.kmMax) : '');
  const [odo, setOdo] = useState(initial?.odo != null ? String(initial.odo) : '');
  const [aggregate, setAggregate] = useState(!!initial?.tsFrom);
  const [from, setFrom] = useState(initial?.tsFrom?.slice(0, 10) ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const b = useOdoBounds(ts, initial?.id);
  const kmV = parseDecimal(km), kmMaxV = parseDecimal(kmMax), odoV = parseDecimal(odo);
  const kmErr = km && (kmV == null || kmV <= 0) ? 'Inserisci un numero positivo.' : null;
  const maxErr = kmMax && (kmMaxV == null || kmV == null || kmMaxV < kmV) ? 'Deve essere ≥ al valore minimo.' : null;
  const oErr = odoError(odoV, b, false);
  const sinceLast = odoV != null && b.before ? odoV - b.before.odo : null;
  const wErr = sinceLast != null && kmV != null && kmV > sinceLast + 0.5 && !aggregate
    ? `I km lavorativi superano i km percorsi dall'ultima lettura (${fmt.km(sinceLast)}).` : null;
  const valid = kmV != null && kmV > 0 && !kmErr && !maxErr && !oErr && !wErr && (!aggregate || from);

  const save = async () => {
    const e = stamp<WorkEntry>({
      type: 'work', ts, km: kmV!, kmMax: kmMaxV ?? undefined, odo: odoV ?? undefined,
      tsFrom: aggregate && from ? `${from}T00:00` : undefined, note: note || undefined,
    }, initial);
    await (initial ? update(e) : add(e));
    toast(initial ? 'Rettifica salvata' : `Registrati ${fmt.km(kmV!)} lavorativi`);
    onDone();
  };

  return (
    <Card title={initial ? 'Modifica km lavorativi' : 'Km lavorativi'}>
      <p className="muted small">Inserisci i km di lavoro (anche cumulati su più giorni). I km personali si ricavano dal contachilometri: non serve registrarli.</p>
      <Field label="Km lavorativi" error={kmErr}>
        <NumInput name="workKm" value={km} onChange={setKm} suffix="km" autoFocus={!initial} placeholder="es. 84" />
      </Field>
      <div className="chips">
        {[20, 40, 60, 80, 100].map((n) => <button key={n} type="button" className="chip" onClick={() => setKm(String((kmV ?? 0) + n))}>+{n}</button>)}
      </div>
      <Field label="Contachilometri attuale (consigliato)" hint={b.before ? `Ultimo valore: ${fmt.km(b.before.odo)}${sinceLast != null && sinceLast >= 0 ? ` · percorsi da allora ${fmt.km(sinceLast)}, di cui personali ${fmt.km(Math.max(0, sinceLast - (kmV ?? 0)))}` : ''}` : undefined} error={oErr || wErr}>
        <NumInput name="workOdo" value={odo} onChange={setOdo} suffix="km" placeholder={b.before ? String(b.before.odo) : ''} />
      </Field>
      <DateTimeField ts={ts} setTs={setTs} />
      <Details summary="Opzioni: periodo aggregato, intervallo, note">
        <Toggle checked={aggregate} onChange={setAggregate} label="Riferiti a un periodo (più giorni)" hint="Utile per inserire una settimana o un mese in un'unica registrazione." />
        {aggregate && <Field label="Dal giorno"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>}
        <Field label="Valore massimo (se il dato è un intervallo)" error={maxErr} hint="Es. 1650–1660: inserisci 1650 sopra e 1660 qui.">
          <NumInput value={kmMax} onChange={setKmMax} suffix="km" />
        </Field>
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="es. trasferta cliente Rossi" /></Field>
      </Details>
      {result.stale && !initial && <p className="small warn-t">Ricorda di aggiornare anche il contachilometri.</p>}
      <SaveBar onSave={save} disabled={!valid} />
    </Card>
  );
}

// --- Rifornimento -----------------------------------------------------------------

export function FuelForm({ initial, onDone, prefill }: { initial?: FuelEntry; onDone: () => void; prefill?: Partial<FuelEntry> }) {
  const { add, update, state, result } = useStore();
  const p = initial ?? prefill;
  const [ts, setTs] = useState(initial?.ts ?? nowLocalIso());
  const [odo, setOdo] = useState(p?.odo != null && p.odo > 0 ? String(p.odo) : '');
  const [liters, setLiters] = useState(p?.litersCl != null ? s2(p.litersCl / 100) : '');
  const [amount, setAmount] = useState(p?.amountCents != null ? s2(p.amountCents / 100) : '');
  const [price, setPrice] = useState(initial?.priceMilli != null ? s2(initial.priceMilli / 1000, 3) : '');
  const [payment, setPayment] = useState<Payment>(p?.payment ?? 'personal');
  const [full, setFull] = useState<'yes' | 'no' | 'unk'>(p?.full === false ? 'no' : p?.full == null && initial ? 'unk' : 'yes');
  const [note, setNote] = useState(initial?.note ?? '');
  const b = useOdoBounds(ts, initial?.id);

  const odoV = parseDecimal(odo), lV = parseDecimal(liters), aV = parseDecimal(amount), pV = parseDecimal(price);
  const oErr = odoError(odoV, b, true);
  // litri mancanti ma importo e prezzo presenti -> litri calcolati
  const litersCl = lV != null ? toScaled(lV, 100) : aV != null && pV ? toScaled(aV / pV, 100) : null;
  const amountCents = aV != null ? toScaled(aV, 100) : pV != null && litersCl ? amountFromPrice(toScaled(pV, 1000), litersCl, 100) : null;
  const unit = amountCents != null && litersCl ? unitPriceMilli(amountCents, litersCl, 100) : pV != null ? toScaled(pV, 1000) : null;
  const lErr = liters && (lV == null || lV <= 0) ? 'Valore non valido.' : litersCl == null && (liters || amount) ? 'Servono i litri, oppure importo e prezzo al litro.' : null;
  const cap = state.settings.tankCapacityL;
  const warn: string[] = [];
  if (litersCl != null && litersCl / 100 > cap + 1) warn.push(`Più litri della capacità del serbatoio (${cap} l): verifica.`);
  if (unit != null && (unit < 1000 || unit > 3000)) warn.push(`Prezzo unitario insolito (${fmt.price(unit)}): verifica importo e litri.`);
  if (amountCents == null && litersCl != null) warn.push('Importo mancante: il rifornimento conta nei litri ma non nelle spese finché non lo completi.');
  if (payment === 'company' && amountCents != null && !initial && amountCents > result.plafond.remainingCents) {
    warn.push(`Supera il plafond residuo (${fmt.eur(result.plafond.remainingCents)}).`);
  }
  const valid = !oErr && litersCl != null && litersCl > 0 && !lErr;

  const save = async () => {
    const e = stamp<FuelEntry>({
      type: 'fuel', ts, odo: odoV!, litersCl: litersCl!, amountCents: aV != null ? toScaled(aV, 100) : amountCents,
      priceMilli: aV == null && pV != null ? toScaled(pV, 1000) : null, payment,
      full: full === 'yes' ? true : full === 'no' ? false : null, note: note || undefined,
    }, initial);
    await (initial ? update(e) : add(e));
    toast(initial ? 'Rettifica salvata: calcoli aggiornati' : 'Rifornimento registrato');
    onDone();
  };

  return (
    <Card title={initial ? 'Modifica rifornimento' : 'Rifornimento benzina'}>
      <Field label="Contachilometri" error={oErr} hint={b.before ? `Ultimo valore: ${fmt.km(b.before.odo)}` : undefined}>
        <NumInput name="fuelOdo" value={odo} onChange={setOdo} suffix="km" autoFocus={!initial && !prefill} placeholder={b.before ? String(b.before.odo) : ''} />
      </Field>
      <div className="row2">
        <Field label="Litri" error={lErr}><NumInput name="fuelLiters" value={liters} onChange={setLiters} suffix="l" placeholder="es. 35,20" /></Field>
        <Field label="Importo pagato"><NumInput name="fuelAmount" value={amount} onChange={setAmount} suffix="€" placeholder="es. 70,00" /></Field>
      </div>
      <Field label="Prezzo al litro" hint={unit != null ? `Prezzo unitario: ${fmt.price(unit)}${aV != null && lV != null ? ' (calcolato)' : ''}` : 'Facoltativo: calcolato da importo e litri.'}>
        <NumInput value={price} onChange={setPrice} suffix="€/l" placeholder={unit != null ? s2(unit / 1000, 3) : 'es. 1,989'} />
      </Field>
      <Field label="Metodo di pagamento">
        <Segmented<Payment> name="payment" value={payment} onChange={setPayment} options={[{ value: 'personal', label: 'Carta personale' }, { value: 'company', label: 'Carta aziendale UTA e+' }]} />
      </Field>
      <Field label="Pieno completo?" hint="Pieno = fino allo scatto della pistola. Due pieni consecutivi permettono di misurare il consumo reale.">
        <Segmented name="full" value={full} onChange={setFull} options={[{ value: 'yes', label: 'Sì, pieno' }, { value: 'no', label: 'Parziale' }, { value: 'unk', label: 'Non so' }]} />
      </Field>
      <DateTimeField ts={ts} setTs={setTs} />
      <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="facoltative" /></Field>
      {warn.length > 0 && <ul className="warnlist">{warn.map((w) => <li key={w} className="w-attenzione">{w}</li>)}</ul>}
      <SaveBar onSave={save} disabled={!valid} />
    </Card>
  );
}

// --- Ricarica -----------------------------------------------------------------------

function ChargeForm({ initial, onDone }: { initial?: ChargeEntry; onDone: () => void }) {
  const { add, update, state } = useStore();
  const [ts, setTs] = useState(initial?.ts ?? nowLocalIso());
  const [kind, setKind] = useState<'home' | 'public'>(initial?.kind ?? 'home');
  const [payment, setPayment] = useState<Payment>(initial?.payment ?? 'personal');
  const [mode, setMode] = useState<'kwh' | 'sessions'>(initial?.sessions ? 'sessions' : 'kwh');
  const [kwh, setKwh] = useState(initial?.energyWh != null && !initial.sessions ? s2(initial.energyWh / 1000, 3) : '');
  const [sessions, setSessions] = useState(initial?.sessions ? String(initial.sessions) : '');
  const [perSession, setPerSession] = useState(initial?.sessions && initial.energyWh ? s2(initial.energyWh / 1000 / initial.sessions, 1) : s2(Math.round(state.settings.batteryNetKwh * 1.1 * 10) / 10, 1));
  const [estimated, setEstimated] = useState(initial?.estimated ?? false);
  const [amount, setAmount] = useState(initial?.amountCents != null ? s2(initial.amountCents / 100) : '');
  const [aggregate, setAggregate] = useState(!!initial?.tsFrom);
  const [from, setFrom] = useState(initial?.tsFrom?.slice(0, 10) ?? '');
  const [attr, setAttr] = useState<'proporzionale' | 'lavoro'>(initial?.attribution ?? 'proporzionale');
  const [note, setNote] = useState(initial?.note ?? '');

  const kV = parseDecimal(kwh), nV = parseDecimal(sessions), psV = parseDecimal(perSession), aV = parseDecimal(amount);
  const energyWh = mode === 'sessions' ? (nV != null && psV != null ? toScaled(nV * psV, 1000) : null) : kV != null ? toScaled(kV, 1000) : null;
  const isEst = mode === 'sessions' || estimated;
  const amountCents = aV != null ? toScaled(aV, 100) : null;
  const unit = amountCents != null && energyWh ? unitPriceMilli(amountCents, energyWh, 1000) : null;
  const pay = kind === 'home' ? 'personal' : payment;
  const valid = (energyWh != null && energyWh > 0) || (kind === 'public' && amountCents != null);

  const save = async () => {
    const e = stamp<ChargeEntry>({
      type: 'charge', ts, kind, payment: pay, energyWh, amountCents, estimated: isEst,
      sessions: mode === 'sessions' ? nV ?? undefined : undefined,
      tsFrom: aggregate && from ? `${from}T00:00` : undefined,
      attribution: kind === 'public' ? attr : undefined, note: note || undefined,
    }, initial);
    await (initial ? update(e) : add(e));
    toast(initial ? 'Rettifica salvata' : 'Ricarica registrata');
    onDone();
  };

  return (
    <Card title={initial ? 'Modifica ricarica' : 'Ricarica elettrica'}>
      <Field label="Tipo">
        <Segmented name="chargeKind" value={kind} onChange={setKind} options={[{ value: 'home', label: 'Domestica' }, { value: 'public', label: 'Colonnina pubblica' }]} />
      </Field>
      {kind === 'public' && (
        <Field label="Pagamento">
          <Segmented<Payment> value={payment} onChange={setPayment} options={[{ value: 'personal', label: 'Personale' }, { value: 'company', label: 'Carta UTA e+' }]} />
        </Field>
      )}
      {kind === 'home' && (
        <>
          <p className="muted small">Le ricariche domestiche sono registrate a fini statistici e non generano automaticamente un diritto al rimborso. Puoi inserirle anche in forma aggregata o stimata.</p>
          <Segmented value={mode} onChange={setMode} options={[{ value: 'kwh', label: 'kWh noti' }, { value: 'sessions', label: 'Stima da n. ricariche' }]} />
        </>
      )}
      {mode === 'kwh' || kind === 'public' ? (
        <Field label="Energia" hint={kind === 'home' ? 'Dal contatore, dalla wallbox o dall\'app dell\'auto.' : 'Indicata sullo scontrino o nell\'app.'}>
          <NumInput name="kwh" value={kwh} onChange={setKwh} suffix="kWh" placeholder="es. 18,5" />
        </Field>
      ) : (
        <div className="row2">
          <Field label="N. ricariche"><NumInput value={sessions} onChange={setSessions} placeholder="es. 6" /></Field>
          <Field label="kWh per ricarica" hint="Batteria 19,7 kWh netti + perdite Schuko ≈ 10%"><NumInput value={perSession} onChange={setPerSession} suffix="kWh" /></Field>
        </div>
      )}
      {kind === 'home' && mode === 'kwh' && <Toggle checked={estimated} onChange={setEstimated} label="Valore stimato" />}
      <Field label={kind === 'home' ? 'Costo (facoltativo)' : 'Importo pagato'} hint={unit != null ? `Prezzo: ${fmt.priceKwh(unit)}` : undefined}>
        <NumInput value={amount} onChange={setAmount} suffix="€" />
      </Field>
      <DateTimeField ts={ts} setTs={setTs} />
      <Details summary="Opzioni">
        <Toggle checked={aggregate} onChange={setAggregate} label="Riferita a un periodo (più ricariche)" />
        {aggregate && <Field label="Dal giorno"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>}
        {kind === 'public' && (
          <Field label="Attribuzione" hint="'Interamente lavorativa' solo se la ricarica è avvenuta durante una trasferta e l'energia serve al viaggio di lavoro. Motivalo nelle note.">
            <Segmented value={attr} onChange={setAttr} options={[{ value: 'proporzionale', label: 'Proporzionale ai km' }, { value: 'lavoro', label: 'Interamente lavorativa' }]} />
          </Field>
        )}
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Details>
      <SaveBar onSave={save} disabled={!valid} />
    </Card>
  );
}

// --- Lettura ---------------------------------------------------------------------------

function ReadingForm({ initial, onDone }: { initial?: ReadingEntry; onDone: () => void }) {
  const { add, update } = useStore();
  const [ts, setTs] = useState(initial?.ts ?? nowLocalIso());
  const [odo, setOdo] = useState(initial ? String(initial.odo) : '');
  const [level, setLevel] = useState<number | null>(initial?.fuelLevel ?? null);
  const [trip, setTrip] = useState(initial?.tripAvgL100 != null ? s2(initial.tripAvgL100, 1) : '');
  const [tripE, setTripE] = useState(initial?.tripAvgKwh100 != null ? s2(initial.tripAvgKwh100, 1) : '');
  const [evKm, setEvKm] = useState(initial?.evKm != null ? String(initial.evKm) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const b = useOdoBounds(ts, initial?.id);
  const odoV = parseDecimal(odo);
  const oErr = odoError(odoV, b, true);
  const tV = parseDecimal(trip), teV = parseDecimal(tripE), evV = parseDecimal(evKm);

  const save = async () => {
    const e = stamp<ReadingEntry>({
      type: 'reading', ts, odo: odoV!, fuelLevel: level ?? undefined,
      tripAvgL100: tV ?? undefined, tripAvgKwh100: teV ?? undefined, evKm: evV ?? undefined, note: note || undefined,
    }, initial);
    await (initial ? update(e) : add(e));
    toast('Lettura salvata');
    onDone();
  };

  return (
    <Card title={initial ? 'Modifica lettura' : 'Lettura contachilometri'}>
      <Field label="Contachilometri" error={odo ? oErr : null} hint={b.before ? `Ultimo valore: ${fmt.km(b.before.odo)}` : undefined}>
        <NumInput name="readOdo" value={odo} onChange={setOdo} suffix="km" autoFocus={!initial} />
      </Field>
      <DateTimeField ts={ts} setTs={setTs} />
      <Details summary="Modalità avanzata: serbatoio e computer di bordo" open={level != null || !!trip}>
        <Field label={`Livello serbatoio${level != null ? `: ${Math.round(level * 8)}/8` : ' (non indicato)'}`} hint="Rende più precisa la stima della benzina consumata.">
          <input type="range" min={0} max={8} step={1} value={level != null ? Math.round(level * 8) : 4} onChange={(e) => setLevel(Number(e.target.value) / 8)} />
        </Field>
        {level != null && <button type="button" className="linkbtn" onClick={() => setLevel(null)}>Rimuovi livello</button>}
        <Field label="Consumo medio benzina «dal rifornimento»" hint="Dal computer di bordo, memoria che si azzera a ogni rifornimento.">
          <NumInput value={trip} onChange={setTrip} suffix="l/100 km" />
        </Field>
        <div className="row2">
          <Field label="Consumo elettrico"><NumInput value={tripE} onChange={setTripE} suffix="kWh/100" /></Field>
          <Field label="Km in elettrico"><NumInput value={evKm} onChange={setEvKm} suffix="km" /></Field>
        </div>
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Details>
      <SaveBar onSave={save} disabled={!!oErr} />
    </Card>
  );
}
