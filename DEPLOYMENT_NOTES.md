# Deployment Notes

This repo has two runtime services:

- `sentinel-supply-chain-v2/`: Next.js frontend
- `backend/`: FastAPI backend for route analysis, optimization, Gemini, and Firestore writes

Firebase is used for Firestore realtime state. The FastAPI backend writes the live state document, and the browser listens to it.

## Recommended Production Shape

Use:

- Firebase App Hosting or Firebase framework-aware Hosting for the Next.js app
- Google Cloud Run for the FastAPI backend
- Cloud Firestore in Native mode
- Cloud Secret Manager for private API keys

## Required Frontend Environment

Set these for the frontend build/deploy:

```bash
NEXT_PUBLIC_FASTAPI_BASE_URL=https://YOUR_BACKEND_CLOUD_RUN_URL
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=YOUR_PROJECT.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_WORLD_STATE_PATH=worldState/live
```

`NEXT_PUBLIC_*` values are browser-visible and must be available at frontend build time.

## Required Backend Environment

Set these for Cloud Run:

```bash
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-1.5-pro
FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
FIREBASE_WORLD_STATE_DOC_PATH=worldState/live
CORS_ORIGINS=["https://YOUR_FRONTEND_DOMAIN"]
```

Optional:

```bash
NEWSAPI_KEY=...
STORMGLASS_KEY=...
```

Prefer a Cloud Run service account with Firestore permissions. Do not commit service-account JSON. For local development only, use `FIREBASE_CREDENTIALS_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON`.

## Firebase Deploy

From `sentinel-supply-chain-v2/`:

```bash
firebase deploy --only firestore,remoteconfig
```

For Firebase Hosting framework deploys, enable the frameworks experiment first:

```bash
firebase experiments:enable webframeworks
firebase deploy --only hosting
```

Firebase App Hosting is usually cleaner for this Next.js app because it builds and serves Next.js on Cloud Run behind Firebase-managed hosting.
