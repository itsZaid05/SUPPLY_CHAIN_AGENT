from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
import networkx as nx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    firebase_admin = None
    credentials = None
    firestore = None


logger = logging.getLogger("resilient_manifest_backend")
logging.basicConfig(level=logging.INFO)


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class ShippingHub(CamelModel):
    name: str
    lat: float
    lon: float


class RiskInjection(CamelModel):
    from_node: str = Field(alias="fromNode")
    to_node: str = Field(alias="toNode")
    risk_score: Optional[float] = Field(default=None, alias="riskScore")
    weather_friction: Optional[float] = Field(default=None, alias="weatherFriction")
    reason: str


class CascadeWarning(CamelModel):
    hub_name: str = Field(alias="hubName")
    degree: int
    origin_disruption: str = Field(alias="originDisruption")
    propagated_risk: float = Field(alias="propagatedRisk")
    reason: str


class AnalyzeRouteRequest(CamelModel):
    hubs: List[str]
    current_route: List[str] = Field(alias="currentRoute")
    simulate_chaos: bool = Field(default=False, alias="simulateChaos")
    chaos_hub: Optional[str] = Field(default=None, alias="chaosHub")
    chaos_hubs: Optional[List[str]] = Field(default=None, alias="chaosHubs")
    chaos_severity: float = Field(default=0.9, alias="chaosSeverity")
    chaos_mode: str = Field(default="single", alias="chaosMode")


class HubRiskAnalysis(CamelModel):
    hub_name: str = Field(alias="hubName")
    lat: float
    lon: float
    risk_score: float = Field(alias="riskScore")
    friction_coefficient: float = Field(alias="frictionCoefficient")
    confidence: float
    congestion_factor: float = Field(alias="congestionFactor")
    is_cascade_affected: bool = Field(alias="isCascadeAffected")
    reasoning_log: str = Field(alias="reasoningLog")
    status: str
    news_summary: str = Field(alias="newsSummary")
    weather_summary: str = Field(alias="weatherSummary")
    analyzed_at: str = Field(alias="analyzedAt")
    source_errors: List[str] = Field(default_factory=list, alias="sourceErrors")
    cascade_from: Optional[str] = Field(default=None, alias="cascadeFrom")
    cascade_degree: int = Field(default=0, alias="cascadeDegree")


class WorldStateEvent(CamelModel):
    id: str
    source: str
    tone: str
    message: str
    created_at: str = Field(alias="createdAt")
    hub_name: Optional[str] = Field(default=None, alias="hubName")


class ComparisonMatrix(CamelModel):
    current_delay_hours: int = Field(alias="currentDelayHours")
    current_penalty_usd: int = Field(alias="currentPenaltyUsd")
    prescribed_delay_hours: int = Field(alias="prescribedDelayHours")
    prescribed_penalty_usd: int = Field(alias="prescribedPenaltyUsd")
    carbon_delta_percent: int = Field(alias="carbonDeltaPercent")
    current_transit_hours: int = Field(alias="currentTransitHours")
    prescribed_transit_hours: int = Field(alias="prescribedTransitHours")
    time_saved_hours: int = Field(alias="timeSavedHours")
    cost_avoided_usd: int = Field(alias="costAvoidedUsd")
    current_distance_nm: int = Field(default=0, alias="currentDistanceNm")
    prescribed_distance_nm: int = Field(default=0, alias="prescribedDistanceNm")
    roi_multiplier: float = Field(default=1.0, alias="roiMultiplier")


class ShadowLeg(CamelModel):
    id: str
    sequence: int
    origin: str
    destination: str
    mode: str
    vessel: str
    eta_hours: int = Field(alias="etaHours")
    risk_score: float = Field(alias="riskScore")
    health: str
    note: str


class ShadowRoute(CamelModel):
    id: str
    title: str
    status: str
    nodes: List[str]
    legs: List[ShadowLeg]
    total_weight: float = Field(alias="totalWeight")
    comparison: ComparisonMatrix


class PathSegment(CamelModel):
    from_node: str = Field(alias="fromNode")
    to_node: str = Field(alias="toNode")
    distance: float
    risk_score: float = Field(alias="riskScore")
    weather_friction: float = Field(alias="weatherFriction")
    weight: float


class WorldStateDocument(CamelModel):
    analysis_run_id: str = Field(alias="analysisRunId")
    status: str
    current_route: List[str] = Field(alias="currentRoute")
    compromised_hubs: List[str] = Field(default_factory=list, alias="compromisedHubs")
    cascade_warnings: List[CascadeWarning] = Field(default_factory=list, alias="cascadeWarnings")
    analyses: List[HubRiskAnalysis] = Field(default_factory=list)
    terminal_events: List[WorldStateEvent] = Field(default_factory=list, alias="terminalEvents")
    shadow_route: Optional[ShadowRoute] = Field(default=None, alias="shadowRoute")
    warnings: List[str] = Field(default_factory=list)
    last_updated_at: str = Field(alias="lastUpdatedAt")
    last_error: Optional[str] = Field(default=None, alias="lastError")


class AnalyzeRouteResponse(CamelModel):
    analysis_run_id: str = Field(alias="analysisRunId")
    status: str
    analyses: List[HubRiskAnalysis]
    compromised_hubs: List[str] = Field(alias="compromisedHubs")
    cascade_warnings: List[CascadeWarning] = Field(alias="cascadeWarnings")
    warnings: List[str]
    world_state: WorldStateDocument = Field(alias="worldState")


class OptimizeRequest(CamelModel):
    start_node: str = Field(alias="startNode")
    end_node: str = Field(alias="endNode")
    current_route: Optional[List[str]] = Field(default=None, alias="currentRoute")
    fuel_cost: float = Field(default=0.82, alias="fuelCost")
    delay_penalty: float = Field(default=14_000, alias="delayPenalty")
    carbon_cost: float = Field(default=5_000, alias="carbonCost")
    cargo_type: str = Field(default="bulk", alias="cargoType")
    container_count: int = Field(default=1, alias="containerCount")
    risk_injections: List[RiskInjection] = Field(default_factory=list, alias="riskInjections")


class OptimizeResponse(CamelModel):
    path: List[str]
    total_weight: float = Field(alias="totalWeight")
    segments: List[PathSegment]
    shadow_route: ShadowRoute = Field(alias="shadowRoute")


