import { useMemo } from 'react';
import { useStore } from '../data/store';
import { planFuel, type Verdict } from '../domain/planner';
import { fmt, nowLocalIso, daysBetween } from '../domain/units';
import { fuelPriceMilli } from '../domain/engine';
import { Badge, Card, Details, Icon, Kv, Meter, RangeL } from './components';
import type { Tab } from '../App';

export const VERDICT_UI: Record<Verdict, { tone: string; label: string; icon: string }> = {
  aziendale: { tone: 'ok', label: 'Carta aziendale compatibile', icon: 'check' },
  parziale: { tone: 'warn', label: 'Parziale aziendale possibile', icon: 'info' },
  personale: { tone: 'bad', label: 'Carta personale', icon: 'alert' },
  insufficienti: { tone: 'neutral', label: 'Dati insufficienti', icon: 'info' },
};

export function Dashboard({ go }: { go: (t: Tab, sub?: string) => void }) {
  const { state, result: r } = useStore();
  const s = state.settings;
  const plan = useMemo(
    () => planFuel(state, { full: true, liters: null, priceMilli: null, amountCents: null, odo: null, extraWorkKm: null, ts: nowLocalIso() }),
    [state],
  );
  const v = VERDICT_UI[plan.verdict];
  const relTone = r.fuel.reliability === 'alta' ? 'ok' : r.fuel.reliability === 'media' ? 'info' : 'warn';
  const backupDays = s.lastBackupAt ? daysBetween(s.lastBackupAt, nowLocalIso()) : null;
  const changesSinceBackup = s.lastBackupAt ? state.audit.filter((a) => a.at > s.lastBackupAt!).length : state.audit.length;
  const pf = r.plafond;

  return (
    <div className="stack">
      <Card className={`hero t-${v.tone}`}>
        <div className="hero-top">
          <span className="hero-ic"><Icon name={v.icon} size={26} /></span>
          <div>
            <div className="eyebrow">Prossimo pieno</div>
            <div className="hero-t">{v.label}</div>
          </div>
        </div>
        <p className="hero-p">{plan.headline}</p>
        <div className="hero-kpis">
          <div><small>Litri aziendali giustificabili</small><strong>{fmt.l(plan.maxCompanyL)}</strong></div>
          <div><small>Pieno stimato</small><strong>{fmt.num(plan.fitL.lo, 0)}–{fmt.num(plan.fitL.hi, 0)} l</strong></div>
        </div>
        <button className="btn btn-primary btn-block" onClick={() => go('plan')}>
          <Icon name="pump" /> Posso usare la carta aziendale?
        </button>
      </Card>

      <div className="grid2">
        <Card title="Saldo benzina lavorativo">
          <div className={`big ${r.fuel.balanceL.mid >= 0 ? 'pos' : 'neg'}`}><RangeL r={r.fuel.balanceL} signed /></div>
          <p className="muted small">
            {r.fuel.balanceL.mid >= 0 ? 'Litri consumati per lavoro non ancora pagati dall\'azienda.' : 'Litri pagati dall\'azienda oltre i consumi lavorativi stimati.'}
          </p>
          <div className="row-wrap">
            <Badge tone={relTone}>affidabilità {r.fuel.reliability}</Badge>
            {r.fuel.balanceEur && <Badge tone="neutral">≈ {fmt.eurF(r.fuel.balanceEur.mid)}</Badge>}
          </div>
        </Card>
        <Card title="Saldo ricariche lavorativo">
          <div className="big"><span>{fmt.kwhF(r.electric.balanceKwh.mid)}</span></div>
          <p className="muted small">Separato dalla benzina. Ricariche domestiche: {s.homeChargingInBalance ? 'incluse nel saldo' : 'solo statistica'}.</p>
          <div className="row-wrap"><Badge tone="info">domestiche {fmt.kwh(r.electric.homeWh)}</Badge></div>
        </Card>
      </div>

      <Card title="Plafond carta UTA e+" actions={!pf.verified ? <Badge tone="warn">provvisorio</Badge> : <Badge tone="ok">verificato</Badge>}>
        <div className="plaf">
          <div><strong>{fmt.eur(pf.spentCents)}</strong> <span className="muted">di {fmt.eur(pf.limitCents)}</span></div>
          <div className={pf.remainingCents < 0 ? 'neg' : ''}>Residuo <strong>{fmt.eur(pf.remainingCents)}</strong></div>
        </div>
        <Meter value={pf.spentCents} max={pf.limitCents} />
        <p className="muted small">
          Periodo {fmt.date(pf.periodStart)} – {fmt.date(addDay(pf.periodEnd, -1))} · rinnovo il giorno {s.plafondResetDay} · {pf.includesCharging ? 'benzina + ricariche' : 'solo benzina'}
          {pf.missingAmounts > 0 && ` · ${pf.missingAmounts} importi mancanti`}
        </p>
      </Card>

      <Card title="Chilometri" actions={<button className="btn btn-sm" onClick={() => go('new', 'work')}><Icon name="plus" size={18} /> Km lavorativi</button>}>
        <div className="kpis3">
          <div><small>Totali</small><strong>{fmt.km(r.totals.km)}</strong></div>
          <div><small>Lavorativi</small><strong>{rangeKm(r.totals.workKm)}</strong></div>
          <div><small>Personali</small><strong>{rangeKm(r.totals.personalKm)}</strong></div>
        </div>
        <div className="split">
          <div className="split-w" style={{ width: `${r.totals.workShare.mid * 100}%` }} />
        </div>
        <p className="muted small">
          Uso lavorativo {fmt.pct(r.totals.workShare.mid)}
          {r.totals.workShare.hi - r.totals.workShare.lo > 0.0005 && ` (${fmt.pct(r.totals.workShare.lo)}–${fmt.pct(r.totals.workShare.hi)})`}
          {' · '}ultimo contachilometri {r.lastOdoTs ? `${fmt.km(r.lastOdo - r.odoExtendedByWorkKm)} il ${fmt.date(r.lastOdoTs)}` : 'non inserito'}
        </p>
      </Card>

      {r.lastFuel && (
        <Card title="Ultimo rifornimento">
          <Kv k={fmt.date(r.lastFuel.ts)} v={`${fmt.liters(r.lastFuel.litersCl)} · ${fmt.eur(r.lastFuel.amountCents)}`} sub={` · ${fmt.price(fuelPriceMilli(r.lastFuel))}`} />
          <Kv k="Pagamento" v={r.lastFuel.payment === 'company' ? 'Carta aziendale UTA e+' : 'Carta personale'} />
          <Kv k="Pieno" v={r.lastFuel.full == null ? 'non noto' : r.lastFuel.full ? 'sì' : 'no (parziale)'} />
        </Card>
      )}

      {(r.warnings.length > 0 || backupDays == null || backupDays > 30) && (
        <Card title="Da sapere">
          <ul className="warnlist">
            {(backupDays == null || backupDays > 30) && changesSinceBackup > 0 && (
              <li className="w-attenzione">
                {backupDays == null ? 'Non hai ancora fatto un backup.' : `Ultimo backup ${Math.floor(backupDays)} giorni fa.`}{' '}
                <button className="linkbtn" onClick={() => go('settings', 'backup')}>Esegui backup</button>
              </li>
            )}
            {r.warnings.map((w, i) => <li key={i} className={`w-${w.level}`}>{w.text}</li>)}
          </ul>
        </Card>
      )}

      <Card>
        <Details summary="Come è calcolato il saldo benzina">
          <Kv k="Litri consumati per lavoro (maturato)" v={<RangeL r={r.fuel.accruedWorkL} />} />
          <Kv k="Litri pagati con carta aziendale" v={fmt.l(r.fuel.companyL, 2)} />
          {r.fuel.supplyL.hi > 0 && <Kv k="Carburante iniziale fornito con l'auto" v={<RangeL r={r.fuel.supplyL} />} sub=" (sconosciuto → intervallo)" />}
          <Kv k="Saldo = maturato − aziendale" v={<RangeL r={r.fuel.balanceL} signed />} />
          <Kv k="Scorta stimata nel serbatoio" v={<RangeL r={r.stockNow} />} />
          <Kv k="Consumo per km usato per le stime" v={`${fmt.num(r.rate.mid * 100, 2)} l/100 km`} sub={` (${fmt.num(r.rate.lo * 100, 1)}–${fmt.num(r.rate.hi * 100, 1)}, ${r.rate.source})`} />
          {r.fuel.historyWidthL > 0.5 && (
            <p className="muted small">
              Incertezza storica fissa ≈ {fmt.l(r.fuel.historyWidthL)}: dipende dal carburante presente alla consegna, che non è noto.
              Con il criterio {s.decisionBasis} le raccomandazioni usano il {s.decisionBasis === 'prudente' ? 'limite inferiore' : 'valore centrale'}.
            </p>
          )}
          <button className="btn btn-sm" onClick={() => go('history', 'segments')}>Dettaglio per tratto</button>
        </Details>
      </Card>
    </div>
  );
}

function rangeKm(r: { lo: number; hi: number; mid: number }) {
  return r.hi - r.lo < 0.5 ? fmt.km(r.mid) : `${fmt.num(r.lo, 0)}–${fmt.num(r.hi, 0)} km`;
}

function addDay(d: string, n: number) {
  const dt = new Date(d + 'T12:00');
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}
