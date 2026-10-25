import { useMemo, useState } from 'react';
import { useStore, describeEntry } from '../data/store';
import type { Entry } from '../domain/types';
import { fmt } from '../domain/units';
import { sortEntries, fuelAmountCents, fuelPriceMilli, chargePriceMilli } from '../domain/engine';
import { monthlyReport, plafondHistory } from '../domain/reports';
import { Badge, Card, Icon, RangeL, Segmented, Sheet, toast } from './components';
import { NewEntry, type EntryKind } from './NewEntry';
import { BandLine, GroupedBars } from './Charts';

export type HistoryView = 'entries' | 'months' | 'segments' | 'charts' | 'audit';

export function History({ view, setView, openReport }: { view: HistoryView; setView: (v: HistoryView) => void; openReport: () => void }) {
  return (
    <div className="stack">
      <div className="seg-scroll">
        <Segmented<HistoryView>
          value={view}
          onChange={setView}
          options={[
            { value: 'entries', label: 'Registrazioni' },
            { value: 'months', label: 'Mesi' },
            { value: 'charts', label: 'Grafici' },
            { value: 'segments', label: 'Calcoli' },
            { value: 'audit', label: 'Rettifiche' },
          ]}
        />
      </div>
      {view === 'entries' && <Entries />}
      {view === 'months' && <Months openReport={openReport} />}
      {view === 'charts' && <Charts />}
      {view === 'segments' && <Segments />}
      {view === 'audit' && <Audit />}
    </div>
  );
}

const TYPE_LABEL: Record<Entry['type'], string> = { fuel: 'Benzina', charge: 'Ricarica', work: 'Km lavoro', reading: 'Lettura' };
export const PURPOSE: Record<string, string> = { 'casa-lavoro': 'casa-lavoro', trasferta: 'trasferta', altro: 'altro' };
const TYPE_ICON: Record<Entry['type'], string> = { fuel: 'pump', charge: 'bolt', work: 'road', reading: 'gauge' };

function Entries() {
  const { state, remove } = useStore();
  const [filter, setFilter] = useState<'all' | Entry['type']>('all');
  const [editing, setEditing] = useState<Entry | null>(null);
  const list = useMemo(() => sortEntries(state.entries).reverse().filter((e) => filter === 'all' || e.type === filter), [state.entries, filter]);

  const del = async (e: Entry) => {
    if (!confirm(`Eliminare questa registrazione?\n\n${describeEntry(e)}\n\nI calcoli verranno ricalcolati e l'eliminazione resterà nel registro delle rettifiche.`)) return;
    await remove(e.id);
    toast('Registrazione eliminata');
  };

  return (
    <>
      <div className="chips">
        {(['all', 'fuel', 'work', 'charge', 'reading'] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{f === 'all' ? 'Tutte' : TYPE_LABEL[f]}</button>
        ))}
      </div>
      {list.length === 0 && <Card><p className="muted">Nessuna registrazione.</p></Card>}
      <ul className="list">
        {list.map((e) => (
          <li key={e.id} className="li">
            <span className={`li-ic t-${e.type}`}><Icon name={TYPE_ICON[e.type]} size={20} /></span>
            <div className="li-b">
              <div className="li-t">{line(e)}</div>
              <div className="li-s">
                {fmt.dateTime(e.ts)}
                {e.source === 'storico' && <Badge tone="info">storico</Badge>}
                {e.type === 'fuel' && e.litersEstimated && <Badge tone="info">litri stimati</Badge>}
                {e.type === 'fuel' && <Badge tone={e.payment === 'company' ? 'warn' : 'neutral'}>{e.payment === 'company' ? 'aziendale' : 'personale'}</Badge>}
                {e.type === 'charge' && e.estimated && <Badge tone="info">stimata</Badge>}
                {e.type === 'work' && e.kmMax != null && <Badge tone="info">stimato</Badge>}
                {e.updatedAt !== e.createdAt && <Badge tone="neutral">rettificata</Badge>}
              </div>
              {e.note && <div className="li-n">{e.note}</div>}
            </div>
            <div className="li-a">
              <button className="icon-btn" aria-label="Modifica" onClick={() => setEditing(e)}><Icon name="edit" size={18} /></button>
              <button className="icon-btn" aria-label="Elimina" onClick={() => del(e)}><Icon name="trash" size={18} /></button>
            </div>
          </li>
        ))}
      </ul>
      {editing && (
        <Sheet title="Modifica registrazione" onClose={() => setEditing(null)}>
          <NewEntry kind={editing.type as EntryKind} setKind={() => {}} initial={editing} onDone={() => setEditing(null)} />
        </Sheet>
      )}
    </>
  );
}

