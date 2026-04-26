"""Route analysis service using Gemini for hub risk evaluation."""
import logging
import uuid
from datetime import datetime
from typing import Optional
from models.logistics import (
    AnalyzeRouteRequest,
    HubRiskAnalysis,
    CascadeWarning,
    WorldStateDocument,
    WorldStateEvent,
)
from utils.mock_data import (
    get_hub_coordinates,
    get_all_hub_names,
)
from services.live_data import fetch_hub_context
from services.gemini_reasoner import GeminiReasoner

logger = logging.getLogger(__name__)


class RouteAnalyzer:
    """Analyzes supply chain routes for disruption risk."""

    def __init__(self, gemini: GeminiReasoner):
        """Initialize with Gemini reasoner."""
        self.gemini = gemini
        self.all_hubs = set(get_all_hub_names())

    async def analyze_route(
        self,
        request: AnalyzeRouteRequest,
    ) -> tuple[list[HubRiskAnalysis], list[CascadeWarning], list[str]]:
        """Analyze route for disruption risks.

        Returns:
            Tuple of (hub_analyses, cascade_warnings, warnings)
        """
        analyses: list[HubRiskAnalysis] = []
        compromised: set[str] = set()
        warnings: list[str] = []

        # Phase 1: Analyze each hub
        for hub_name in request.hubs:
            coords = get_hub_coordinates(hub_name)
            if not coords:
                warnings.append(f"Hub {hub_name} coordinates not found")
                continue

            try:
                # Fetch live news + weather context (falls back gracefully if APIs unavailable)
                hub_context = await fetch_hub_context(hub_name)

                if not hub_context["news_is_live"] or not hub_context["weather_is_live"]:
                    data_source = "live" if hub_context["news_is_live"] and hub_context["weather_is_live"] else "partial-fallback"
                    warnings.append(f"{hub_name}: data source={data_source}")

                # Get Gemini analysis with live-fetched context
                analysis = await self.gemini.evaluate_hub_risk(
                    hub_name=hub_name,
                    chaos_severity=request.chaos_severity if hub_name in request.chaos_hubs else 0.0,
                    news_context=hub_context["news_context"],
                    weather_friction=hub_context["weather_friction"],
                )
                # Attach live weather summary directly to the analysis
                analysis.weather_summary = hub_context["weather_summary"]

                # Track compromised hubs
                if analysis.risk_score > 0.5:
                    compromised.add(hub_name)

                analyses.append(analysis)
            except Exception as e:
                logger.error(f"Failed to analyze hub {hub_name}: {e}")
                warnings.append(f"Analysis failed for {hub_name}: {str(e)}")

        # Phase 2: Detect cascade effects
        cascade_warnings = self._detect_cascades(analyses, compromised)

        # Phase 3: Update analysis with cascade info
        for analysis in analyses:
            for warning in cascade_warnings:
                if analysis.hub_name == warning.hub_name:
                    analysis.is_cascade_affected = True
                    analysis.cascade_from = warning.origin_disruption
                    analysis.cascade_degree = warning.degree
                    if analysis.status == "optimal":
                        analysis.status = "warning"
                    break

        return analyses, cascade_warnings, warnings

    def _detect_cascades(
        self,
        analyses: list[HubRiskAnalysis],
        compromised: set[str],
    ) -> list[CascadeWarning]:
        """Detect cascade effects from compromised hubs."""
        cascades: list[CascadeWarning] = []
        processed: set[str] = set()

        # Build adjacency for cascade propagation
        adjacency = self._build_route_adjacency()

        def propagate_cascade(hub: str, degree: int, origin: str):
            """Recursively propagate cascade effects."""
            if hub in processed or degree > 3:  # Limit cascade depth
                return

            processed.add(hub)

            # Find neighbors
            neighbors = adjacency.get(hub, [])
            for neighbor in neighbors:
                if neighbor not in compromised:
                    # Calculate propagated risk
                    base_analysis = next((a for a in analyses if a.hub_name == neighbor), None)
                    if base_analysis:
                        propagated_risk = base_analysis.risk_score * (0.7 ** (degree - 1))

                        cascades.append(
                            CascadeWarning(
                                hub_name=neighbor,
                                degree=degree,
                                origin_disruption=origin,
                                propagated_risk=propagated_risk,
                                reason=f"Cascade effect from {origin} (degree {degree})",
                            )
                        )

                        # Propagate further
                        if propagated_risk > 0.1:  # Only if risk threshold exceeded
                            propagate_cascade(neighbor, degree + 1, origin)

        # Start cascade detection from each compromised hub
        for compromised_hub in compromised:
            propagate_cascade(compromised_hub, 1, compromised_hub)

        return cascades

    def _build_route_adjacency(self) -> dict[str, list[str]]:
        """Build simplified adjacency map for cascade detection."""
        return {
            "Shanghai": ["Singapore"],
            "Singapore": ["Shanghai", "Suez", "Dubai", "Colombo"],
            "Suez": ["Singapore", "Rotterdam", "Dubai"],
            "Rotterdam": ["Suez", "Hamburg"],
            "Dubai": ["Singapore", "Suez", "Mumbai"],
            "Mumbai": ["Dubai", "Colombo"],
            "Colombo": ["Singapore", "Mumbai"],
            "Hamburg": ["Rotterdam"],
            "Cape Town": ["Singapore", "Rotterdam"],
        }

    async def create_world_state_document(
        self,
        analysis_run_id: str,
        current_route: list[str],
        analyses: list[HubRiskAnalysis],
        compromised_hubs: list[str],
        cascade_warnings: list[CascadeWarning],
        warnings: list[str],
        shadow_route: Optional[dict] = None,
    ) -> WorldStateDocument:
        """Create a WorldStateDocument for Firestore."""
        terminal_events = [
            WorldStateEvent(
                id=str(uuid.uuid4()),
                source="system",
                tone="info",
                message=f"Analysis initiated for route: {' → '.join(current_route)}",
                created_at=datetime.utcnow(),
            ),
            WorldStateEvent(
                id=str(uuid.uuid4()),
                source="optimizer",
                tone="info",
                message=f"Evaluated {len(analyses)} hubs · Compromised: {len(compromised_hubs)}",
                created_at=datetime.utcnow(),
            ),
        ]

        if cascade_warnings:
            terminal_events.append(
                WorldStateEvent(
                    id=str(uuid.uuid4()),
                    source="cascade",
                    tone="warning",
                    message=f"Cascade detected: {', '.join([w.hub_name for w in cascade_warnings])}",
                    created_at=datetime.utcnow(),
                )
            )

        return WorldStateDocument(
            analysis_run_id=analysis_run_id,
            status="analysis_complete",
            current_route=current_route,
            compromised_hubs=compromised_hubs,
            cascade_warnings=cascade_warnings,
            analyses=analyses,
            terminal_events=terminal_events,
            shadow_route=shadow_route,
            warnings=warnings,
            last_updated_at=datetime.utcnow(),
        )