class PrescriptivePathRequest(CamelModel):
    analysis_run_id: Optional[str] = Field(default=None, alias="analysisRunId")
    current_route: List[str] = Field(alias="currentRoute")
    hub_analyses: List[HubRiskAnalysis] = Field(alias="hubAnalyses")
    fuel_cost: float = Field(default=0.82, alias="fuelCost")
    delay_penalty: float = Field(default=14_000, alias="delayPenalty")
    carbon_cost: float = Field(default=5_000, alias="carbonCost")
    cargo_type: str = Field(default="bulk", alias="cargoType")
    container_count: int = Field(default=1, alias="containerCount")
    origin: Optional[str] = Field(default=None)
    destination: Optional[str] = Field(default=None)


class PrescriptivePathResponse(CamelModel):
    analysis_run_id: str = Field(alias="analysisRunId")
    status: str
    current_route: List[str] = Field(alias="currentRoute")
    path: List[str]
    total_weight: float = Field(alias="totalWeight")
    segments: List[PathSegment]
    shadow_route: ShadowRoute = Field(alias="shadowRoute")
    current_transit_hours: int = Field(alias="currentTransitHours")
    prescribed_transit_hours: int = Field(alias="prescribedTransitHours")
    time_saved_hours: int = Field(alias="timeSavedHours")
    cost_avoided_usd: int = Field(alias="costAvoidedUsd")
    cascade_warnings: List[CascadeWarning] = Field(alias="cascadeWarnings")
    warnings: List[str]
    world_state: WorldStateDocument = Field(alias="worldState")


class ExplainRerouteRequest(CamelModel):
    current_route: List[str] = Field(alias="currentRoute")
    shadow_route: List[str] = Field(alias="shadowRoute")
    comparison: ComparisonMatrix
    compromised_hubs: List[str] = Field(alias="compromisedHubs")
    cascade_warnings: List[CascadeWarning] = Field(default_factory=list, alias="cascadeWarnings")


class RouteExplanation(CamelModel):
    summary: str
    risk_avoided: str = Field(alias="riskAvoided")
    time_saved_rationale: str = Field(alias="timeSavedRationale")
    cost_logic: str = Field(alias="costLogic")
    confidence_score: float = Field(alias="confidenceScore")
    alternatives_considered: List[str] = Field(alias="alternativesConsidered")


class ExplainRerouteResponse(CamelModel):
    explanation: RouteExplanation


# ─── Hub + Edge Catalog ───────────────────────────────────────────────────────

HUB_CATALOG: Dict[str, ShippingHub] = {
    "Shanghai": ShippingHub(name="Shanghai", lat=31.2304, lon=121.4737),
    "Singapore": ShippingHub(name="Singapore", lat=1.2644, lon=103.8200),
    "Suez": ShippingHub(name="Suez", lat=29.9668, lon=32.5498),
    "Rotterdam": ShippingHub(name="Rotterdam", lat=51.9244, lon=4.4777),
    "Cape Town": ShippingHub(name="Cape Town", lat=-33.9249, lon=18.4241),
    "Dubai": ShippingHub(name="Dubai", lat=25.2048, lon=55.2708),
    "Hamburg": ShippingHub(name="Hamburg", lat=53.5511, lon=9.9937),
    "Mumbai": ShippingHub(name="Mumbai", lat=18.9667, lon=72.8333),
    "Colombo": ShippingHub(name="Colombo", lat=6.9271, lon=79.8612),
}

EDGE_BLUEPRINTS = [
    ("Shanghai", "Singapore", {"distance": 2_400, "risk_score": 0.09, "weather_friction": 0.12}),
    ("Singapore", "Suez", {"distance": 8_400, "risk_score": 0.18, "weather_friction": 0.22}),
    ("Suez", "Rotterdam", {"distance": 6_200, "risk_score": 0.14, "weather_friction": 0.18}),
    ("Singapore", "Cape Town", {"distance": 9_700, "risk_score": 0.20, "weather_friction": 0.30}),
    ("Cape Town", "Rotterdam", {"distance": 6_900, "risk_score": 0.12, "weather_friction": 0.21}),
    ("Singapore", "Dubai", {"distance": 5_800, "risk_score": 0.11, "weather_friction": 0.10}),
    ("Dubai", "Suez", {"distance": 2_500, "risk_score": 0.16, "weather_friction": 0.10}),
    ("Rotterdam", "Hamburg", {"distance": 470, "risk_score": 0.05, "weather_friction": 0.08}),
    ("Shanghai", "Mumbai", {"distance": 4_800, "risk_score": 0.13, "weather_friction": 0.18}),
    ("Mumbai", "Dubai", {"distance": 1_900, "risk_score": 0.10, "weather_friction": 0.09}),
    ("Mumbai", "Colombo", {"distance": 1_100, "risk_score": 0.08, "weather_friction": 0.11}),
    ("Colombo", "Singapore", {"distance": 2_800, "risk_score": 0.10, "weather_friction": 0.14}),
    ("Dubai", "Rotterdam", {"distance": 8_100, "risk_score": 0.15, "weather_friction": 0.19}),
    ("Cape Town", "Hamburg", {"distance": 8_200, "risk_score": 0.14, "weather_friction": 0.24}),
]

# Cargo type penalty multipliers
CARGO_PENALTY_MULTIPLIERS: Dict[str, float] = {
    "electronics": 1.8,
    "automotive": 1.5,
    "chemicals": 2.0,
    "luxury": 2.2,
    "perishable": 2.5,
    "bulk": 0.8,
}

