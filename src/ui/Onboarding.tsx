import { useState } from 'react';
import { useStore } from '../data/store';
import { ANDREA_DEFAULTS } from '../domain/seed';
import { fmt, parseDecimal } from '../domain/units';
import { Card, Field, Icon, NumInput, Segmented, QualityBadge } from './components';

const LEVELS = [
  { value: 'unk', label: 'Non so' }, { value: '1', label: 'Pieno' }, { value: '0.75', label: '3/4' },
  { value: '0.5', label: '1/2' }, { value: '0.25', label: '1/4' }, { value: '0.1', label: 'Riserva' },
];

export function Onboarding() {
  const { onboard, startEmpty } = useStore();
  const [odo, setOdo] = useState(String(ANDREA_DEFAULTS.currentOdo));
  const [wMin, setWMin] = useState(String(ANDREA_DEFAULTS.workKmMin));
  const [wMax, setWMax] = useState(String(ANDREA_DEFAULTS.workKmMax));
  const [deliv, setDeliv] = useState('unk');
  const [now, setNow] = useState('unk');

  const go = async () => {
    const cap = 40;
    const dl = deliv === 'unk' ? null : Number(deliv);
    const tol = 0.0625;
    await onboard(
      {
        ...ANDREA_DEFAULTS,
        currentOdo: parseDecimal(odo) ?? ANDREA_DEFAULTS.currentOdo,
        workKmMin: parseDecimal(wMin) ?? ANDREA_DEFAULTS.workKmMin,
        workKmMax: parseDecimal(wMax) ?? ANDREA_DEFAULTS.workKmMax,
        deliveryLevel: dl,
        currentLevel: now === 'unk' ? null : Number(now),
      },
      dl == null
        ? { deliveryFuelMinL: 0, deliveryFuelMaxL: cap }
        : { deliveryFuelMinL: Math.max(0, (dl - tol) * cap), deliveryFuelMaxL: Math.min(cap, (dl + tol) * cap) },
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
        <p className="small">Questi dati sono già precaricati, non devi reinserirli:</p>
        <table className="tbl">
          <thead><tr><th>Data</th><th>Km</th><th>Litri</th><th>€</th><th>€/l</th><th>Carta</th></tr></thead>
          <tbody>
            <tr><td>30/09</td><td>1.220</td><td>32,34</td><td>64,00</td><td>1,979</td><td>pers.</td></tr>
            <tr><td>11/10</td><td>1.981</td><td>35,68</td><td>71,00</td><td>1,990</td><td>pers.</td></tr>
            <tr><td>23/10</td><td>2.752</td><td>39,03</td><td>77,67</td><td>1,990</td><td>UTA</td></tr>
          </tbody>
        </table>
        <ul className="qual">
          <li><QualityBadge q="certo" /> date, contachilometri, litri, importi, metodo di pagamento</li>
          <li><QualityBadge q="stimato" /> km lavorativi 1.650–1.660 dalla consegna (non ripartibili per mese)</li>
          <li><QualityBadge q="sconosciuto" /> benzina alla consegna e prima/dopo ogni rifornimento, ricariche domestiche</li>
          <li><QualityBadge q="provvisorio" /> plafond 500 €/mese, rinnovo il 1° del mese, comprensivo delle ricariche</li>
        </ul>
        <p className="muted small">I consumi medi del computer di bordo (19,3 km/l, 5,2 kWh/100 km) sono conservati solo come riferimento: su 2.910 km implicherebbero circa 151 l di benzina, mentre ne risultano acquistati 107 l più al massimo 40 l presenti alla consegna. Non vengono quindi usati come misura.</p>
      </Card>

      <Card title="Situazione attuale">
        <div className="row2">
          <Field label="Contachilometri oggi"><NumInput value={odo} onChange={setOdo} suffix="km" /></Field>
          <Field label="Km lavorativi dalla consegna"><div className="row2 tight"><NumInput value={wMin} onChange={setWMin} /><NumInput value={wMax} onChange={setWMax} /></div></Field>
        </div>
        <Field label="Benzina alla consegna (se la ricordi)" hint="È l'unico dato storico che cambia davvero il saldo: il carburante fornito con l'auto è considerato aziendale.">
          <Segmented value={deliv} onChange={setDeliv} options={LEVELS} />
        </Field>
        <Field label="Indicatore benzina adesso (facoltativo)">
          <Segmented value={now} onChange={setNow} options={LEVELS.filter((l) => l.value !== '0.1')} />
        </Field>
        <button className="btn btn-primary btn-block btn-lg" onClick={go} data-testid="onboard">
          <Icon name="check" /> Importa i dati e inizia
        </button>
        <p className="muted small">Consiglio: al prossimo rifornimento fai il <strong>pieno completo</strong> e segnalo come tale. Da lì i consumi diventano misurati e i calcoli più affidabili.</p>
      </Card>
      <button className="linkbtn center" onClick={() => startEmpty({})}>Inizia senza dati storici</button>
      <p className="muted small center">Contachilometri di riferimento: {fmt.km(2910)} al 23/10/2026.</p>
    </div>
  );
}
