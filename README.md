# Sentinel · Supply Chain Intelligence Platform

**Real-time, multi-user Proactive Supply Chain Resilience System**

> AI-powered global supply chain disruption detection, cascade risk propagation, and prescriptive rerouting — powered by FastAPI, Gemini, NetworkX, and Firestore.

## 🏗️ Architecture

### Stack
- **Frontend:** Next.js 15 (App Router) on Vercel
- **Backend:** Python/FastAPI on Google Cloud Run
- **State Management:** Firebase Firestore (real-time sync via onSnapshot)
- **AI/Reasoning:** Gemini 1.5 Pro (zero-shot agent)
- **Graph Optimization:** NetworkX (Dijkstra + multi-objective weighting)
- **Data Sources:** NewsAPI, StormGlass (weather & market intelligence)

### Core Features
- **Dynamic Risk Scoring:** Gemini evaluates hub disruptions with localized data
- **Cascade Detection:** Propagates disruption effects 2°, 3°, n-degree
- **Multi-Objective Optimization:** Balances freight cost, SLA penalties, physical risk, carbon impact
- **Node Capacity Logic:** Exponential penalties when hubs exceed 80% throughput
- **Real-Time UI:** 3-column War Room with live terminal streaming
- **Prescriptive Rerouting:** Stochastic engine transforms alerts into intelligent recommendations

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local frontend development)
- Python 3.11+ (for local backend development)
- Gemini API key (optional for fallback mode)
- Firebase credentials (optional for Firestore, uses memory fallback)

### Setup

```bash
# 1. Clone repository
git clone https://github.com/itsZaid05/SUPPLY_CHAIN_AGENT
cd SUPPLY_CHAIN_AGENT

# 2. Configure environment
cp .env.example .env
cp backend/.env.example backend/.env

# Add your API keys to .env and backend/.env
# GEMINI_API_KEY=your-key-here
# FIREBASE_PROJECT_ID=your-project

# 3. Run with Docker Compose
docker-compose up
```

**Access:**
- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Local Development (No Docker)

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend:**
```bash
cd sentinel-supply-chain-v2
npm install
NEXT_PUBLIC_FASTAPI_BASE_URL=http://localhost:8000 npm run dev
```

## 📋 API Endpoints

### `/health` — Health Check
```bash
GET /health
```
Returns system status and version.

### `/analyze-route` — Hub Risk Analysis
```bash
POST /analyze-route
Content-Type: application/json

{
  "hubs": ["Shanghai", "Singapore", "Suez", "Rotterdam"],
  "current_route": ["Shanghai", "Singapore", "Suez", "Rotterdam"],
  "simulate_chaos": true,
  "chaos_hubs": ["Suez"],
  "chaos_severity": 0.75,
  "chaos_mode": "single"
}
```

**Response:**
```json
{
  "analysis_run_id": "uuid",
  "status": "ok",
  "analyses": [
    {
      "hub_name": "Suez",
      "risk_score": 0.82,
      "friction_coefficient": 2.1,
      "cascade_warnings": [...]
    }
  ],
  "compromised_hubs": ["Suez"],
  "cascade_warnings": [
    {
      "hub_name": "Rotterdam",
      "degree": 2,
      "propagated_risk": 0.35
    }
  ],
  "world_state": {...}
}
```

### `/get-prescriptive-path` — Route Optimization
```bash
POST /get-prescriptive-path
Content-Type: application/json

{
  "current_route": ["Shanghai", "Singapore", "Suez", "Rotterdam"],
  "hub_analyses": [...],
  "fuel_cost": 0.82,
  "delay_penalty": 14000,
  "carbon_cost": 5000,
  "cargo_type": "electronics",
  "container_count": 200
}
```

**Response:**
```json
{
  "analysis_run_id": "uuid",
  "path": ["Shanghai", "Singapore", "Dubai", "Rotterdam"],
  "shadow_route": {
    "nodes": [...],
    "comparison": {
      "time_saved_hours": 14.5,
      "cost_avoided_usd": 87500,
      "carbon_delta_percent": -12.3
    }
  },
  "world_state": {...}
}
```

### `/explain-reroute` — AI Explanation
```bash
POST /explain-reroute
Content-Type: application/json

{
  "current_route": [...],
  "shadow_route": [...],
  "comparison": {...},
  "compromised_hubs": [...]
}
```