LEG_BLUEPRINTS: Dict[frozenset, Dict[str, Any]] = {
    frozenset(("Shanghai", "Singapore")): {"mode": "Ocean", "vessel": "MV Meridian", "etaHours": 28, "riskScore": 0.14, "health": "optimal", "note": "Origin containers sealed and transshipment berth confirmed."},
    frozenset(("Singapore", "Suez")): {"mode": "Ocean", "vessel": "MV Meridian", "etaHours": 86, "riskScore": 0.19, "health": "optimal", "note": "Canal entry window confirmed with standard congestion buffer."},
    frozenset(("Suez", "Rotterdam")): {"mode": "Ocean", "vessel": "MV Meridian", "etaHours": 104, "riskScore": 0.23, "health": "optimal", "note": "North Sea slot reservation held under current plan."},
    frozenset(("Singapore", "Cape Town")): {"mode": "Ocean", "vessel": "MV Nereid", "etaHours": 118, "riskScore": 0.32, "health": "warning", "note": "Southern corridor engaged to bypass Suez disruption cluster."},
    frozenset(("Cape Town", "Rotterdam")): {"mode": "Ocean", "vessel": "MV Atlas Relay", "etaHours": 96, "riskScore": 0.16, "health": "optimal", "note": "North Atlantic slot secured under prescribed alternate plan."},
    frozenset(("Singapore", "Dubai")): {"mode": "Ocean", "vessel": "MV Altair", "etaHours": 48, "riskScore": 0.12, "health": "optimal", "note": "Gulf feeder corridor is operating within nominal thresholds."},
    frozenset(("Dubai", "Suez")): {"mode": "Ocean", "vessel": "MV Altair", "etaHours": 38, "riskScore": 0.15, "health": "optimal", "note": "Arabian leg reserved as a secondary contingency lane."},
    frozenset(("Rotterdam", "Hamburg")): {"mode": "Port", "vessel": "Terminal Relay 07", "etaHours": 18, "riskScore": 0.07, "health": "optimal", "note": "Feeder berth remains available for inland discharge."},
    frozenset(("Shanghai", "Mumbai")): {"mode": "Ocean", "vessel": "MV Indus Star", "etaHours": 60, "riskScore": 0.13, "health": "optimal", "note": "Western India corridor nominal."},
    frozenset(("Mumbai", "Dubai")): {"mode": "Ocean", "vessel": "MV Indus Star", "etaHours": 28, "riskScore": 0.11, "health": "optimal", "note": "Arabian Sea leg confirmed."},
    frozenset(("Mumbai", "Colombo")): {"mode": "Ocean", "vessel": "MV Coral Bay", "etaHours": 18, "riskScore": 0.09, "health": "optimal", "note": "Short feeder leg confirmed."},
    frozenset(("Colombo", "Singapore")): {"mode": "Ocean", "vessel": "MV Coral Bay", "etaHours": 42, "riskScore": 0.11, "health": "optimal", "note": "Bay of Bengal crossing nominal."},
    frozenset(("Dubai", "Rotterdam")): {"mode": "Ocean", "vessel": "MV Persian Gulf Express", "etaHours": 168, "riskScore": 0.16, "health": "optimal", "note": "Long Cape of Good Hope bypass available."},
    frozenset(("Cape Town", "Hamburg")): {"mode": "Ocean", "vessel": "MV Cape Runner", "etaHours": 204, "riskScore": 0.15, "health": "optimal", "note": "Direct Northern Europe leg via Cape."},
}

DEFAULT_ROUTE = ["Shanghai", "Singapore", "Suez", "Rotterdam"]
OCEAN_SPEED_KT = 18.5

# ─── App ─────────────────────────────────────────────────────────────────────

