import { useState } from 'react';
import { useStore } from '../data/store';
import { ANDREA_DEFAULTS, ANDREA_TRIPS, deliveryRange } from '../domain/seed';
import { fmt, parseDecimal } from '../domain/units';
import { Card, Details, Field, Icon, NumInput, Segmented, QualityBadge } from './components';

const LEVELS = [
  { value: 'unk', label: 'Non so' }, { value: '1', label: 'Pieno' }, { value: '0.75', label: '3/4' },
  { value: '0.5', label: '1/2' }, { value: '0.25', label: '1/4' }, { value: '0.2', label: '< 1/4' }, { value: '0.1', label: 'Riserva' },
];

export function Onboarding() {
  const { onboard, startEmpty } = useStore();
  const [odo, setOdo] = useState(String(ANDREA_DEFAULTS.currentOdo));
  const [date, setDate] = useState(ANDREA_DEFAULTS.currentTs.slice(0, 10));
  const [deliv, setDeliv] = useState(String(ANDREA_DEFAULTS.deliveryLevel ?? 'unk'));
  const [now, setNow] = useState(String(ANDREA_DEFAULTS.currentLevel ?? 'unk'));
  const workTot = ANDREA_TRIPS.reduce((a, t) => a + t.km, 0);

  const go = async () => {
    const dl = deliv === 'unk' ? null : Number(deliv);
    const r = deliveryRange(dl, 40);
    await onboard(
      {
        currentOdo: parseDecimal(odo) ?? ANDREA_DEFAULTS.currentOdo,
        currentTs: `${date}T${date === ANDREA_DEFAULTS.currentTs.slice(0, 10) ? ANDREA_DEFAULTS.currentTs.slice(11) : '12:00'}`,
        deliveryLevel: dl,
        currentLevel: now === 'unk' ? null : Number(now),
      },
      { deliveryFuelMinL: r.min, deliveryFuelMaxL: r.max },
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
        <p className="small">Questi dati sono già precaricati, non devi reinserirli. Rifornimenti (tutti pieni completi):</p>
        <table className="tbl">
          <thead><tr><th>Data</th><th>Km</th><th>Litri</th><th>€</th><th>€/l</th><th>Carta</th></tr></thead>
          <tbody>
            <tr><td>30/09</td><td>1.220</td><td>32,34</td><td>64,00</td><td>1,979</td><td>pers.</td></tr>
            <tr><td>11/10</td><td>1.981</td><td>35,68</td><td>71,00</td><td>1,990</td><td>pers.</td></tr>
            <tr><td>23/10</td><td>2.752</td><td>39,03</td><td>77,67</td><td>1,990</td><td>UTA</td></tr>
          </tbody>
        </table>
        <Details summary={`${ANDREA_TRIPS.length} tragitti lavorativi, ${fmt.km(workTot)}`}>
          <table className="tbl">
            <tbody>
              {ANDREA_TRIPS.map((t) => <tr key={t.date}><td>{fmt.date(t.date)}</td><td>{t.purpose === 'trasferta' ? 'Trasferta (cliente)' : 'Casa-lavoro'}</td><td>{t.km} km</td></tr>)}
            </tbody>
          </table>
        </Details>
        <ul className="qual">
          <li><QualityBadge q="certo" /> date, contachilometri, litri, importi, pagamento, pieni completi, tragitti lavorativi</li>
          <li><QualityBadge q="stimato" /> benzina alla consegna (circa 1/4, un po' meno: 6–10 l), indicatore benzina attuale</li>
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
          <Segmented value={now} onChange={setNow} options={LEVELS.filter((l) => !['0.2', '0.1'].includes(l.value))} />
        </Field>
        <Field label="Benzina alla consegna" hint="Il carburante fornito con l'auto è considerato aziendale.">
          <Segmented value={deliv} onChange={setDeliv} options={LEVELS} />
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