## 🔧 Configuration

### Environment Variables

See `backend/.env.example` for complete configuration:

```bash
# Gemini API
GEMINI_API_KEY=your-api-key
GEMINI_MODEL=gemini-1.5-pro

# Firebase (optional)
FIREBASE_PROJECT_ID=your-project
FIREBASE_CREDENTIALS_PATH=./firebase-credentials.json

# Optimization weights
WEIGHT_FREIGHT_COST=0.25
WEIGHT_PENALTY_SLA=0.25
WEIGHT_RISK_PHYSICAL=0.35
WEIGHT_IMPACT_CARBON=0.15

# Node capacity
CAPACITY_THRESHOLD=0.80
EXPONENTIAL_PENALTY_FACTOR=2.5
```

## 📊 Cost Function

Multi-objective weighted path optimization:

```
W_e = (w₁ · CostFreight) + (w₂ · PenaltySLA) + (w₃ · RiskPhysical) + (w₄ · ImpactCarbon)

where:
  w₁ = 0.25 (freight cost weight)
  w₂ = 0.25 (SLA penalty weight)
  w₃ = 0.35 (physical risk weight)
  w₄ = 0.15 (carbon impact weight)
```

### Node Capacity Logic

When a hub exceeds 80% throughput:

```
capacity_penalty = base_weight × (2.5 ^ (congestion_factor - 0.80))
```

This prevents bottleneck formation by exponentially increasing adjacent edge weights.

## 🧪 Testing

### Run Backend Tests
```bash
cd backend
pytest tests/ -v
```

### Run Frontend Tests
```bash
cd sentinel-supply-chain-v2
npm run test
```

### Load Testing
```bash
cd backend
locust -f load_tests.py --host=http://localhost:8000
```

## 📈 Performance

- **Route Analysis:** ~2-3s per hub (with Gemini API)
- **Path Optimization:** <500ms (NetworkX Dijkstra on 9-hub graph)
- **Cascade Detection:** ~50ms (graph traversal)
- **UI Latency:** <100ms (Firestore real-time streaming)

## 🛡️ Graceful Degradation

All external services have fallback mechanisms:

- **Gemini unavailable?** → Uses deterministic fallback reasoning
- **Firebase unavailable?** → Switches to in-memory storage
- **NewsAPI/StormGlass unavailable?** → Uses mock data

## 📦 Deployment

### To Google Cloud Run

```bash
# Backend
gcloud run deploy sentinel-backend \
  --source backend/ \
  --platform managed \
  --region us-central1 \
  --set-env-vars GEMINI_API_KEY=$GEMINI_API_KEY

# Frontend (on Vercel)
vercel deploy
```

### To Docker Hub

```bash
docker build -t myregistry/sentinel-backend:latest backend/
docker push myregistry/sentinel-backend:latest
```

## 🔗 Global Shipping Hubs

- **Shanghai** (31.2°N, 121.5°E) - Origin
- **Singapore** (1.3°N, 103.8°E) - Regional hub
- **Suez** (30.0°N, 32.5°E) - Critical chokepoint
- **Rotterdam** (51.9°N, 4.5°E) - European gateway
- **Dubai** (25.2°N, 55.3°E) - Middle East hub
- **Hamburg** (53.6°N, 10.0°E) - Northern Europe
- **Mumbai** (18.9°N, 72.8°E) - South Asia
- **Colombo** (6.9°N, 79.9°E) - Indian Ocean
- **Cape Town** (-33.9°S, 18.4°E) - Southern route

## 📚 Documentation

- [Architecture Guide](./docs/architecture.md)
- [API Reference](./docs/api.md)
- [Deployment Guide](./docs/deployment.md)
- [Contributing](./CONTRIBUTING.md)

## 🤝 Contributing

Contributions welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.

## 🎯 Roadmap

- [ ] Real-time satellite imagery integration
- [ ] Port queue prediction ML model
- [ ] Multi-stakeholder consensus voting on reroutes
- [ ] Carbon credit tracking
- [ ] Blockchain transaction audit trail
- [ ] GraphQL API layer
- [ ] Mobile native apps (React Native)
- [ ] Advanced scenario simulation (Monte Carlo)

## 💬 Support

Questions? Open an issue or contact [@itsZaid05](https://github.com/itsZaid05).