app = FastAPI(title="Sentinel Supply Chain Intelligence Platform", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Utilities ────────────────────────────────────────────────────────────────

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clamp(value: float, floor: float, ceiling: float) -> float:
    return max(floor, min(value, ceiling))


def risk_to_health(risk_score: float) -> str:
    if risk_score >= 0.7:
        return "critical"
    if risk_score >= 0.4:
        return "warning"
    return "optimal"


def create_event(message: str, source: str = "system", tone: str = "info", hub_name: Optional[str] = None) -> WorldStateEvent:
    return WorldStateEvent(id=str(uuid.uuid4()), source=source, tone=tone, message=message, createdAt=utc_now_iso(), hubName=hub_name)


def extract_json_object(text: str) -> Dict[str, Any]:
    stripped = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", stripped, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def first_numeric(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        for preferred_key in ("sg", "noaa", "meto", "dwd"):
            if preferred_key in value and isinstance(value[preferred_key], (int, float)):
                return float(value[preferred_key])
        for nested_value in value.values():
            if isinstance(nested_value, (int, float)):
                return float(nested_value)
    return None


# ─── Firebase ─────────────────────────────────────────────────────────────────

def build_firestore_credentials():
    service_account_value = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    if credentials is None:
        return None
    if service_account_value:
        if os.path.exists(service_account_value):
            return credentials.Certificate(service_account_value)
        return credentials.Certificate(json.loads(service_account_value))
    return None


def get_firestore_client():
    if firebase_admin is None or firestore is None:
        return None
    try:
        if not firebase_admin._apps:
            firebase_credential = build_firestore_credentials()
            options = {}
            project_id = os.getenv("FIREBASE_PROJECT_ID")
            if project_id:
                options["projectId"] = project_id
            if firebase_credential is not None:
                firebase_admin.initialize_app(firebase_credential, options=options or None)
            else:
                firebase_admin.initialize_app(options=options or None)
        return firestore.client()
    except Exception as exc:
        logger.warning("Firestore initialization skipped: %s", exc)
        return None


def get_world_state_document_path() -> Optional[str]:
    document_path = os.getenv("FIREBASE_WORLD_STATE_DOC_PATH", "worldState/live").strip("/")
    if len(document_path.split("/")) % 2 != 0:
        return None
    return document_path


async def publish_world_state(world_state: WorldStateDocument) -> None:
    client = get_firestore_client()
    document_path = get_world_state_document_path()
    if client is None or document_path is None:
        return
    payload = world_state.model_dump(by_alias=True)
    await asyncio.to_thread(client.document(document_path).set, payload)


# ─── External Data ────────────────────────────────────────────────────────────

async def fetch_hub_news(hub_name: str) -> Dict[str, Any]:
    api_key = os.getenv("NEWSAPI_KEY")
    if not api_key:
        return {
            "raw": f"[FALLBACK] No live news for {hub_name}. Using worst-case disruption scenario.",
            "summary": f"NewsAPI not configured. Heuristic risk model engaged for {hub_name}.",
            "errors": ["NEWSAPI_KEY is not configured."],
            "fallback": True,
        }
    params = {
        "q": f'"{hub_name}" AND (logistics OR delay OR strike OR disruption OR port OR congestion)',
        "searchIn": "title,description,content",
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": 5,
        "from": (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat(),
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                "https://newsapi.org/v2/everything",
                params=params,
                headers={"X-Api-Key": api_key},
            )
        if response.status_code == 429:
            return {"raw": f"[RATE-LIMITED] NewsAPI for {hub_name}.", "summary": f"NewsAPI rate limit for {hub_name}.", "errors": ["NewsAPI rate limit."], "fallback": True}
        response.raise_for_status()
        articles = response.json().get("articles", [])
        if not articles:
            return {"raw": f"No disruption articles for {hub_name}.", "summary": f"No articles for {hub_name}.", "errors": [], "fallback": False}
        lines = [f"[{a.get('publishedAt','')}] {a.get('title','')}: {a.get('description','')}" for a in articles[:5]]
        raw = "\n".join(lines)
        return {"raw": raw, "summary": raw, "errors": [], "fallback": False}
    except Exception as exc:
        return {"raw": f"[ERROR] NewsAPI failed for {hub_name}: {exc}", "summary": f"News fetch failed for {hub_name}. Fallback risk model active.", "errors": [str(exc)], "fallback": True}


async def fetch_hub_weather(lat: float, lon: float) -> Dict[str, Any]:
    api_key = os.getenv("STORMGLASS_API_KEY")
    if not api_key:
        return {
            "raw": "[FALLBACK] StormGlass not configured. Using baseline weather model.",
            "summary": "StormGlass unavailable. Baseline conditions assumed.",
            "windSpeed": 5.0,
            "precipitation": 1.0,
            "waveHeight": 0.8,
            "errors": ["STORMGLASS_API_KEY is not configured."],
            "fallback": True,
        }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                "https://api.stormglass.io/v2/weather/point",
                params={"lat": lat, "lng": lon, "params": "windSpeed,precipitation,waveHeight", "source": "sg"},
                headers={"Authorization": api_key},
            )
        if response.status_code == 429:
            return {"raw": "[RATE-LIMITED] StormGlass.", "summary": "StormGlass rate limit.", "windSpeed": 5.0, "precipitation": 1.0, "waveHeight": 0.8, "errors": ["StormGlass rate limit."], "fallback": True}
        response.raise_for_status()
        payload = response.json()
        hour = (payload.get("hours") or [{}])[0]
        wind = first_numeric(hour.get("windSpeed")) or 0.0
        precip = first_numeric(hour.get("precipitation")) or 0.0
        wave = first_numeric(hour.get("waveHeight")) or 0.0
        summary = f"Wind {wind:.2f} m/s, precipitation {precip:.2f} mm/h, wave {wave:.2f} m at [{lat:.4f}, {lon:.4f}]."
        return {"raw": summary, "summary": summary, "windSpeed": wind, "precipitation": precip, "waveHeight": wave, "errors": [], "fallback": False}
    except Exception as exc:
        return {"raw": f"[ERROR] StormGlass failed: {exc}", "summary": "Weather fetch failed. Baseline model active.", "windSpeed": 5.0, "precipitation": 1.0, "waveHeight": 0.8, "errors": [str(exc)], "fallback": True}


def fallback_risk_model(news_data: str, weather_data: Dict[str, Any]) -> Dict[str, Any]:
    keyword_hits = len(re.findall(r"logistics|delay|strike|disruption|congestion|storm|wind|weather|queue|port|blockage|attack|sanction", news_data.lower()))
    wind = float(weather_data.get("windSpeed") or 0.0)
    precip = float(weather_data.get("precipitation") or 0.0)
    wave = float(weather_data.get("waveHeight") or 0.0)
    wind_factor = clamp(wind / 20.0, 0.0, 1.0)
    precip_factor = clamp(precip / 8.0, 0.0, 1.0)
    wave_factor = clamp(wave / 6.0, 0.0, 1.0)
    risk = clamp(0.12 + keyword_hits * 0.05 + wind_factor * 0.35 + precip_factor * 0.18 + wave_factor * 0.15, 0.05, 0.95)
    friction = clamp(0.08 + wind_factor * 0.50 + precip_factor * 0.22 + wave_factor * 0.20, 0.05, 1.2)
    reasoning = f"Heuristic model: {keyword_hits} disruption signals detected; wind {wind:.1f} m/s; precipitation {precip:.1f} mm/h; wave {wave:.1f} m."
    return {"risk_score": round(risk, 2), "friction_coefficient": round(friction, 2), "reasoning_log": reasoning}


async def process_risk_with_gemini(news_data: str, weather_data: str, weather_structured: Dict[str, Any]) -> Dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    model_name = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
    if not api_key:
        return fallback_risk_model(news_data, weather_structured)
    prompt = (
        "You are an expert logistics risk analyst at a global supply chain command center.\n"
        "Analyze the hub news and weather inputs below.\n"
        "Return ONLY a JSON object with exactly these keys:\n"
        '  "risk_score": number 0.0-1.0 (probability of significant operational disruption),\n'
        '  "friction_coefficient": number 0.0-1.5 (multiplicative delay/fuel penalty),\n'
        '  "reasoning_log": single concise sentence (max 60 words) summarizing the dominant risk.\n\n'
        f"News:\n{news_data[:2000]}\n\nWeather:\n{weather_data[:500]}\n"
    )
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent",
                params={"key": api_key},
                headers={"Content-Type": "application/json"},
                json={"contents": [{"parts": [{"text": prompt}]}]},
            )
        if response.status_code == 429:
            raise RuntimeError("Gemini rate limit.")
        response.raise_for_status()
        payload = response.json()
        text = payload.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        parsed = extract_json_object(text)
        return {
            "risk_score": round(clamp(float(parsed.get("risk_score", 0.2)), 0.0, 1.0), 2),
            "friction_coefficient": round(clamp(float(parsed.get("friction_coefficient", 0.1)), 0.0, 1.5), 2),
            "reasoning_log": str(parsed.get("reasoning_log", "Gemini analysis complete.")),
        }
    except Exception as exc:
        logger.warning("Gemini failed, using fallback: %s", exc)
        return fallback_risk_model(news_data, weather_structured)


