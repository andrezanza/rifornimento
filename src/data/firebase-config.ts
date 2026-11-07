// Configurazione del progetto Firebase (piano gratuito Spark).
// Questi valori non sono segreti: identificano il progetto, e l'accesso ai dati è protetto
// dall'accesso con l'account e dalle regole di sicurezza di Firestore (vedi firestore.rules).
import type { FirebaseOptions } from 'firebase/app';

const EMULATOR = import.meta.env.VITE_FIREBASE_EMULATOR as string | undefined;

export const FIREBASE_CONFIG: (FirebaseOptions & { emulator?: string }) | null = EMULATOR
  ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-rifornimento', appId: 'demo', emulator: EMULATOR }
  : {
    apiKey: 'AIzaSyBnJQoe5y5XxuDTvFUmbMzDHSS2IjHRQJk',
    authDomain: 'rifornimento-4d0c1.firebaseapp.com',
    projectId: 'rifornimento-4d0c1',
    storageBucket: 'rifornimento-4d0c1.firebasestorage.app',
    messagingSenderId: '786414184381',
    appId: '1:786414184381:web:cd7c3d85c491ad354fd4d4',
  };
