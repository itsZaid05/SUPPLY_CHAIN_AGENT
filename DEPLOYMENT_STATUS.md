# Deployment Status

**Date:** 2026-04-28  
**Project:** codemara-supply-chain-app

---

## Architecture

```
┌─────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│   Frontend      │────▶│   Backend (Cloud    │────▶│  Firestore       │
│   (Vercel)      │     │   Run)              │     │  (asia-southeast1)│
└─────────────────┘     └─────────────────────┘     └──────────────────┘
                                │
                                ▼
                         ┌──────────────────┐
                         │  Gemini API      │
                         │  (External)      │
                         └──────────────────┘
```

---

## Completed ✅

### 1. Firebase Setup Verification
- Project: `codemara-supply-chain-app`
- Firestore database: Created in Native mode at `asia-southeast1`
- Web app: "Sentinel" (ID: `1:646812836538:web:b8ce0678f3a4da72f7d883`)

### 2. Frontend Configuration
- Created `.env.local` with Firebase web config
- Created `vercel.json` for Vercel deployment
- Next.js build completes successfully

### 3. Firestore Rules Deployed
```bash
cd sentinel-supply-chain-v2
firebase deploy --only firestore:rules,firestore:indexes,remoteconfig
```
- `firestore.rules`: Read-only access to `worldState` collection
- `firestore.indexes.json`: Deployed successfully

---

## Remaining Tasks

### 1. Deploy Frontend to Vercel

**Option A: Vercel CLI**
```bash
cd sentinel-supply-chain-v2
npm install -g vercel
vercel login
vercel --prod
```

**Option B: Vercel Dashboard**
1. Go to https://vercel.com/new
2. Import your GitHub repo
3. Set root directory: `sentinel-supply-chain-v2`
4. Add environment variables (see below)
5. Deploy

**Environment Variables in Vercel Dashboard:**
```
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyA4J4rH0HSONiCKT7MDcBGCF0dgwVUPRGA
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=codemara-supply-chain-app.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=codemara-supply-chain-app
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=codemara-supply-chain-app.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=646812836538
NEXT_PUBLIC_FIREBASE_APP_ID=1:646812836538:web:b8ce0678f3a4da72f7d883
NEXT_PUBLIC_FIREBASE_WORLD_STATE_PATH=worldState/live
NEXT_PUBLIC_FASTAPI_BASE_URL=https://YOUR_CLOUD_RUN_URL
```

### 2. Deploy Backend to Cloud Run

Requires `gcloud` CLI installation:

```bash
gcloud run deploy sentinel-backend \
  --source backend \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars FIREBASE_PROJECT_ID=codemara-supply-chain-app,FIREBASE_WORLD_STATE_DOC_PATH=worldState/live,GEMINI_MODEL=gemini-1.5-pro
```

### 3. Secrets Configuration (Cloud Run)

Set these as Cloud Run secrets (not in repo):
- `GEMINI_API_KEY`
- `NEWSAPI_KEY` (optional)
- `STORMGLASS_KEY` (optional)

### 4. IAM Permissions

Grant Cloud Run service account:
- **Cloud Datastore User** (`roles/datastore.user`)

### 5. Update CORS

After frontend is deployed, update backend environment:
```env
CORS_ORIGINS=["https://YOUR_VERCEL_URL.vercel.app"]
```

### 6. Update Frontend Backend URL

After Cloud Run deployment, update Vercel environment variables:
```env
NEXT_PUBLIC_FASTAPI_BASE_URL=https://YOUR_CLOUD_RUN_URL
```

---

## Smoke Test Checklist

After all deployments:
- [ ] Frontend loads without errors
- [ ] Backend API responds at `/health`
- [ ] `/api/optimize` returns results
- [ ] Firestore `worldState/live` document updates
- [ ] No CORS errors in browser console
- [ ] No Firestore permission errors

---

## Reference

| File | Location | Purpose |
|------|----------|---------|
| `.env.local` | `sentinel-supply-chain-v2/` | Local dev env vars |
| `vercel.json` | `sentinel-supply-chain-v2/` | Vercel config |
| `firebase.json` | `sentinel-supply-chain-v2/` | Firestore/Remote config |
| `firestore.rules` | `sentinel-supply-chain-v2/` | Security rules |
| `backend/Dockerfile` | `backend/` | Cloud Run container |