async def generate_route_explanation(
    current_route: List[str],
    shadow_nodes: List[str],
    comparison: ComparisonMatrix,
    compromised_hubs: List[str],
    cascade_warnings: List[CascadeWarning],
) -> RouteExplanation:
    api_key = os.getenv("GEMINI_API_KEY")
    model_name = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

    cascade_text = ""
    if cascade_warnings:
        cascade_text = f"\nCascade warnings: {', '.join([f'{w.hub_name} (degree {w.degree}, risk {w.propagated_risk:.2f})' for w in cascade_warnings])}"

    prompt = (
        "You are a senior logistics strategist explaining a rerouting decision to C-suite executives.\n"
        f"Current route: {' → '.join(current_route)}\n"
        f"Recommended route: {' → '.join(shadow_nodes)}\n"
        f"Compromised hubs: {', '.join(compromised_hubs)}\n"
        f"Time saved: {comparison.time_saved_hours}h\n"
        f"Cost avoided: ${comparison.cost_avoided_usd:,}\n"
        f"Carbon delta: {comparison.carbon_delta_percent}%\n"
        f"{cascade_text}\n\n"
        "Return ONLY a JSON object with these keys:\n"
        '  "summary": 2-sentence executive summary of the rerouting decision,\n'
        '  "riskAvoided": 1 sentence on the specific operational risk eliminated,\n'
        '  "timeSavedRationale": 1 sentence explaining how the time saving was achieved,\n'
        '  "costLogic": 1 sentence on the financial logic (penalty avoidance, not route cost),\n'
        '  "confidenceScore": number 0.0-1.0 representing recommendation confidence,\n'
        '  "alternativesConsidered": array of 2-3 short strings naming other routes evaluated.\n'
    )

    fallback = RouteExplanation(
        summary=f"Rerouting from {' → '.join(current_route)} to {' → '.join(shadow_nodes)} avoids {len(compromised_hubs)} compromised hub(s). The prescribed corridor preserves cargo security and delivery commitments.",
        riskAvoided=f"Disruption at {', '.join(compromised_hubs)} carries cascading delay risk across downstream hubs, which this route bypasses entirely.",
        timeSavedRationale=f"Eliminating {comparison.current_delay_hours - comparison.prescribed_delay_hours}h of expected delay at compromised hubs yields a net {comparison.time_saved_hours}h improvement.",
        costLogic=f"Avoiding penalty exposure of ${comparison.cost_avoided_usd:,} by bypassing high-risk legs where delay premiums accrue above the 0.35 risk threshold.",
        confidenceScore=0.82,
        alternativesConsidered=["Via Dubai bypass", "Cape of Good Hope full diversion", "Current route with buffer"],
    )

    if not api_key:
        return fallback

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent",
                params={"key": api_key},
                headers={"Content-Type": "application/json"},
                json={"contents": [{"parts": [{"text": prompt}]}]},
            )
        response.raise_for_status()
        payload = response.json()
        text = payload.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        parsed = extract_json_object(text)
        return RouteExplanation(
            summary=str(parsed.get("summary", fallback.summary)),
            riskAvoided=str(parsed.get("riskAvoided", fallback.risk_avoided)),
            timeSavedRationale=str(parsed.get("timeSavedRationale", fallback.time_saved_rationale)),
            costLogic=str(parsed.get("costLogic", fallback.cost_logic)),
            confidenceScore=clamp(float(parsed.get("confidenceScore", 0.82)), 0.0, 1.0),
            alternativesConsidered=list(parsed.get("alternativesConsidered", fallback.alternatives_considered)),
        )
    except Exception as exc:
        logger.warning("Gemini explanation failed: %s", exc)
        return fallback


# ─── Cascade Propagation ──────────────────────────────────────────────────────

def compute_cascade_warnings(
    disrupted_hubs: List[str],
    disruption_risks: Dict[str, float],
    all_hubs: List[str],
    graph: nx.Graph,
) -> List[CascadeWarning]:
    """First and second-order cascade propagation through the active graph topology."""
    warnings: List[CascadeWarning] = []
    propagated: Dict[str, float] = {}

    for hub in disrupted_hubs:
        base_risk = disruption_risks.get(hub, 0.88)
        for downstream in graph.neighbors(hub):
            if downstream in disrupted_hubs:
                continue
            propagated_risk = round(base_risk * 0.45, 2)
            if downstream not in propagated or propagated[downstream] < propagated_risk:
                propagated[downstream] = propagated_risk
                warnings.append(CascadeWarning(
                    hubName=downstream,
                    degree=1,
                    originDisruption=hub,
                    propagatedRisk=propagated_risk,
                    reason=f"First-order cascade from {hub} disruption (risk {base_risk:.2f}) propagates {propagated_risk:.2f} to {downstream}.",
                ))

    for first_order_warning in [w for w in warnings if w.degree == 1]:
        second_risk = round(first_order_warning.propagated_risk * 0.35, 2)
        if second_risk < 0.12:
            continue
        for downstream in graph.neighbors(first_order_warning.hub_name):
            if downstream in disrupted_hubs or any(w.hub_name == downstream and w.degree <= 1 for w in warnings):
                continue
            if downstream not in propagated or propagated[downstream] < second_risk:
                propagated[downstream] = second_risk
                warnings.append(CascadeWarning(
                    hubName=downstream,
                    degree=2,
                    originDisruption=first_order_warning.origin_disruption,
                    propagatedRisk=second_risk,
                    reason=f"Second-order cascade via {first_order_warning.hub_name}: risk {second_risk:.2f} at {downstream}.",
                ))

    return warnings


# ─── Hub Analysis ─────────────────────────────────────────────────────────────

async def analyze_hub(
    hub_name: str,
    simulate_chaos: bool = False,
    chaos_hubs: Optional[List[str]] = None,
    chaos_severity: float = 0.9,
    cascade_risk_override: Optional[float] = None,
    cascade_from: Optional[str] = None,
    cascade_degree: int = 0,
) -> HubRiskAnalysis:
    if hub_name not in HUB_CATALOG:
        raise HTTPException(status_code=400, detail=f"Unknown hub '{hub_name}'.")

    hub = HUB_CATALOG[hub_name]
    news_result, weather_result = await asyncio.gather(
        fetch_hub_news(hub_name),
        fetch_hub_weather(hub.lat, hub.lon),
    )
    gemini_result = await process_risk_with_gemini(news_result["raw"], weather_result["raw"], weather_result)
    source_errors = [*news_result.get("errors", []), *weather_result.get("errors", [])]

    risk_score = float(gemini_result["risk_score"])
    friction = float(gemini_result["friction_coefficient"])
    reasoning_log = str(gemini_result["reasoning_log"])

    effective_chaos_hubs = chaos_hubs or []
    if simulate_chaos and hub_name in effective_chaos_hubs:
        risk_score = max(risk_score, chaos_severity)
        friction = max(friction, chaos_severity * 0.92)
        reasoning_log = f"{reasoning_log.rstrip('.')}; command-center simulation injects confirmed disruption at severity {chaos_severity:.2f}."

    if cascade_risk_override is not None:
        risk_score = max(risk_score, cascade_risk_override)
        friction = max(friction, cascade_risk_override * 0.7)
        reasoning_log = f"Cascade propagation from {cascade_from} elevates risk to {risk_score:.2f} at {hub_name}."

    confidence = clamp(
        0.94
        - (0.28 if news_result.get("fallback") else 0.0)
        - (0.30 if weather_result.get("fallback") else 0.0)
        - (0.08 if cascade_degree > 0 else 0.0),
        0.25,
        0.98,
    )
    congestion_factor = round(clamp(0.75 + risk_score * 0.55 + (0.1 if cascade_degree > 0 else 0), 0.60, 1.70), 2)

    return HubRiskAnalysis(
        hubName=hub_name,
        lat=hub.lat,
        lon=hub.lon,
        riskScore=round(clamp(risk_score, 0.0, 1.0), 2),
        frictionCoefficient=round(clamp(friction, 0.0, 1.5), 2),
        confidence=round(confidence, 2),
        congestionFactor=congestion_factor,
        isCascadeAffected=bool(cascade_degree > 0),
        reasoningLog=reasoning_log,
        status=risk_to_health(risk_score),
        newsSummary=news_result["summary"],
        weatherSummary=weather_result["summary"],
        analyzedAt=utc_now_iso(),
        sourceErrors=source_errors,
        cascadeFrom=cascade_from,
        cascadeDegree=cascade_degree,
    )


