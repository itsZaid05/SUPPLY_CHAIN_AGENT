import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { doc, getFirestore } from "firebase/firestore";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
);

const firebaseApp = isFirebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const firestoreDb = firebaseApp ? getFirestore(firebaseApp) : null;

export function getWorldStateDocumentReference() {
  if (!firestoreDb) {
    return null;
  }

  const path = (process.env.NEXT_PUBLIC_FIREBASE_WORLD_STATE_PATH ?? "worldState/live")
    .split("/")
    .filter(Boolean);

  if (path.length < 2 || path.length % 2 !== 0) {
    return null;
  }

  const [firstSegment, secondSegment, ...rest] = path;
  return doc(firestoreDb, firstSegment, secondSegment, ...rest);
}
