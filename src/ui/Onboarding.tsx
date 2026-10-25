import { useState } from 'react';
import { useStore } from '../data/store';
import { ANDREA_DEFAULTS, ANDREA_SETTINGS, ANDREA_TRIPS } from '../domain/seed';
import { fmt, parseDecimal } from '../domain/units';
import { Card, Details, Field, Icon, NumInput, Segmented, QualityBadge } from './components';

const LEVELS = [
  { value: 'unk', label: 'Non so' }, { value: '1', label: 'Pieno' }, { value: '0.75', label: '3/4' },
  { value: '0.5', label: '1/2' }, { value: '0.25', label: '1/4' },
];

export function Onboarding() {
  const { onboard, startEmpty } = useStore();
  const [odo, setOdo] = useState(String(ANDREA_DEFAULTS.currentOdo));
  const [date, setDate] = useState(ANDREA_DEFAULTS.currentTs.slice(0, 10));
  const [now, setNow] = useState(String(ANDREA_DEFAULTS.currentLevel ?? 'unk'));
  const workTot = ANDREA_TRIPS.reduce((a, t) => a + t.km, 0);

  const go = async () => {
    await onboard(
      {
        currentOdo: parseDecimal(odo) ?? ANDREA_DEFAULTS.currentOdo,
        currentTs: `${date}T${date === ANDREA_DEFAULTS.currentTs.slice(0, 10) ? ANDREA_DEFAULTS.currentTs.slice(11) : '12:00'}`,
        currentLevel: now === 'unk' ? null : Number(now),
      },
      ANDREA_SETTINGS,
    );
  };

  return (
    <div className="stack onb">
      <div className="onb-h">
        <span className="logo"><Icon name="pump" size={30} /></span>
        <h1>Rifornimento</h1>
        <p>Carta carburante aziendale e quota lavorativa della tua CUPRA Formentor e-HYBRID.</p>
      </div>

      <Card title="Dati già disponibili">
        <p className="small">Questi dati sono già precaricati, non devi reinserirli. Consegna il 18/09 a 40 km. Rifornimenti (tutti pieni completi):</p>
        <table className="tbl">
          <thead><tr><th>Data</th><th>Km</th><th>Litri</th><th>€</th><th>€/l</th><th>Carta</th></tr></thead>
          <tbody>
            <tr><td>18/09</td><td>48</td><td>35,87*</td><td>76,01</td><td>2,119</td><td>pers.</td></tr>
            <tr><td>20/09</td><td>512</td><td>29,68*</td><td>62,00</td><td>2,089</td><td>pers.</td></tr>
            <tr><td>30/09</td><td>1.220</td><td>32,34</td><td>64,00</td><td>1,979</td><td>pers.</td></tr>
            <tr><td>11/10</td><td>1.981</td><td>35,68</td><td>71,00</td><td>1,990</td><td>pers.</td></tr>
            <tr><td>23/10</td><td>2.752</td><td>39,03</td><td>77,67</td><td>1,990</td><td>UTA</td></tr>
          </tbody>
        </table>
        <p className="muted small">* litri ricavati da importo e prezzo ricordato: prezzo coerente con le medie nazionali di quei giorni, non verificato sull'impianto.</p>
        <Details summary={`${ANDREA_TRIPS.length} tragitti lavorativi, ${fmt.km(workTot)}`}>
          <table className="tbl">
            <tbody>
              {ANDREA_TRIPS.map((t) => <tr key={t.date}><td>{fmt.date(t.date)}</td><td>{t.purpose === 'trasferta' ? 'Trasferta (cliente)' : 'Casa-lavoro'}</td><td>{t.km} km</td></tr>)}
            </tbody>
          </table>
        </Details>
        <ul className="qual">
          <li><QualityBadge q="certo" /> date, contachilometri, importi, pagamento, pieni completi, tragitti lavorativi, litri dal 30/09</li>
          <li><QualityBadge q="stimato" /> litri del 18 e 20/09 (da prezzo), benzina alla consegna (4–8 l), indicatore benzina attuale</li>
          <li><QualityBadge q="sconosciuto" /> storico delle ricariche domestiche</li>
          <li><QualityBadge q="provvisorio" /> plafond 500 €/mese, rinnovo il 1° del mese, comprensivo delle ricariche</li>
        </ul>
        <p className="muted small">I consumi medi del computer di bordo (19,3 km/l, 5,2 kWh/100 km) sono conservati solo come riferimento e non usati come misura: i consumi reali si ricavano dai pieni.</p>
      </Card>

      <Card title="Situazione attuale">
        <div className="row2">
          <Field label="Contachilometri"><NumInput value={odo} onChange={setOdo} suffix="km" /></Field>
          <Field label="Alla data"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Indicatore benzina a quella data">
          <Segmented value={now} onChange={setNow} options={LEVELS} />
        </Field>
        <button className="btn btn-primary btn-block btn-lg" onClick={go} data-testid="onboard">
          <Icon name="check" /> Importa i dati e inizia
        </button>
        <p className="muted small">Da qui in avanti: registra i km di lavoro (con il contachilometri quando puoi) e fai sempre il <strong>pieno completo</strong>, così i consumi restano misurati.</p>
      </Card>
      <button className="linkbtn center" onClick={() => startEmpty({})}>Inizia senza dati storici</button>
    </div>
  );
}
