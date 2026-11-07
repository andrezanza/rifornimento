// Configurazione del progetto Firebase (piano gratuito Spark).
// Questi valori non sono segreti: identificano il progetto, e l'accesso ai dati è protetto
// dall'accesso con l'account e dalle regole di sicurezza di Firestore (vedi firestore.rules).
// null = sincronizzazione non ancora configurata: l'app funziona solo in locale.
import type { FirebaseOptions } from 'firebase/app';

const EMULATOR = import.meta.env.VITE_FIREBASE_EMULATOR as string | undefined;

export const FIREBASE_CONFIG: (FirebaseOptions & { emulator?: string }) | null = EMULATOR
  ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-rifornimento', appId: 'demo', emulator: EMULATOR }
  : null;
