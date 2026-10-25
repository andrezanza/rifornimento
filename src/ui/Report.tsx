import { useMemo } from 'react';
import { useStore } from '../data/store';
import { sortEntries, fuelAmountCents, fuelPriceMilli } from '../domain/engine';
import { monthlyReport } from '../domain/reports';
import type { ChargeEntry, FuelEntry } from '../domain/types';
import { fmt, nowLocalIso } from '../domain/units';
import { Icon, RangeL } from './components';

export function Report({ onClose }: { onClose: () => void }) {
  const { state, result: r } = useStore();
  const s = state.settings;
  const { rows, aggregates } = useMemo(() => monthlyReport(state), [state]);
  const entries = sortEntries(state.entries);
  const fuels = entries.filter((e): e is FuelEntry => e.type === 'fuel');
  const charges = entries.filter((e): e is ChargeEntry => e.type === 'charge');

  return (
    <div className="report">
      <div className="no-print row2">
        <button className="btn" onClick={onClose}><Icon name="back" /> Indietro</button>
        <button className="btn btn-primary" onClick={() => window.print()}><Icon name="file" /> Stampa / salva PDF</button>
      </div>
      <h1>Riepilogo utilizzo carta carburante</h1>
      <p>{s.vehicleName} · consegna {fmt.date(s.deliveryDate)} · generato il {fmt.dateTime(nowLocalIso())}</p>

      <h2>1. Criterio adottato</h2>
      <p>Benzina consumata misurata tra pieni completi (pieno-a-pieno) e ripartita in proporzione ai km lavorativi del tratto; saldo progressivo in litri tra consumo lavorativo e litri pagati con carta aziendale. Ricariche elettriche con saldo separato in kWh.
        {s.policyAgreed ? ' Criterio concordato con l\'azienda.' : ' Criterio adottato in autonomia, in assenza di una policy dettagliata: è un\'ipotesi operativa.'}</p>
      <ul>
        <li>Regole aziendali note: carta riservata ai consumi lavorativi; casa-lavoro e trasferte sono lavorativi; spostamenti privati a carico del dipendente.</li>
        <li>Criterio decisionale: {s.decisionBasis}{s.decisionBasis === 'prudente' ? ' (limite inferiore delle stime)' : ''}; margine {s.safetyMarginL} l; credito riportabile {s.maxCarryL == null ? 'senza tetto' : `max ${s.maxCarryL} l`}.</li>
        <li>Carburante presente all'inizio: {fmt.l(s.deliveryFuelMinL, 0)}–{fmt.l(s.deliveryFuelMaxL, 0)}, considerato fornito {s.startFuelBy === 'company' ? 'dall\'azienda' : 'dal dipendente'}.</li>
        <li>Ricariche domestiche: {s.homeChargingInBalance ? 'incluse nel saldo elettrico' : 'solo statistiche, nessun rimborso presunto'}.</li>
        <li>Plafond: {fmt.eur(s.plafondCents)} per periodo, rinnovo il giorno {s.plafondResetDay}, {s.plafondIncludesCharging ? 'comprensivo' : 'esclusive'} delle ricariche — {s.plafondVerified ? 'verificato' : 'condizioni non verificate'}.</li>
      </ul>

      <h2>2. Situazione al {fmt.date(nowLocalIso())}</h2>
      <table className="tbl">
        <tbody>
          <tr><td>Km totali dalla consegna</td><td>{fmt.km(r.totals.km)}</td></tr>
          <tr><td>Km lavorativi</td><td>{r.totals.workKm.hi - r.totals.workKm.lo > 0.5 ? `${fmt.num(r.totals.workKm.lo, 0)}–${fmt.num(r.totals.workKm.hi, 0)}` : fmt.num(r.totals.workKm.mid, 0)} km ({fmt.pct(r.totals.workShare.mid)})</td></tr>
          <tr><td>Benzina pagata personalmente</td><td>{fmt.liters(r.totals.fuelPersonalCl)} · {fmt.eur(r.totals.fuelPersonalCents)}</td></tr>
          <tr><td>Benzina pagata con carta aziendale</td><td>{fmt.liters(r.totals.fuelCompanyCl)} · {fmt.eur(r.totals.fuelCompanyCents)}</td></tr>
          <tr><td>Benzina consumata per lavoro (stima)</td><td><RangeL r={r.fuel.accruedWorkL} /></td></tr>
          <tr><td>Saldo benzina lavorativo</td><td><RangeL r={r.fuel.balanceL} signed /> (affidabilità {r.fuel.reliability})</td></tr>
          <tr><td>Ricariche domestiche</td><td>{fmt.kwh(r.electric.homeWh)}{r.electric.homeEstimatedWh ? ` (di cui stimati ${fmt.kwh(r.electric.homeEstimatedWh)})` : ''}</td></tr>
          <tr><td>Ricariche pubbliche personali / aziendali</td><td>{fmt.kwh(r.electric.publicPersonalWh)} · {fmt.eur(r.electric.publicPersonalCents)} / {fmt.kwh(r.electric.publicCompanyWh)} · {fmt.eur(r.electric.publicCompanyCents)}</td></tr>
          <tr><td>Saldo elettrico lavorativo</td><td>{fmt.num(r.electric.balanceKwh.mid, 1)} kWh</td></tr>
        </tbody>
      </table>

      <h2>3. Riepilogo mensile</h2>
      <table className="tbl">
        <thead><tr><th>Mese</th><th>Benzina personale</th><th>Benzina aziendale</th><th>Ricariche pers./az.</th><th>Km lav.</th><th>Km totali</th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.month}>
              <td className="cap">{fmt.month(m.month)}</td>
              <td>{fmt.eur(m.fuelPersonalCents)} ({fmt.liters(m.fuelPersonalCl)})</td>
              <td>{fmt.eur(m.fuelCompanyCents)} ({fmt.liters(m.fuelCompanyCl)})</td>
              <td>{fmt.eur(m.publicPersonalCents)} / {fmt.eur(m.publicCompanyCents)}</td>
              <td>{m.workKm === m.workKmMax ? m.workKm : `${m.workKm}–${m.workKmMax}`}</td>
              <td>{m.kmTotal ?? 'n.d.'}{m.kmEstimated ? '*' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">* km mensili ricavati dal contachilometri per interpolazione.{aggregates.map((a) => ` Km lavorativi ${a.entry.kmMax ? `${a.entry.km}–${a.entry.kmMax}` : a.entry.km} dal ${fmt.date(a.from)} al ${fmt.date(a.to)}: stima aggregata non ripartibile per mese.`).join('')}</p>

      <h2>4. Rifornimenti</h2>
      <table className="tbl">
        <thead><tr><th>Data</th><th>Km</th><th>Litri</th><th>Importo</th><th>€/l</th><th>Pagamento</th><th>Pieno</th></tr></thead>
        <tbody>
          {fuels.map((f) => (
            <tr key={f.id}><td>{fmt.date(f.ts)}</td><td>{f.odo}</td><td>{fmt.num(f.litersCl / 100, 2)}</td><td>{fmt.eur(fuelAmountCents(f))}</td><td>{fmt.price(fuelPriceMilli(f))}</td><td>{f.payment === 'company' ? 'aziendale' : 'personale'}</td><td>{f.full == null ? 'n.n.' : f.full ? 'sì' : 'no'}</td></tr>
          ))}
        </tbody>
      </table>
      {charges.length > 0 && (
        <>
          <h2>5. Ricariche</h2>
          <table className="tbl">
            <thead><tr><th>Data</th><th>Tipo</th><th>kWh</th><th>Importo</th><th>Pagamento</th></tr></thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id}><td>{c.tsFrom ? `${fmt.date(c.tsFrom)}–` : ''}{fmt.date(c.ts)}</td><td>{c.kind === 'home' ? 'domestica' : 'pubblica'}{c.estimated ? ' (stima)' : ''}</td><td>{c.energyWh != null ? fmt.num(c.energyWh / 1000, 1) : 'n.d.'}</td><td>{fmt.eur(c.amountCents)}</td><td>{c.payment === 'company' ? 'aziendale' : 'personale'}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h2>Note</h2>
      <p className="small">Le stime sono indicate come intervalli. Il saldo è un indicatore di calcolo basato sui dati registrati e non costituisce un'autorizzazione o un riconoscimento da parte dell'azienda. Registro rettifiche: {state.audit.length} operazioni annotate.</p>
    </div>
  );
}
