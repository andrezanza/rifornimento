import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { planCharge, planFuel } from '../domain/planner';
import type { FuelEntry } from '../domain/types';
import { fmt, nowLocalIso, parseDecimal, toScaled } from '../domain/units';
import { Badge, Card, Field, Icon, Kv, NumInput, Segmented, Toggle } from './components';
import { VERDICT_UI } from './Dashboard';

export function Planner({ onRecord }: { onRecord: (prefill: Partial<FuelEntry>) => void }) {
  const [tab, setTab] = useState<'fuel' | 'charge'>('fuel');
  return (
    <div className="stack">
      <Segmented value={tab} onChange={setTab} options={[{ value: 'fuel', label: <><Icon name="pump" size={18} /> Benzina</> }, { value: 'charge', label: <><Icon name="bolt" size={18} /> Ricarica pubblica</> }]} />
      {tab === 'fuel' ? <FuelPlanner onRecord={onRecord} /> : <ChargePlanner />}
    </div>
  );
}

function FuelPlanner({ onRecord }: { onRecord: (prefill: Partial<FuelEntry>) => void }) {
  const { state, result } = useStore();
  const [full, setFull] = useState(true);
  const [liters, setLiters] = useState('');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [odo, setOdo] = useState('');
  const [extra, setExtra] = useState('');
  const lV = parseDecimal(liters), pV = parseDecimal(price), aV = parseDecimal(amount), oV = parseDecimal(odo), xV = parseDecimal(extra);
  const odoBad = oV != null && oV < result.lastOdo - result.odoExtendedByWorkKm;

  const plan = useMemo(() => planFuel(state, {
    full, liters: lV, priceMilli: pV != null ? toScaled(pV, 1000) : null, amountCents: aV != null ? toScaled(aV, 100) : null,
    odo: odoBad ? null : oV, extraWorkKm: xV, ts: nowLocalIso(),
  }), [state, full, lV, pV, aV, oV, xV, odoBad]);
  const v = VERDICT_UI[plan.verdict];
  const basisSel = (r: { lo: number; mid: number }) => (plan.basis === 'prudente' ? r.lo : r.mid);

  return (
    <>
      <Card title="Posso fare rifornimento con la carta aziendale?">
        <Toggle checked={full} onChange={setFull} label="Pieno completo" hint={full ? 'Il consumo del tratto verrà misurato: è la scelta più precisa.' : 'Rifornimento parziale: indica i litri o l\'importo.'} />
        <div className="row2">
          <Field label={full ? 'Litri (se già noti)' : 'Litri previsti'}><NumInput name="planLiters" value={liters} onChange={setLiters} suffix="l" placeholder={full ? `≈ ${fmt.num(plan.fitL.mid, 0)}` : ''} /></Field>
          <Field label="Prezzo al litro"><NumInput value={price} onChange={setPrice} suffix="€/l" placeholder={result.fuel.refPriceMilli ? fmt.num(result.fuel.refPriceMilli / 1000, 3) : ''} /></Field>
        </div>
        <Field label="Oppure importo previsto"><NumInput value={amount} onChange={setAmount} suffix="€" /></Field>
        <div className="row2">
          <Field label="Contachilometri ora" error={odoBad ? 'Inferiore all\'ultimo valore registrato.' : null}><NumInput name="planOdo" value={odo} onChange={setOdo} suffix="km" placeholder={String(Math.round(result.lastOdo))} /></Field>
          <Field label="Km lavoro non registrati"><NumInput name="planExtra" value={extra} onChange={setExtra} suffix="km" placeholder="0" /></Field>
        </div>
      </Card>

      <Card className={`hero t-${v.tone}`}>
        <div className="hero-top">
          <span className="hero-ic"><Icon name={v.icon} size={26} /></span>
          <div>
            <div className="eyebrow">Valutazione</div>
            <div className="hero-t" data-testid="verdict">{v.label}</div>
          </div>
        </div>
        <p className="hero-p">{plan.headline}</p>
        <div className="hero-kpis">
          <div><small>Max con carta aziendale</small><strong data-testid="maxL">{fmt.l(plan.maxCompanyL)}</strong></div>
          <div><small>Litri considerati</small><strong>{fmt.l(plan.litersUsed)}{plan.litersEstimated ? '*' : ''}</strong></div>
          {plan.amountCents != null && <div><small>Importo</small><strong>{fmt.eur(plan.amountCents)}</strong></div>}
        </div>
      </Card>

      <Card title="Effetto simulato sul saldo">
        <table className="sim">
          <thead><tr><th></th><th>Centrale</th><th>Intervallo</th><th>Prudente</th></tr></thead>
          <tbody>
            <tr><td>Prima</td><td>{fmt.signedL(plan.before.mid)}</td><td className="muted">{fmt.num(plan.before.lo)} … {fmt.num(plan.before.hi)}</td><td>{fmt.signedL(plan.before.lo)}</td></tr>
            <tr className={basisSel(plan.afterCompany) >= 0 ? 'ok' : 'bad'} data-basis={plan.basis}><td>Dopo, con carta aziendale</td><td>{fmt.signedL(plan.afterCompany.mid)}</td><td className="muted">{fmt.num(plan.afterCompany.lo)} … {fmt.num(plan.afterCompany.hi)}</td><td>{fmt.signedL(plan.afterCompany.lo)}</td></tr>
            <tr><td>Dopo, con carta personale</td><td>{fmt.signedL(plan.afterPersonal.mid)}</td><td className="muted">{fmt.num(plan.afterPersonal.lo)} … {fmt.num(plan.afterPersonal.hi)}</td><td>{fmt.signedL(plan.afterPersonal.lo)}</td></tr>
          </tbody>
        </table>
        <p className="muted small">Saldo positivo = credito stimato verso l'azienda (litri consumati per lavoro non ancora pagati con la carta). Negativo = l'azienda ha pagato più dei consumi lavorativi stimati.</p>
        <Kv k="Plafond residuo" v={fmt.eur(result.plafond.remainingCents)} sub={plan.plafondMaxL != null ? ` · ≈ ${fmt.l(plan.plafondMaxL)}` : ''} />
        <Kv k="Spazio stimato nel serbatoio" v={`${fmt.num(plan.fitL.lo, 0)}–${fmt.num(plan.fitL.hi, 0)} l`} />
      </Card>

      <Card title="Motivazione">
        <ul className="reasons">{plan.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      </Card>

      <div className="row2">
        <button className="btn btn-block" onClick={() => onRecord({ payment: 'personal', full, litersCl: lV != null ? toScaled(lV, 100) : undefined, amountCents: aV != null ? toScaled(aV, 100) : undefined, odo: oV ?? undefined })}>
          Registra con carta personale
        </button>
        <button className="btn btn-primary btn-block" disabled={plan.verdict === 'personale'} onClick={() => onRecord({ payment: 'company', full, litersCl: lV != null ? toScaled(lV, 100) : undefined, amountCents: aV != null ? toScaled(aV, 100) : undefined, odo: oV ?? undefined })}>
          Registra con carta aziendale
        </button>
      </div>
    </>
  );
}

function ChargePlanner() {
  const { state, result } = useStore();
  const [kwh, setKwh] = useState('');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [work, setWork] = useState(false);
  const kV = parseDecimal(kwh), pV = parseDecimal(price), aV = parseDecimal(amount);
  const plan = useMemo(() => planCharge(state, {
    kwh: kV, priceMilliKwh: pV != null ? toScaled(pV, 1000) : null, amountCents: aV != null ? toScaled(aV, 100) : null,
    workDedicated: work, ts: nowLocalIso(),
  }), [state, kV, pV, aV, work]);
  const v = VERDICT_UI[plan.verdict];
  return (
    <>
      <Card title="Ricarica pubblica con UTA e+?">
        <div className="row2">
          <Field label="kWh previsti"><NumInput value={kwh} onChange={setKwh} suffix="kWh" placeholder={String(plan.kwhUsed).replace('.', ',')} /></Field>
          <Field label="Prezzo"><NumInput value={price} onChange={setPrice} suffix="€/kWh" placeholder="es. 0,69" /></Field>
        </div>
        <Field label="Oppure importo previsto"><NumInput value={amount} onChange={setAmount} suffix="€" /></Field>
        <Toggle checked={work} onChange={setWork} label="Ricarica durante una trasferta di lavoro" hint="Attribuisce il 100% al lavoro: usalo solo se giustificabile e annotalo." />
      </Card>
      <Card className={`hero t-${v.tone}`}>
        <div className="hero-top">
          <span className="hero-ic"><Icon name={v.icon} size={26} /></span>
          <div><div className="eyebrow">Valutazione</div><div className="hero-t">{v.label}</div></div>
        </div>
        <p className="hero-p">{plan.headline}</p>
      </Card>
      <Card title="Effetto simulato">
        <Kv k="Saldo elettrico prima" v={`${fmt.num(plan.before.mid, 1)} kWh`} />
        <Kv k="Dopo, con carta aziendale" v={`${fmt.num(plan.afterCompany.mid, 1)} kWh`} />
        <Kv k="Dopo, con carta personale" v={`${fmt.num(plan.afterPersonal.mid, 1)} kWh`} />
        <Kv k="Plafond residuo" v={fmt.eur(result.plafond.remainingCents)} sub={result.plafond.includesCharging ? '' : ' (ricariche escluse)'} />
        {!result.plafond.verified && <Badge tone="warn">plafond provvisorio</Badge>}
      </Card>
      <Card title="Motivazione"><ul className="reasons">{plan.reasons.map((r) => <li key={r}>{r}</li>)}</ul></Card>
    </>
  );
}
