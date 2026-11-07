import { Component, type ReactNode } from 'react';
import { loadState } from '../data/storage';
import { makeBackup } from '../domain/reports';
import { nowLocalIso } from '../domain/units';
import { downloadFile, stampName } from './download';

/** Se una schermata va in errore, l'app non resta bianca e permette di mettere i dati al sicuro. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }

  private async saveBackup() {
    try {
      const s = await loadState();
      downloadFile(stampName('rifornimento-backup-emergenza', 'json'), JSON.stringify(makeBackup(s, nowLocalIso()), null, 1), 'application/json');
    } catch (e) {
      alert(`Impossibile leggere i dati: ${(e as Error).message}`);
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="main">
        <div className="card fatal" role="alert">
          <h2>Si è verificato un errore</h2>
          <p className="small">I dati salvati non sono stati toccati. Per sicurezza scarica una copia, poi ricarica l'app.</p>
          <p className="muted small">Dettaglio: {this.state.error.message}</p>
          <button className="btn btn-primary btn-block" onClick={() => this.saveBackup()} data-testid="emergency-backup">Scarica backup di emergenza</button>
          <button className="btn btn-block" onClick={() => location.reload()}>Ricarica l'app</button>
        </div>
      </main>
    );
  }
}