# ─── Graph & Routing ──────────────────────────────────────────────────────────

def compute_weight(distance: float, risk_score: float, weather_friction: float, fuel_cost: float, delay_penalty: float, carbon_cost: float) -> float:
    return distance * fuel_cost + risk_score * delay_penalty + weather_friction * carbon_cost


def build_graph(risk_injections: List[RiskInjection], fuel_cost: float, delay_penalty: float, carbon_cost: float) -> nx.Graph:
    graph = nx.Graph()
    for origin, destination, attrs in EDGE_BLUEPRINTS:
        graph.add_edge(origin, destination, **attrs)

    injection_map: Dict[frozenset, RiskInjection] = {frozenset((i.from_node, i.to_node)): i for i in risk_injections}

    for origin, destination in graph.edges:
        edge = graph[origin][destination]
        injection = injection_map.get(frozenset((origin, destination)))
        if injection:
            if injection.risk_score is not None:
                edge["risk_score"] = injection.risk_score
            if injection.weather_friction is not None:
                edge["weather_friction"] = injection.weather_friction
        edge["weight"] = round(compute_weight(edge["distance"], edge["risk_score"], edge["weather_friction"], fuel_cost, delay_penalty, carbon_cost), 2)

    return graph


def build_segments_for_path(graph: nx.Graph, path: List[str]) -> List[PathSegment]:
    segments = []
    for i in range(len(path) - 1):
        o, d = path[i], path[i + 1]
        edge = graph[o][d]
        segments.append(PathSegment(fromNode=o, toNode=d, distance=edge["distance"], riskScore=edge["risk_score"], weatherFriction=edge["weather_friction"], weight=edge["weight"]))
    return segments


def build_leg(origin: str, destination: str, sequence: int, risk_override: Optional[float] = None, note_override: Optional[str] = None) -> ShadowLeg:
    blueprint = LEG_BLUEPRINTS.get(frozenset((origin, destination)), {"mode": "Ocean", "vessel": "MV Atlas Relay", "etaHours": 72, "riskScore": 0.18, "health": "optimal", "note": "Alternate corridor reserved."})
    risk_score = round(risk_override if risk_override is not None else blueprint["riskScore"], 2)
    note = note_override or blueprint["note"]
    return ShadowLeg(id=f"shadow-leg-{sequence}", sequence=sequence, origin=origin, destination=destination, mode=blueprint["mode"], vessel=blueprint["vessel"], etaHours=int(blueprint["etaHours"]), riskScore=risk_score, health=risk_to_health(risk_score), note=note)


def route_transit_hours(route: List[str]) -> int:
    total = 0
    for i in range(len(route) - 1):
        bp = LEG_BLUEPRINTS.get(frozenset((route[i], route[i + 1])))
        if bp:
            total += int(bp.get("etaHours", 72))
            continue
        edge = next((attrs for o, d, attrs in EDGE_BLUEPRINTS if frozenset((o, d)) == frozenset((route[i], route[i + 1]))), None)
        distance_nm = edge["distance"] if edge else 4_000
        total += int(distance_nm / OCEAN_SPEED_KT)
    return total


def route_distance_nm(route: List[str]) -> int:
    total = 0
    for o, d, attrs in EDGE_BLUEPRINTS:
        for i in range(len(route) - 1):
            if frozenset((route[i], route[i + 1])) == frozenset((o, d)):
                total += attrs["distance"]
    return total


def calculate_comparison(
    current_route: List[str],
    current_segments: List[PathSegment],
    optimized_segments: List[PathSegment],
    delay_penalty: float,
    carbon_cost: float,
    cargo_type: str = "bulk",
    container_count: int = 1,
) -> ComparisonMatrix:
    cargo_multiplier = CARGO_PENALTY_MULTIPLIERS.get(cargo_type, 1.0)
    effective_penalty = delay_penalty * cargo_multiplier * max(1, container_count / 100)

    current_base_transit = route_transit_hours(current_route)
    current_delay_hours = int(round(sum(seg.risk_score * 42 for seg in current_segments if seg.risk_score >= 0.40)))
    prescribed_delay_hours = int(round(sum(seg.risk_score * 18 for seg in optimized_segments if seg.risk_score >= 0.40)))

    current_transit_hours = current_base_transit + current_delay_hours
    opt_route = [optimized_segments[0].from_node, *[s.to_node for s in optimized_segments]]
    prescribed_transit_hours = route_transit_hours(opt_route) + prescribed_delay_hours

    current_penalty_usd = int(round(sum(max(seg.risk_score - 0.35, 0) * effective_penalty for seg in current_segments)))
    prescribed_penalty_usd = int(round(sum(max(seg.risk_score - 0.35, 0) * effective_penalty for seg in optimized_segments)))

    current_carbon = sum(seg.weather_friction * carbon_cost for seg in current_segments)
    prescribed_carbon = sum(seg.weather_friction * carbon_cost for seg in optimized_segments)
    carbon_delta_percent = int(round(((prescribed_carbon - current_carbon) / current_carbon) * 100)) if current_carbon > 0 else 0

    time_saved_hours = max(current_transit_hours - prescribed_transit_hours, 0)
    cost_avoided_usd = max(current_penalty_usd - prescribed_penalty_usd, 0)

    current_dist = route_distance_nm(current_route)
    prescribed_dist = route_distance_nm(opt_route)
    roi = 1.0
    if cost_avoided_usd > 0:
        roi = round(
            (cost_avoided_usd + prescribed_penalty_usd) / max(prescribed_penalty_usd, cost_avoided_usd * 0.1, 1),
            1,
        )
        roi = min(roi, 99.0)

    return ComparisonMatrix(
        currentDelayHours=current_delay_hours,
        currentPenaltyUsd=current_penalty_usd,
        prescribedDelayHours=prescribed_delay_hours,
        prescribedPenaltyUsd=prescribed_penalty_usd,
        carbonDeltaPercent=carbon_delta_percent,
        currentTransitHours=current_transit_hours,
        prescribedTransitHours=prescribed_transit_hours,
        timeSavedHours=time_saved_hours,
        costAvoidedUsd=cost_avoided_usd,
        currentDistanceNm=current_dist,
        prescribedDistanceNm=prescribed_dist,
        roiMultiplier=roi,
    )