function line(e: Entry): string {
  switch (e.type) {
    case 'fuel': {
      const a = fuelAmountCents(e);
      return `${fmt.liters(e.litersCl)} · ${a == null ? 'importo mancante' : fmt.eur(a)} · ${fmt.price(fuelPriceMilli(e))} · ${fmt.km(e.odo)}${e.full ? ' · pieno' : e.full === false ? ' · parziale' : ''}`;
    }
    case 'charge':
      return `${e.kind === 'home' ? 'Domestica' : 'Pubblica'} · ${e.energyWh != null ? fmt.kwh(e.energyWh) : 'kWh n.d.'}${e.amountCents != null ? ` · ${fmt.eur(e.amountCents)}` : ''}${chargePriceMilli(e) ? ` · ${fmt.priceKwh(chargePriceMilli(e))}` : ''}${e.sessions ? ` · ${e.sessions} ricariche` : ''}`;
    case 'work':
      return `${e.kmMax != null ? `${e.km}–${e.kmMax}` : e.km} km lavorativi${e.purpose ? ` · ${PURPOSE[e.purpose]}` : ''}${e.tsFrom ? ` dal ${fmt.date(e.tsFrom)}` : ''}${e.odo != null ? ` · contachilometri ${fmt.km(e.odo)}` : ''}`;
    case 'reading':
      return `Contachilometri ${fmt.km(e.odo)}${e.fuelLevel != null ? ` · serbatoio ${Math.round(e.fuelLevel * 8)}/8` : ''}${e.tripAvgL100 != null ? ` · ${fmt.num(e.tripAvgL100)} l/100 km` : ''}`;
  }
}

