import { initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'

const env = import.meta.env
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

// `||`, not `??`: an empty `VITE_ALLOWED_EMAIL=` line must fall back to the owner too (it must match firestore.rules).
export const ALLOWED_EMAIL: string = env.VITE_ALLOWED_EMAIL || 'vlad.herasymovychh@gmail.com'

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId && !String(firebaseConfig.apiKey).includes('YOUR_'),
)

// Two of the values the Shortcut is built with (Settings → Siri & Apple Watch shows them to copy); '' while unconfigured,
// so that a placeholder such as YOUR_API_KEY is never offered for pasting.
export const firebaseProjectId: string = isFirebaseConfigured ? (firebaseConfig.projectId ?? '') : ''
export const firebaseApiKey: string = isFirebaseConfigured ? (firebaseConfig.apiKey ?? '') : ''

let app: FirebaseApp | null = null
let authInstance: Auth | null = null
let dbInstance: Firestore | null = null

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig)
  authInstance = getAuth(app)
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
  // Literal `import.meta.env.DEV` so Vite folds it to `false` and drops the emulator hookup from production bundles
  // (reading it through the `env` alias would only be checked at runtime and keep the 127.0.0.1 code shipped).
  if (import.meta.env.DEV && env.VITE_USE_EMULATORS === '1') {
    connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(dbInstance, '127.0.0.1', 8080)
  }
}

export const auth = authInstance as Auth
export const db = dbInstance as Firestore
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ login_hint: ALLOWED_EMAIL })
