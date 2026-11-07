// Collegamento a Firebase (Authentication + Firestore). Caricato solo se la sincronizzazione è
// configurata, in un file separato: chi non la usa non scarica nulla.
import { initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  browserPopupRedirectResolver, connectAuthEmulator, createUserWithEmailAndPassword, getRedirectResult, GoogleAuthProvider,
  indexedDBLocalPersistence, browserLocalPersistence, initializeAuth, onAuthStateChanged, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut as fbSignOut,
} from 'firebase/auth';
import {
  collection, connectFirestoreEmulator, doc, FieldPath, initializeFirestore, onSnapshot, persistentLocalCache,
  persistentMultipleTabManager, writeBatch,
} from 'firebase/firestore';
import { opsByDoc, remoteFromDocs, type PushOps, type RemoteData } from './sync';

export interface CloudUser { uid: string; email: string | null }
export interface SnapMeta { fromCache: boolean; pending: boolean }

export function createCloud(config: FirebaseOptions & { emulator?: string }) {
  const app = initializeApp(config);
  const auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });
  if (config.emulator) {
    const host = new URL(config.emulator);
    connectAuthEmulator(auth, `http://${host.hostname}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host.hostname, 8080);
  }
  getRedirectResult(auth).catch(() => { /* nessun accesso in sospeso */ });

  const col = (uid: string) => collection(db, 'users', uid, 'data');

  return {
    onAuth(cb: (u: CloudUser | null) => void) {
      return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email } : null));
    },
    async signInGoogle() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        const code = (e as { code?: string }).code ?? '';
        // popup bloccato o non supportato dall'app installata: si riprova con il reindirizzamento
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') await signInWithRedirect(auth, provider);
        else throw e;
      }
    },
    async signInEmail(email: string, password: string, create: boolean) {
      if (create) await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
    },
    resetPassword: (email: string) => sendPasswordResetEmail(auth, email),
    signOut: () => fbSignOut(auth),
    /** Ascolta i dati remoti dell'utente. */
    subscribe(uid: string, cb: (r: RemoteData, meta: SnapMeta) => void, onError: (e: Error) => void) {
      return onSnapshot(col(uid), { includeMetadataChanges: true }, (snap) => {
        cb(
          remoteFromDocs(snap.docs.map((d) => ({ id: d.id, data: d.data() }))),
          { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites },
        );
      }, onError);
    },
    /**
     * Invia le modifiche. Ogni registrazione e rettifica sostituisce per intero il proprio campo,
     * senza toccare gli altri. Offline, Firestore le conserva e le invia al ritorno della rete.
     */
    push(uid: string, ops: PushOps): Promise<void> {
      const batch = writeBatch(db);
      for (const [id, d] of opsByDoc(ops)) {
        const fields = [
          ...Object.keys(d.e).map((k) => new FieldPath('e', k)),
          ...Object.keys(d.a).map((k) => new FieldPath('a', k)),
        ];
        batch.set(doc(col(uid), id), d, { mergeFields: fields });
      }
      if (ops.settings) batch.set(doc(col(uid), 'settings'), { s: ops.settings });
      return batch.commit();
    },
  };
}

export type Cloud = ReturnType<typeof createCloud>;