function Months({ openReport }: { openReport: () => void }) {
  const { state } = useStore();
  const { rows, aggregates } = useMemo(() => monthlyReport(state), [state]);
  const plaf = useMemo(() => plafondHistory(state), [state]);
  return (
    <>
      <button className="btn btn-block" onClick={openReport}><Icon name="file" /> Riepilogo documentabile (stampa / PDF)</button>
      {[...rows].reverse().map((r) => {
        const tot = r.fuelPersonalCents + r.fuelCompanyCents + r.publicPersonalCents + r.publicCompanyCents;
        return (
          <Card key={r.month} title={<span className="cap">{fmt.month(r.month)}</span>} actions={<strong>{fmt.eur(tot)}</strong>}>
            <table className="tbl">
              <thead><tr><th></th><th>Personale</th><th>Aziendale</th></tr></thead>
              <tbody>
                <tr><td>Benzina €</td><td>{fmt.eur(r.fuelPersonalCents)}</td><td>{fmt.eur(r.fuelCompanyCents)}</td></tr>
                <tr><td>Benzina litri</td><td>{fmt.liters(r.fuelPersonalCl)}</td><td>{fmt.liters(r.fuelCompanyCl)}</td></tr>
                <tr><td>Ricariche pubbliche</td><td>{fmt.eur(r.publicPersonalCents)}</td><td>{fmt.eur(r.publicCompanyCents)}</td></tr>
              </tbody>
            </table>
            <div className="kv"><span className="kv-k">Rifornimenti</span><span className="kv-v">{r.fuelCount}{r.fuelMissingAmount ? ` (${r.fuelMissingAmount} senza importo)` : ''}</span></div>
            <div className="kv"><span className="kv-k">Ricariche domestiche</span><span className="kv-v">{fmt.kwh(r.homeWh)}</span></div>
            <div className="kv"><span className="kv-k">Km totali</span><span className="kv-v">{r.kmTotal == null ? 'n.d.' : `${fmt.km(r.kmTotal)}${r.kmEstimated ? ' (stima da contachilometri)' : ''}`}</span></div>
            <div className="kv"><span className="kv-k">Km lavorativi attribuiti al mese</span><span className="kv-v">{r.workKm === r.workKmMax ? fmt.km(r.workKm) : `${r.workKm}–${r.workKmMax} km`}</span></div>
          </Card>
        );
      })}
      {aggregates.length > 0 && (
        <Card title="Km lavorativi non ripartibili per mese">
          {aggregates.map((a) => (
            <p key={a.entry.id} className="small">
              {fmt.date(a.from)} – {fmt.date(a.to)}: <strong>{a.entry.kmMax != null ? `${a.entry.km}–${a.entry.kmMax}` : a.entry.km} km</strong>. {a.entry.note}
            </p>
          ))}
        </Card>
      )}
      <Card title="Spese aziendali per periodo di plafond" actions={!state.settings.plafondVerified ? <Badge tone="warn">provvisorio</Badge> : undefined}>
        {plaf.length === 0 && <p className="muted small">Nessuna spesa aziendale.</p>}
        <table className="tbl">
          <tbody>
            {plaf.map((p) => (
              <tr key={p.start}><td>{fmt.date(p.start)} → {fmt.date(p.end)}</td><td>{fmt.eur(p.fuelCents + (state.settings.plafondIncludesCharging ? p.chargeCents : 0))}</td><td>di {fmt.eur(state.settings.plafondCents)}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Charts() {
  const { state, result } = useStore();
  const { rows, aggregates } = useMemo(() => monthlyReport(state), [state]);
  // mesi coperti da km lavorativi aggregati: la ripartizione mensile non è nota e non viene mostrata
  const covered = (m: string) => aggregates.some((a) => a.from.slice(0, 7) <= m && m <= a.to.slice(0, 7));
  const short = (m: string) => new Date(m + '-01T12:00').toLocaleDateString('it-IT', { month: 'short' });
  const segs = [...result.segments, ...(result.open ? [result.open] : [])];
  return (
    <>
      <Card title="Spese benzina e ricariche per mese">
        <GroupedBars
          series={['Personale', 'Aziendale']}
          unit="€"
          data={rows.map((r) => {
            const p = (r.fuelPersonalCents + r.publicPersonalCents) / 100, c = (r.fuelCompanyCents + r.publicCompanyCents) / 100;
            return { label: short(r.month), values: [p, c], tip: `${fmt.month(r.month)}: personale ${fmt.eurF(p)}, aziendale ${fmt.eurF(c)}` };
          })}
        />
      </Card>
      <Card title="Saldo benzina progressivo (litri)">
        <BandLine
          unit="l"
          data={segs.map((sg) => ({
            label: sg.endKind === 'aperto' ? 'oggi' : fmt.date(sg.endTs).slice(0, 5),
            lo: sg.balanceAfter.lo, mid: sg.balanceAfter.mid, hi: sg.balanceAfter.hi,
            tip: `${sg.endKind === 'aperto' ? 'Oggi' : fmt.date(sg.endTs)}: ${fmt.signedL(sg.balanceAfter.mid)} (da ${fmt.num(sg.balanceAfter.lo)} a ${fmt.num(sg.balanceAfter.hi)} l)`,
          }))}
        />
      </Card>
      <Card title="Consumo per tratto (l/100 km)">
        <GroupedBars
          series={['Consumo stimato/misurato']}
          unit="l/100 km"
          data={segs.filter((s) => s.rateL100).map((sg) => ({
            label: `${Math.round(sg.endOdo / 100) / 10}k`,
            values: [sg.rateL100!.mid],
            tip: `${fmt.km(sg.startOdo)}→${fmt.km(sg.endOdo)}: ${fmt.num(sg.rateL100!.mid, 2)} l/100 km (${sg.measured ? 'misurato' : 'stimato'}), quota lavoro ${fmt.pct(sg.workShare.mid)}`,
          }))}
        />
      </Card>
      <Card title="Km lavorativi e personali per mese">
        <GroupedBars
          series={['Lavorativi', 'Personali']}
          unit="km"
          data={rows.filter((r) => r.kmTotal != null && !covered(r.month)).map((r) => ({
            label: short(r.month),
            values: [r.workKm, Math.max(0, (r.kmTotal ?? 0) - r.workKm)],
            tip: `${fmt.month(r.month)}: ${fmt.km(r.kmTotal ?? 0)} totali, ${fmt.km(r.workKm)} lavorativi attribuiti al mese`,
          }))}
        />
        {rows.some((r) => covered(r.month)) && <p className="muted small">I mesi coperti dalla stima storica aggregata ({aggregates.map((a) => `${fmt.date(a.from)}–${fmt.date(a.to)}`).join(', ')}) non sono mostrati: i km lavorativi non sono ripartibili per mese.</p>}
      </Card>
    </>
  );
}

function Segments() {
  const { result: r } = useStore();
  const segs = [...r.segments, ...(r.open ? [r.open] : [])];
  return (
    <>
      <Card title="Come leggere">
        <p className="small">Ogni tratto va da un punto in cui la benzina nel serbatoio è nota (inizio, pieno completo, lettura dell'indicatore) al successivo. Il consumo del tratto è <em>scorta iniziale + litri acquistati − scorta finale</em>; la quota lavorativa è <em>km lavorativi / km del tratto</em>. Con due pieni consecutivi il consumo è misurato; altrimenti è un intervallo.</p>
        <p className="small">Inizio contabilità: {fmt.dateTime(r.start.ts)} a {fmt.km(r.start.odo)} ({r.start.mode === 'include' ? 'storico incluso' : 'ripartenza alla data di riferimento'}).</p>
      </Card>
      {segs.map((sg) => (
        <Card key={sg.index} title={`Tratto ${sg.index + 1}: ${fmt.km(sg.startOdo)} → ${fmt.km(sg.endOdo)}`} actions={<Badge tone={sg.measured ? 'ok' : sg.endKind === 'aperto' ? 'info' : 'warn'}>{sg.measured ? 'misurato' : sg.endKind === 'aperto' ? 'in corso' : 'stimato'}</Badge>}>
          <div className="kv"><span className="kv-k">Periodo</span><span className="kv-v">{fmt.date(sg.startTs)} – {sg.endKind === 'aperto' ? 'oggi' : fmt.date(sg.endTs)} · {fmt.km(sg.km)}</span></div>
          <div className="kv"><span className="kv-k">Scorta iniziale → finale</span><span className="kv-v"><RangeL r={sg.stockStart} /> → <RangeL r={sg.stockEnd} /></span></div>
          <div className="kv"><span className="kv-k">Litri acquistati (di cui aziendali)</span><span className="kv-v">{fmt.l(sg.purchasedL, 2)} ({fmt.l(sg.companyL, 2)})</span></div>
          {sg.supplyL.hi > 0 && <div className="kv"><span className="kv-k">Carburante iniziale fornito dall'azienda</span><span className="kv-v"><RangeL r={sg.supplyL} /></span></div>}
          <div className="kv"><span className="kv-k">Benzina consumata</span><span className="kv-v"><RangeL r={sg.consumedL} /></span></div>
          <div className="kv"><span className="kv-k">Km lavorativi / quota</span><span className="kv-v">{sg.workKm.hi - sg.workKm.lo > 0.5 ? `${sg.workKm.lo}–${sg.workKm.hi}` : fmt.num(sg.workKm.mid, 0)} km · {fmt.pct(sg.workShare.mid)}</span></div>
          <div className="kv"><span className="kv-k">Litri attribuiti al lavoro</span><span className="kv-v"><RangeL r={sg.workL} /></span></div>
          <div className="kv"><span className="kv-k">Effetto sul saldo</span><span className="kv-v"><RangeL r={sg.balanceDelta} signed /></span></div>
          <div className="kv"><span className="kv-k">Saldo progressivo</span><span className="kv-v"><strong><RangeL r={sg.balanceAfter} signed /></strong></span></div>
          {sg.rateL100 && <div className="kv"><span className="kv-k">Consumo</span><span className="kv-v">{fmt.num(sg.rateL100.mid, 2)} l/100 km{sg.rateL100.mid > 0 ? ` (${fmt.num(100 / sg.rateL100.mid, 1)} km/l)` : ''}</span></div>}
        </Card>
      ))}
      <Card title="Stima del consumo per km">
        <p className="small">{fmt.num(r.rate.mid * 100, 2)} l/100 km (intervallo {fmt.num(r.rate.lo * 100, 1)}–{fmt.num(r.rate.hi * 100, 1)}), fonte: {r.rate.source}{r.rate.samples ? `, ${r.rate.samples} tratti misurati` : ''}. Usata solo per i tratti non ancora chiusi da un pieno.</p>
      </Card>
    </>
  );
}

function Audit() {
  const { state } = useStore();
  return (
    <Card title="Registro delle rettifiche">
      <p className="muted small">Ogni inserimento, modifica, eliminazione e cambio di impostazioni è annotato con data e ora. Le modifiche conservano il valore precedente.</p>
      <ul className="audit">
        {state.audit.slice(0, 300).map((a, i) => (
          <li key={i}>
            <span className="muted small">{fmt.dateTime(a.at)}</span> <Badge tone={a.action === 'delete' ? 'bad' : a.action === 'update' ? 'warn' : 'neutral'}>{a.action}</Badge>
            <div>{a.summary}</div>
            {a.action === 'update' && a.before != null && <div className="muted small">Prima: {describeEntry(a.before as Entry)}</div>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
