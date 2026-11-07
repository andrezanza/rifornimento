import { useState } from 'react';
import { cloudErrorMessage, useStore, type CloudState } from '../data/store';
import { fmt } from '../domain/units';
import { Badge, Card, Details, Field, Icon, toast } from './components';

export function cloudLabel(c: CloudState): { tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral'; text: string } {
  switch (c.status) {
    case 'synced': return { tone: 'ok', text: 'sincronizzato' };
    case 'pending': return { tone: 'info', text: 'in invio' };
    case 'syncing': return { tone: 'info', text: 'collegamento…' };
    case 'loading': return { tone: 'neutral', text: 'avvio…' };
    case 'error': return { tone: 'bad', text: 'errore' };
    case 'signed-out': return { tone: 'warn', text: 'non attivo' };
    default: return { tone: 'neutral', text: 'non configurato' };
  }
}

/** Pulsanti di accesso: Google e, in alternativa, email e password. */
export function SignIn({ cta = 'Accedi con Google' }: { cta?: string }) {
  const { signInGoogle, signInEmail, resetPassword } = useStore();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try { await f(); } catch (e) { alert(cloudErrorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <button className="btn btn-primary btn-block" disabled={busy} onClick={() => run(signInGoogle)} data-testid="cloud-google">
        <Icon name="cloud" /> {cta}
      </button>
      <Details summary="Accedi con email e password">
        <Field label="Email"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} name="cloudEmail" /></Field>
        <Field label="Password" hint="Almeno 6 caratteri."><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} name="cloudPassword" /></Field>
        <div className="row2">
          <button className="btn" disabled={busy || !email || !pw} onClick={() => run(() => signInEmail(email.trim(), pw, false))} data-testid="cloud-login">Accedi</button>
          <button className="btn" disabled={busy || !email || pw.length < 6} onClick={() => run(() => signInEmail(email.trim(), pw, true))} data-testid="cloud-register">Crea account</button>
        </div>
        <button className="linkbtn" disabled={!email} onClick={() => run(async () => { await resetPassword(email.trim()); toast('Email per reimpostare la password inviata'); })}>Password dimenticata</button>
      </Details>
    </>
  );
}

export function CloudCard() {
  const { cloud, cloudConfigured, signOut } = useStore();
  const l = cloudLabel(cloud);
  if (!cloudConfigured) {
    return (
      <Card title="Sincronizzazione cloud" actions={<Badge tone="neutral">non configurata</Badge>}>
        <p className="muted small">La copia automatica nel cloud non è ancora configurata in questa versione dell'app. Nel frattempo salva un backup su file dopo ogni rifornimento.</p>
      </Card>
    );
  }
  const on = cloud.status === 'synced' || cloud.status === 'pending' || cloud.status === 'syncing' || (cloud.status === 'error' && cloud.email !== undefined);
  return (
    <Card title="Sincronizzazione cloud" actions={<Badge tone={l.tone}>{l.text}</Badge>}>
      {on ? (
        <>
          <p className="small" data-testid="cloud-status">
            Collegato come <strong>{cloud.email ?? 'utente'}</strong>. Ogni modifica viene copiata automaticamente nel tuo spazio Firebase
            {cloud.status === 'pending' ? ' (in attesa di connessione: verrà inviata appena sei online)' : ''}.
            {cloud.lastSyncAt ? ` Ultima sincronizzazione: ${fmt.dateTime(cloud.lastSyncAt)}.` : ''}
          </p>
          {cloud.status === 'error' && <p className="small w-attenzione">{cloud.error}</p>}
          <p className="muted small">Se il telefono perde i dati o lo cambi, installa l'app, accedi con lo stesso account e ritrovi tutto. Su più dispositivi i dati restano allineati.</p>
          <button className="btn btn-sm" onClick={async () => { if (confirm('Disconnettere questo dispositivo? I dati restano sia qui sia nel cloud, ma le nuove modifiche non verranno più copiate.')) { await signOut(); toast('Disconnesso'); } }}>Disconnetti</button>
        </>
      ) : (
        <>
          <p className="small">Copia automatica e gratuita dei dati nel cloud: se il telefono li cancella, accedi di nuovo e li ritrovi. Solo tu puoi leggerli.</p>
          {cloud.status === 'error' && <p className="small w-attenzione">{cloud.error}</p>}
          {cloud.status === 'loading' ? <p className="muted small">Avvio…</p> : <SignIn />}
        </>
      )}
    </Card>
  );
}
