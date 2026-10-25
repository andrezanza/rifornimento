export function Methodology() {
  return (
    <div className="prose small">
      <p><strong>Metodo: contabilità progressiva con consumi misurati pieno-a-pieno e ripartizione chilometrica.</strong></p>
      <ol>
        <li><strong>Consumo reale.</strong> Tra due pieni completi i litri reintegrati sono esattamente la benzina consumata, qualunque sia stata la quota percorsa in elettrico. Così l'ibrido plug-in è gestito senza ipotizzare un consumo medio per km.</li>
        <li><strong>Quota lavorativa del tratto.</strong> w = km lavorativi ÷ km totali del tratto (dal contachilometri). I km personali non si registrano: sono la differenza.</li>
        <li><strong>Maturato lavorativo.</strong> Σ (benzina consumata nel tratto × w).</li>
        <li><strong>Saldo benzina (litri).</strong> Maturato lavorativo − litri pagati con carta aziendale − carburante iniziale fornito con l'auto. Positivo: credito stimato; negativo: l'azienda ha già pagato più del consumo lavorativo.</li>
        <li><strong>Incertezza.</strong> Dove la benzina nel serbatoio non è nota, il sistema usa un intervallo [minimo, massimo] ricavato da limiti fisici (capacità 40 l, spazio libero al momento di ogni rifornimento) e da un intervallo di consumo per km. Il criterio prudente decide sul limite inferiore.</li>
        <li><strong>Prossimo rifornimento.</strong> Il rifornimento previsto viene aggiunto in simulazione e tutto viene ricalcolato: la carta aziendale è compatibile se il saldo dopo l'operazione resta ≥ margine di sicurezza e l'importo rientra nel plafond residuo. Con un pieno il consumo del tratto diventa misurato, per cui una quota w dei litri reintegrati è già lavorativa.</li>
        <li><strong>Elettrico.</strong> Saldo separato in kWh: kWh ammissibili (pubblici; domestici solo se abilitato) × quota lavorativa − kWh pagati con UTA e+. Mai convertito in litri.</li>
        <li><strong>Euro.</strong> Il saldo è tenuto in litri (neutrale rispetto alle variazioni di prezzo); il controvalore in euro è indicativo, al prezzo dell'ultimo rifornimento.</li>
      </ol>
      <p><strong>Perché non altri metodi.</strong> La sola ripartizione proporzionale dei litri acquistati (A) ignora la benzina rimasta nel serbatoio e i km elettrici; una contabilità basata su consumi medi (19,3 km/l) crea crediti fittizi, perché in un PHEV il consumo per km dipende dalla quota elettrica. Il metodo adottato è l'ibrido C: contabilità progressiva (B) alimentata da consumi misurati.</p>
      <p><strong>Limiti.</strong> All'interno di un tratto i km lavorativi e personali hanno lo stesso consumo per km (in realtà un viaggio autostradale di lavoro può consumare più benzina di brevi tragitti personali in elettrico); il carburante alla consegna non è noto; i saldi tra un pieno e l'altro sono stime. Il risultato è una valutazione di calcolo, non un'autorizzazione aziendale.</p>
    </div>
  );
}
