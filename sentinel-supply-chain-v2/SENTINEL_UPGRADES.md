# Sentinel v2.0 — Upgrade Guide

## What Changed (vs. Original CodeMara)

### 🔴 Critical Fixes
| File | Fix |
|---|---|
| `lib/routing-engine.ts` | `buildComparison()` now **computes dynamically** from actual Dijkstra path weights × penalty rates — no more 5 hardcoded constants |
| `services/routing_engine/main.py` | `/optimize` endpoint comparison matrix is also fully computed |

### 🗺 New: Live Leaflet Map (`components/map-panel.tsx`)
- Dark CartoDB basemap loaded dynamically (no npm install needed)
- Current route in **red dashed** lines, shadow route in **violet solid** with directional arrows
- Hub markers sized by risk score, colored by status (optimal/warning/critical)
- **Pulsing rings** on compromised and cascade-affected hubs
- Popup cards with AI reasoning log per hub
- Legend overlay + real-time status badges
- Toggle between Map and Terminal with a tab bar

### ⚡ New: Chaos Engine (`components/chaos-panel.tsx`)
- Select **any hub(s)** to disrupt (not just Suez)
- Severity slider: 10% → 100% (Minor → Catastrophic)
- **Storm cluster mode** auto-detected when 2+ hubs selected
- Cargo type selector (Electronics, Automotive, Chemicals, Bulk, Perishables, Luxury)
- Preset scenarios (Shanghai→Rotterdam Electronics, Mumbai→Rotterdam Chemicals, etc.)
- Container count slider — scales penalty multipliers

### 🌊 New: Cascading Risk Propagation (`main.py` → `compute_cascade_warnings()`)
- **First-order propagation**: Disrupted hub → 45% risk transfers to direct downstream
- **Second-order propagation**: First-order hubs → 35% further transfers
- Cascade warnings show in terminal feed with `CASCADE` source badge
- Map marks cascade hubs in **amber** (distinct from red critical hubs)
- Shadow route panel shows cascade chain summary

### 🤖 New: AI "Why This Route?" Panel (`components/shadow-route-panel.tsx`)
- Collapsible Gemini explanation panel on every shadow route
- Structured response: summary, risk avoided, time logic, cost logic
- Confidence score badge (0–100%)
- Alternatives considered listed
- Falls back gracefully when Gemini API unavailable

### 💰 New: ROI Hero Card
- Animated counter showing `$X penalty risk eliminated`
- ROI multiplier (return on rerouting cost)
- Time saved, old penalty, carbon delta — all computed live

### 📊 Dynamic Comparison Matrix
All 9 fields in `ComparisonMatrix` are now computed from:
- Actual Dijkstra path weights
- Leg ETA hours from blueprint data
- Risk scores × delay penalty rates × cargo multiplier
- Weather friction × carbon cost

### 🏗 Expanded Graph
Added 6 new hubs and 6 new edges:
- Mumbai, Colombo added to hub catalog
- New routes: Shanghai→Mumbai, Mumbai→Dubai, Mumbai→Colombo, Colombo→Singapore, Dubai→Rotterdam, Cape Town→Hamburg

### 🛡 Graceful Degradation
- NewsAPI unavailable → heuristic keyword model with `[FALLBACK]` badge
- StormGlass unavailable → baseline 5 m/s wind, 1 mm/h precip assumed
- Gemini unavailable → local fallback risk model + hardcoded explanation

## Setup

### Backend
```bash
cd services/routing_engine
pip install -r requirements.txt
cp ../../.env.example .env
# Fill in GEMINI_API_KEY, NEWSAPI_KEY, STORMGLASS_API_KEY (all optional — fallbacks active)
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
npm install
cp .env.example .env.local
# Set NEXT_PUBLIC_FASTAPI_BASE_URL=http://localhost:8000
npm run dev
```

## New API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/analyze-route` | Hub analysis with multi-hub chaos + cascade propagation |
| `POST` | `/get-prescriptive-path` | Dynamic Dijkstra rerouting with cargo-aware penalty |
| `POST` | `/explain-reroute` | Gemini explanation: summary + 3 bullets + confidence |
| `GET`  | `/hub-catalog` | All 9 hub coordinates |

## Judge-Proof Checklist
- ✅ Map with animated routes (Leaflet)
- ✅ Comparison matrix computed, not hardcoded
- ✅ Multi-hub chaos (any hub, any severity)
- ✅ Cascading downstream risk propagation
- ✅ AI explanation panel (Gemini structured prompt)
- ✅ ROI hero card with animated counter
- ✅ Graceful API fallback (yellow warning badge)
- ✅ Cargo-type penalty multipliers
- ✅ Scenario builder with preset scenarios
