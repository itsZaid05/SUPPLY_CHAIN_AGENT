"""Pydantic models for supply chain logistics data."""
from typing import Literal, Optional
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from pydantic.alias_generators import to_camel


# ─── Base Model with CamelCase Aliases ────────────────────────────────────

class CamelModel(BaseModel):
    """Base model that converts snake_case to camelCase for JSON serialization."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,  # Accept both snake_case and camelCase on input
    )


# ─── Request Models ───────────────────────────────────────────────────────

class AnalyzeRouteRequest(CamelModel):
    """Request payload for route analysis."""

    hubs: list[str] = Field(..., description="List of hub names in the route")
    current_route: list[str] = Field(..., description="Current active route")
    simulate_chaos: bool = Field(False, description="Whether to inject disruptions")
    chaos_hubs: list[str] = Field(default_factory=list, description="Hubs to disrupt")
    chaos_severity: float = Field(0.0, ge=0.0, le=1.0, description="Disruption severity (0-1)")
    chaos_mode: Literal["single", "cluster", "storm"] = Field("single", description="Type of disruption")


class HubRiskAnalysis(CamelModel):
    """Hub risk analysis result from Gemini."""

    hub_name: str
    lat: float
    lon: float
    risk_score: float = Field(0.0, ge=0.0, le=1.0, description="Probability of failure (0-1)")
    friction_coefficient: float = Field(1.0, ge=0.5, le=3.0, description="Weather-derived friction")
    confidence: float = Field(0.8, ge=0.0, le=1.0, description="Analysis confidence")
    congestion_factor: float = Field(1.0, ge=0.5, le=5.0, description="Current throughput factor")
    is_cascade_affected: bool = Field(False, description="Affected by cascade")
    reasoning_log: str = Field("", description="Gemini reasoning")
    status: Literal["optimal", "warning", "critical"] = "optimal"
    news_summary: str = Field("", description="Aggregated news sentiment")
    weather_summary: str = Field("", description="Weather impact summary")
    analyzed_at: datetime = Field(default_factory=datetime.utcnow)
    source_errors: list[str] = Field(default_factory=list)
    cascade_from: Optional[str] = None
    cascade_degree: Optional[int] = None


class CascadeWarning(CamelModel):
    """Cascade propagation warning."""

    hub_name: str
    degree: int = Field(1, description="Cascade degree (1=direct, 2=indirect, etc.)")
    origin_disruption: str = Field("", description="Originating hub")
    propagated_risk: float = Field(0.0, ge=0.0, le=1.0)
    reason: str = Field("", description="Why cascade occurred")


class ComparisonMatrix(CamelModel):
    """Route comparison metrics."""

    current_delay_hours: float = 0.0
    current_penalty_usd: float = 0.0
    prescribed_delay_hours: float = 0.0
    prescribed_penalty_usd: float = 0.0
    carbon_delta_percent: float = 0.0
    current_transit_hours: float = 0.0
    prescribed_transit_hours: float = 0.0
    time_saved_hours: float = 0.0
    cost_avoided_usd: float = 0.0
    current_distance_nm: float = 0.0
    prescribed_distance_nm: float = 0.0
    roi_multiplier: float = 1.0


class ManifestLeg(CamelModel):
    """Single leg of a shipping manifest."""

    id: str
    sequence: int
    origin: str
    destination: str
    mode: Literal["Ocean", "Port", "Rail"] = "Ocean"
    vessel: str = ""
    eta_hours: float
    risk_score: float = 0.0
    health: Literal["optimal", "warning", "critical"] = "optimal"
    note: str = ""


class ShadowRoute(CamelModel):
    """Alternative route recommendation."""

    id: str
    title: str = "Optimized Route"
    status: Literal["available", "executed"] = "available"
    nodes: list[str]
    legs: list[ManifestLeg]
    total_weight: float
    comparison: ComparisonMatrix


class WorldStateEvent(CamelModel):
    """Terminal event for real-time UI streaming."""

    id: str
    source: Literal["system", "signal", "risk", "optimizer", "dispatch", "cascade"]
    tone: Literal["info", "warning", "critical", "success"]
    message: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    hub_name: Optional[str] = None


class WorldStateDocument(CamelModel):
    """Complete state snapshot for Firestore."""

    analysis_run_id: str
    status: Literal["idle", "analyzing", "analysis_complete", "rerouted", "error"]
    current_route: list[str]
    compromised_hubs: list[str]
    cascade_warnings: list[CascadeWarning] = Field(default_factory=list)
    analyses: list[HubRiskAnalysis]
    terminal_events: list[WorldStateEvent]
    shadow_route: Optional[ShadowRoute] = None
    warnings: list[str] = Field(default_factory=list)
    last_updated_at: datetime = Field(default_factory=datetime.utcnow)
    last_error: Optional[str] = None


# ─── Response Models ──────────────────────────────────────────────────────

class AnalyzeRouteResponse(CamelModel):
    """Response from /analyze-route endpoint."""

    analysis_run_id: str
    status: Literal["ok", "degraded"] = "ok"
    analyses: list[HubRiskAnalysis]
    compromised_hubs: list[str]
    cascade_warnings: list[CascadeWarning]
    warnings: list[str]
    world_state: WorldStateDocument


class PrescriptivePathRequest(CamelModel):
    """Request for route optimization."""

    analysis_run_id: Optional[str] = None
    current_route: list[str]
    hub_analyses: list[HubRiskAnalysis]
    fuel_cost: float = 0.82
    delay_penalty: float = 14_000
    carbon_cost: float = 5_000
    cargo_type: Literal["electronics", "automotive", "chemicals", "bulk", "perishable", "luxury"] = "bulk"
    origin: Optional[str] = None
    destination: Optional[str] = None
    container_count: int = 1


class PrescriptivePathResponse(CamelModel):
    """Response from /get-prescriptive-path endpoint."""

    analysis_run_id: str
    status: Literal["ok", "degraded"] = "ok"
    current_route: list[str]
    path: list[str] = Field(description="Optimized path")
    shadow_route: ShadowRoute
    total_weight: float
    current_transit_hours: float
    prescribed_transit_hours: float
    time_saved_hours: float
    cost_avoided_usd: float
    cascade_warnings: list[CascadeWarning]
    warnings: list[str]
    world_state: WorldStateDocument


class RouteExplanation(CamelModel):
    """AI-generated reroute explanation."""

    summary: str
    risk_avoided: str
    time_saved_rationale: str
    cost_logic: str
    confidence_score: float = Field(0.8, ge=0.0, le=1.0)
    alternatives_considered: list[str]


class ExplainRerouteRequest(CamelModel):
    """Request for reroute explanation."""

    current_route: list[str]
    shadow_route: list[str]
    comparison: ComparisonMatrix
    compromised_hubs: list[str]
    cascade_warnings: list[CascadeWarning] = Field(default_factory=list)


class ExplainRerouteResponse(CamelModel):
    """Response from /explain-reroute endpoint."""

    explanation: RouteExplanation