def run_shortest_path(start_node: str, end_node: str, graph: nx.Graph) -> Tuple[List[str], float]:
    if start_node not in graph or end_node not in graph:
        raise HTTPException(status_code=400, detail="Unknown start or end node.")
    try:
        path = nx.shortest_path(graph, source=start_node, target=end_node, weight="weight")
        total_weight = nx.path_weight(graph, path, weight="weight")
        return path, total_weight
    except nx.NetworkXNoPath as exc:
        raise HTTPException(status_code=404, detail="No route found.") from exc


def build_risk_injections_from_analyses(current_route: List[str], analyses: List[HubRiskAnalysis]) -> List[RiskInjection]:
    analysis_map = {a.hub_name: a for a in analyses if a.risk_score >= 0.40}
    injections: List[RiskInjection] = []

    for origin, destination, _ in EDGE_BLUEPRINTS:
        origin_analysis = analysis_map.get(origin)
        destination_analysis = analysis_map.get(destination)
        if not origin_analysis and not destination_analysis:
            continue
        dominant = max([analysis for analysis in [origin_analysis, destination_analysis] if analysis], key=lambda analysis: analysis.risk_score)
        injections.append(
            RiskInjection(
                fromNode=origin,
                toNode=destination,
                riskScore=dominant.risk_score,
                weatherFriction=dominant.friction_coefficient,
                reason=dominant.reasoning_log,
            )
        )
    return injections


def build_shadow_route_from_path(path: List[str], total_weight: float, comparison: ComparisonMatrix) -> ShadowRoute:
    legs = [build_leg(path[i], path[i + 1], i + 1) for i in range(len(path) - 1)]
    return ShadowRoute(id=f"shadow-{uuid.uuid4().hex[:12]}", title="Sentinel Prescribed Corridor", status="available", nodes=path, legs=legs, totalWeight=round(total_weight, 2), comparison=comparison)


def build_initial_world_state(current_route: List[str], analysis_run_id: str) -> WorldStateDocument:
    return WorldStateDocument(
        analysisRunId=analysis_run_id,
        status="analyzing",
        currentRoute=current_route,
        compromisedHubs=[],
        cascadeWarnings=[],
        analyses=[],
        terminalEvents=[create_event(f"Sentinel analysis run {analysis_run_id[:8]} armed for hubs: {', '.join(current_route)}.", source="system", tone="info")],
        shadowRoute=None,
        warnings=[],
        lastUpdatedAt=utc_now_iso(),
    )


def update_world_state(
    world_state: WorldStateDocument,
    *,
    status: Optional[str] = None,
    analyses: Optional[List[HubRiskAnalysis]] = None,
    compromised_hubs: Optional[List[str]] = None,
    cascade_warnings: Optional[List[CascadeWarning]] = None,
    append_events: Optional[List[WorldStateEvent]] = None,
    warnings: Optional[List[str]] = None,
    shadow_route: Optional[ShadowRoute] = None,
    last_error: Optional[str] = None,
) -> WorldStateDocument:
    return WorldStateDocument(
        analysisRunId=world_state.analysis_run_id,
        status=status or world_state.status,
        currentRoute=world_state.current_route,
        compromisedHubs=compromised_hubs if compromised_hubs is not None else world_state.compromised_hubs,
        cascadeWarnings=cascade_warnings if cascade_warnings is not None else (world_state.cascade_warnings or []),
        analyses=analyses if analyses is not None else world_state.analyses,
        terminalEvents=[*world_state.terminal_events, *(append_events or [])],
        shadowRoute=shadow_route if shadow_route is not None else world_state.shadow_route,
        warnings=warnings if warnings is not None else world_state.warnings,
        lastUpdatedAt=utc_now_iso(),
        lastError=last_error,
    )


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/")
def healthcheck():
    return {"status": "ready", "service": "sentinel-supply-chain-intelligence", "version": "2.0.0"}


@app.get("/hub-catalog")
def hub_catalog():
    return {"hubs": {name: {"name": h.name, "lat": h.lat, "lon": h.lon} for name, h in HUB_CATALOG.items()}}


