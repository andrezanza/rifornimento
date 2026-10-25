import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useStore } from './data/store';
import type { FuelEntry } from './domain/types';
import { Dashboard } from './ui/Dashboard';
import { NewEntry, type EntryKind } from './ui/NewEntry';
import { Planner } from './ui/Planner';
import { History, type HistoryView } from './ui/History';
import { Settings } from './ui/Settings';
import { Onboarding } from './ui/Onboarding';
import { Report } from './ui/Report';
import { Icon, ToastHost } from './ui/components';

export type Tab = 'home' | 'new' | 'plan' | 'history' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Situazione', icon: 'home' },
  { id: 'new', label: 'Registra', icon: 'plus' },
  { id: 'plan', label: 'Rifornimento', icon: 'pump' },
  { id: 'history', label: 'Storico', icon: 'chart' },
  { id: 'settings', label: 'Impostazioni', icon: 'gear' },
];

const TITLES: Record<Tab, string> = {
  home: 'Situazione', new: 'Nuova registrazione', plan: 'Prossimo rifornimento', history: 'Storico e statistiche', settings: 'Impostazioni',
};

function readHash(): Tab {
  const h = location.hash.replace('#', '') as Tab;
  return TABS.some((t) => t.id === h) ? h : 'home';
}

export function App() {
  const { ready, state } = useStore();
  const [tab, setTab] = useState<Tab>(readHash);
  const [kind, setKind] = useState<EntryKind>('work');
  const [hview, setHview] = useState<HistoryView>('entries');
  const [section, setSection] = useState<string | undefined>();
  const [prefill, setPrefill] = useState<Partial<FuelEntry> | undefined>();
  const [report, setReport] = useState(false);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  useEffect(() => {
    const f = () => setTab(readHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [tab]);

  const go = (t: Tab, sub?: string) => {
    if (t === 'new' && sub) setKind(sub as EntryKind);
    if (t === 'history' && sub) setHview(sub as HistoryView);
    if (t === 'settings') setSection(sub);
    if (t !== 'new') setPrefill(undefined);
    if (location.hash !== '#' + t) location.hash = t;
    setTab(t);
  };

  if (!ready) return <div className="splash">Caricamento…</div>;
  if (!state.settings.onboarded) return <main className="main"><Onboarding /><ToastHost /></main>;
  if (report) return <main className="main wide"><Report onClose={() => setReport(false)} /></main>;

  return (
    <>
      <header className="top">
        <h1>{TITLES[tab]}</h1>
        <span className="top-sub">{state.settings.vehicleName}</span>
      </header>
      {needRefresh && (
        <div className="update">
          Nuova versione disponibile. I dati restano sul dispositivo.
          <button className="btn btn-sm btn-primary" onClick={() => updateServiceWorker(true)}>Aggiorna</button>
        </div>
      )}
      <main className="main">
        {tab === 'home' && <Dashboard go={go} />}
        {tab === 'new' && (
          <NewEntry kind={kind} setKind={(k) => { setKind(k); setPrefill(undefined); }} prefill={prefill} onDone={() => { setPrefill(undefined); go('home'); }} key={prefill ? 'pf' : 'n'} />
        )}
        {tab === 'plan' && <Planner onRecord={(p) => { setPrefill(p); setKind('fuel'); go('new'); setPrefill(p); }} />}
        {tab === 'history' && <History view={hview} setView={setHview} openReport={() => setReport(true)} />}
        {tab === 'settings' && <Settings section={section} />}
      </main>
      <nav className="nav">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <ToastHost />
    </>
  );
}
