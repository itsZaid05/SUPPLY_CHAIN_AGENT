"""FastAPI application - Supply Chain Resilience System."""
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

from config import settings
from models.logistics import (
    AnalyzeRouteRequest,
    AnalyzeRouteResponse,
    PrescriptivePathRequest,
    PrescriptivePathResponse,
    ExplainRerouteRequest,
    ExplainRerouteResponse,
)
from services.route_analyzer import RouteAnalyzer
from services.gemini_reasoner import GeminiReasoner
from services.optimization_engine import OptimizationEngine
from services.firestore_manager import get_firestore_manager
from utils.logger_setup import setup_logger

# Setup logging
logger = setup_logger(__name__)

# Initialize services
gemini_reasoner = GeminiReasoner()
route_analyzer = RouteAnalyzer(gemini_reasoner)
optimization_engine = OptimizationEngine()
firestore_manager = get_firestore_manager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown events."""
    logger.info(f"🚀 {settings.APP_NAME} v{settings.APP_VERSION} starting...")
    logger.info(f"Debug: {settings.DEBUG}")
    logger.info(f"CORS Origins: {settings.CORS_ORIGINS}")
    yield
    logger.info("🛑 Shutting down gracefully...")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Health Check ─────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "version": settings.APP_VERSION,
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─── Core Endpoints ───────────────────────────────────────────────────────

@app.post("/analyze-route", response_model=AnalyzeRouteResponse)
async def analyze_route(request: AnalyzeRouteRequest) -> AnalyzeRouteResponse:
    """Analyze supply chain route for disruption risks.

    Evaluates each hub using Gemini AI, detecting disruptions and cascade effects.
    """
    try:
        analysis_run_id = str(uuid.uuid4())
        logger.info(f"Starting route analysis: {analysis_run_id}")

        # Phase 1: Analyze hubs
        analyses, cascade_warnings, warnings = await route_analyzer.analyze_route(request)
        compromised_hubs = [a.hub_name for a in analyses if a.risk_score > 0.5]

        # Phase 2: Create world state
        world_state = await route_analyzer.create_world_state_document(
            analysis_run_id=analysis_run_id,
            current_route=request.current_route,
            analyses=analyses,
            compromised_hubs=compromised_hubs,
            cascade_warnings=cascade_warnings,
            warnings=warnings,
        )

        # Phase 3: Persist to Firestore
        await firestore_manager.write_world_state(analysis_run_id, world_state)

        logger.info(f"Route analysis complete: {len(analyses)} hubs, {len(cascade_warnings)} cascades")

        return AnalyzeRouteResponse(
            analysis_run_id=analysis_run_id,
            status="ok" if not warnings else "degraded",
            analyses=analyses,
            compromised_hubs=compromised_hubs,
            cascade_warnings=cascade_warnings,
            warnings=warnings,
            world_state=world_state,
        )
    except Exception as e:
        logger.error(f"Route analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/get-prescriptive-path", response_model=PrescriptivePathResponse)
async def get_prescriptive_path(request: PrescriptivePathRequest) -> PrescriptivePathResponse:
    """Compute optimized route using multi-objective graph optimization.

    Uses weighted cost function with NetworkX Dijkstra to find resilient paths.
    """
    try:
        analysis_run_id = request.analysis_run_id or str(uuid.uuid4())
        logger.info(f"Computing prescriptive path: {analysis_run_id}")

        # Optimize route
        optimal_path, total_weight, shadow_route = optimization_engine.compute_optimal_route(
            current_route=request.current_route,
            analyses=request.hub_analyses,
            request=request,
        )

        # Create world state with shadow route
        world_state = await route_analyzer.create_world_state_document(
            analysis_run_id=analysis_run_id,
            current_route=request.current_route,
            analyses=request.hub_analyses,
            compromised_hubs=[a.hub_name for a in request.hub_analyses if a.risk_score > 0.5],
            cascade_warnings=[],
            warnings=[],
            shadow_route=shadow_route.model_dump(),
        )
        world_state.status = "rerouted"

        # Persist
        await firestore_manager.write_world_state(analysis_run_id, world_state)

        logger.info(f"Prescriptive path computed: {' → '.join(optimal_path)}")

        return PrescriptivePathResponse(
            analysis_run_id=analysis_run_id,
            status="ok",
            current_route=request.current_route,
            path=optimal_path,
            shadow_route=shadow_route,
            total_weight=total_weight,
            current_transit_hours=shadow_route.comparison.current_transit_hours,
            prescribed_transit_hours=shadow_route.comparison.prescribed_transit_hours,
            time_saved_hours=shadow_route.comparison.time_saved_hours,
            cost_avoided_usd=shadow_route.comparison.cost_avoided_usd,
            cascade_warnings=[],
            warnings=[],
            world_state=world_state,
        )
    except Exception as e:
        logger.error(f"Prescriptive path computation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/explain-reroute", response_model=ExplainRerouteResponse)
async def explain_reroute(request: ExplainRerouteRequest) -> ExplainRerouteResponse:
    """Generate natural language explanation for reroute using Gemini."""
    try:
        logger.info(f"Generating reroute explanation")

        explanation = await gemini_reasoner.explain_reroute(
            current_route=request.current_route,
            shadow_route=request.shadow_route,
            time_saved_hours=request.comparison.time_saved_hours,
            cost_avoided_usd=request.comparison.cost_avoided_usd,
            compromised_hubs=request.compromised_hubs,
        )

        logger.info(f"Explanation generated (confidence: {explanation.confidence_score:.2f})")

        return ExplainRerouteResponse(explanation=explanation)
    except Exception as e:
        logger.error(f"Explanation generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Utility Endpoints ────────────────────────────────────────────────────

@app.get("/config")
async def get_config():
    """Get current configuration (non-sensitive)."""
    return {
        "app_name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "weights": {
            "freight_cost": settings.WEIGHT_FREIGHT_COST,
            "penalty_sla": settings.WEIGHT_PENALTY_SLA,
            "risk_physical": settings.WEIGHT_RISK_PHYSICAL,
            "impact_carbon": settings.WEIGHT_IMPACT_CARBON,
        },
        "capacity_threshold": settings.CAPACITY_THRESHOLD,
        "exponential_penalty_factor": settings.EXPONENTIAL_PENALTY_FACTOR,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=settings.BACKEND_HOST,
        port=settings.BACKEND_PORT,
        log_level="info" if not settings.DEBUG else "debug",
    )