@app.post("/analyze-route", response_model=AnalyzeRouteResponse)
async def analyze_route(request: AnalyzeRouteRequest) -> AnalyzeRouteResponse:
    hubs = request.hubs or request.current_route or DEFAULT_ROUTE
    analysis_run_id = str(uuid.uuid4())
    world_state = build_initial_world_state(request.current_route or DEFAULT_ROUTE, analysis_run_id)
    await publish_world_state(world_state)

    # Resolve effective chaos hubs (support both old chaosHub and new chaosHubs)
    effective_chaos_hubs: List[str] = []
    if request.simulate_chaos:
        if request.chaos_hubs:
            effective_chaos_hubs = request.chaos_hubs
        elif request.chaos_hub:
            effective_chaos_hubs = [request.chaos_hub]

    analyses: List[HubRiskAnalysis] = []
    warnings: List[str] = []

    for hub_name in hubs:
        analysis = await analyze_hub(hub_name, simulate_chaos=request.simulate_chaos, chaos_hubs=effective_chaos_hubs, chaos_severity=request.chaos_severity)
        analyses.append(analysis)
        warnings.extend(analysis.source_errors)
        tone = "critical" if analysis.status == "critical" else "warning" if analysis.status == "warning" else "info"
        events = [create_event(f"{analysis.hub_name}: {analysis.reasoning_log}", source="risk", tone=tone, hub_name=analysis.hub_name)]
        if analysis.source_errors:
            events.append(create_event(f"{analysis.hub_name}: fallback data active — {analysis.source_errors[0]}", source="system", tone="warning", hub_name=analysis.hub_name))

        compromised = [a.hub_name for a in analyses if a.status == "critical"]
        world_state = update_world_state(world_state, analyses=analyses, compromised_hubs=compromised, append_events=events, warnings=warnings)
        await publish_world_state(world_state)

    # Cascade propagation
    disrupted = [a.hub_name for a in analyses if a.status == "critical"]
    disruption_risks = {a.hub_name: a.risk_score for a in analyses if a.status == "critical"}
    cascade_graph = build_graph([], fuel_cost=0.82, delay_penalty=request.chaos_severity * 14_000, carbon_cost=5_000)
    cascade_warnings = compute_cascade_warnings(disrupted, disruption_risks, hubs, cascade_graph)

    if cascade_warnings:
        cascade_events = [
            create_event(w.reason, source="cascade", tone="warning", hub_name=w.hub_name)
            for w in cascade_warnings
        ]
        world_state = update_world_state(world_state, cascade_warnings=cascade_warnings, append_events=cascade_events)
        await publish_world_state(world_state)

    world_state = update_world_state(
        world_state,
        status="analysis_complete",
        compromised_hubs=disrupted,
        cascade_warnings=cascade_warnings,
        append_events=[create_event("Hub analysis complete. Prescriptive path ready to synthesize.", source="optimizer", tone="success")],
    )
    await publish_world_state(world_state)

    return AnalyzeRouteResponse(
        analysisRunId=analysis_run_id,
        status="degraded" if warnings else "ok",
        analyses=analyses,
        compromisedHubs=disrupted,
        cascadeWarnings=cascade_warnings,
        warnings=warnings,
        worldState=world_state,
    )


@app.post("/get-prescriptive-path", response_model=PrescriptivePathResponse)
async def get_prescriptive_path(request: PrescriptivePathRequest) -> PrescriptivePathResponse:
    analysis_run_id = request.analysis_run_id or str(uuid.uuid4())
    effective_origin = request.origin or request.current_route[0]
    effective_destination = request.destination or request.current_route[-1]
    cargo_type = request.cargo_type or "bulk"
    container_count = request.container_count or 1

    risk_injections = build_risk_injections_from_analyses(request.current_route, request.hub_analyses)
    graph = build_graph(risk_injections, request.fuel_cost, request.delay_penalty, request.carbon_cost)

    path, total_weight = run_shortest_path(effective_origin, effective_destination, graph)
    optimized_segments = build_segments_for_path(graph, path)
    current_segments = build_segments_for_path(graph, request.current_route)
    comparison = calculate_comparison(request.current_route, current_segments, optimized_segments, request.delay_penalty, request.carbon_cost, cargo_type, container_count)
    shadow_route = build_shadow_route_from_path(path, total_weight, comparison)

    # Recompute cascade warnings from provided hub analyses
    disrupted = [a.hub_name for a in request.hub_analyses if a.status == "critical"]
    disruption_risks = {a.hub_name: a.risk_score for a in request.hub_analyses if a.status == "critical"}
    cascade_warnings = compute_cascade_warnings(disrupted, disruption_risks, [a.hub_name for a in request.hub_analyses], graph)

    warnings = list({w for a in request.hub_analyses for w in a.source_errors})
    world_state = WorldStateDocument(
        analysisRunId=analysis_run_id,
        status="analysis_complete",
        currentRoute=request.current_route,
        compromisedHubs=disrupted,
        cascadeWarnings=cascade_warnings,
        analyses=request.hub_analyses,
        terminalEvents=[
            create_event(f"Prescribed corridor: {' → '.join(path)}.", source="optimizer", tone="success"),
            create_event(f"{comparison.time_saved_hours}h saved · ${comparison.cost_avoided_usd:,} penalty avoided · {comparison.carbon_delta_percent}% carbon delta.", source="dispatch", tone="success"),
        ],
        shadowRoute=shadow_route,
        warnings=warnings,
        lastUpdatedAt=utc_now_iso(),
    )
    await publish_world_state(world_state)

    return PrescriptivePathResponse(
        analysisRunId=analysis_run_id,
        status="degraded" if warnings else "ok",
        currentRoute=request.current_route,
        path=path,
        totalWeight=round(total_weight, 2),
        segments=optimized_segments,
        shadowRoute=shadow_route,
        currentTransitHours=comparison.current_transit_hours,
        prescribedTransitHours=comparison.prescribed_transit_hours,
        timeSavedHours=comparison.time_saved_hours,
        costAvoidedUsd=comparison.cost_avoided_usd,
        cascadeWarnings=cascade_warnings,
        warnings=warnings,
        worldState=world_state,
    )


@app.post("/explain-reroute", response_model=ExplainRerouteResponse)
async def explain_reroute(request: ExplainRerouteRequest) -> ExplainRerouteResponse:
    explanation = await generate_route_explanation(
        request.current_route,
        request.shadow_route,
        request.comparison,
        request.compromised_hubs,
        request.cascade_warnings,
    )
    return ExplainRerouteResponse(explanation=explanation)


@app.post("/optimize", response_model=OptimizeResponse)
def optimize(request: OptimizeRequest) -> OptimizeResponse:
    graph = build_graph(request.risk_injections, request.fuel_cost, request.delay_penalty, request.carbon_cost)
    path, total_weight = run_shortest_path(request.start_node, request.end_node, graph)

    baseline_route = request.current_route if request.current_route and len(request.current_route) >= 2 else path
    try:
        current_segments = build_segments_for_path(graph, baseline_route)
    except ValueError:
        baseline_route = path
        current_segments = build_segments_for_path(graph, path)

    optimized_segments = build_segments_for_path(graph, path)
    comparison = calculate_comparison(
        baseline_route,
        current_segments,
        optimized_segments,
        request.delay_penalty,
        request.carbon_cost,
        request.cargo_type,
        request.container_count,
    )
    shadow_route = build_shadow_route_from_path(path, total_weight, comparison)
    return OptimizeResponse(path=path, totalWeight=round(total_weight, 2), segments=optimized_segments, shadowRoute=shadow_route)
