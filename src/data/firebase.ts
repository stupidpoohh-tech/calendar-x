/**
 * Firebase 초기화.
 *
 * 이전에는 config 가 index.html 에 인라인으로 박혀 있어 dev/prod 를 나눌 수 없었다.
 * 여기서는 환경변수로 받고, 빠진 값이 있으면 조용히 실패하는 대신 무엇이 없는지 말한다.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence, connectAuthEmulator, getAuth,
  setPersistence, type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

interface FirebaseEnv {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const ENV_KEYS: Record<keyof FirebaseEnv, string> = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
};

function readEnv(): FirebaseEnv {
  const env = import.meta.env;
  const missing: string[] = [];
  const out = {} as FirebaseEnv;

  for (const [field, key] of Object.entries(ENV_KEYS) as [keyof FirebaseEnv, string][]) {
    const value = (env as unknown as Record<string, string | undefined>)[key];
    if (!value) missing.push(key);
    else out[field] = value;
  }

  if (missing.length > 0) {
    throw new Error(
      `Firebase 설정이 없습니다: ${missing.join(', ')}\n`
      + '.env.example 을 .env 로 복사해 값을 채우거나, 배포 환경의 환경변수를 설정하세요.',
    );
  }
  return out;
}

let cached: { app: FirebaseApp; auth: Auth; db: Firestore } | null = null;

export function getFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  if (cached) return cached;

  const app = initializeApp(readEnv());
  const auth = getAuth(app);

  /**
   * 오프라인 지속성. (F-08)
   * 이전 구조는 이것을 켜지 않아 네트워크가 끊기면 앱이 그대로 멈췄다.
   * 여러 탭을 동시에 열어도 캐시가 깨지지 않도록 multi-tab manager 를 쓴다.
   */
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });

  if (import.meta.env.VITE_USE_EMULATOR === '1') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }

  void setPersistence(auth, browserLocalPersistence).catch(() => {
    // 사파리 프라이빗 모드 등에서 실패할 수 있다. 세션 지속성으로 계속 동작한다.
  });

  cached = { app, auth, db };
  return cached;
}
