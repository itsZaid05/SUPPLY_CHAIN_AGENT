"""Multi-objective graph optimization engine using NetworkX."""
import logging
import math
from typing import Optional
from datetime import datetime
import networkx as nx
from config import settings
from models.logistics import (
    HubRiskAnalysis,
    ManifestLeg,
    ShadowRoute,
    ComparisonMatrix,
    PrescriptivePathRequest,
)
from utils.mock_data import get_hub_coordinates, GLOBAL_HUBS

logger = logging.getLogger(__name__)


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two coordinates in nautical miles."""
    R = 3440.065  # Earth radius in nautical miles
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


class OptimizationEngine:
    """Dijkstra-based multi-objective route optimization."""

    def __init__(self):
        """Initialize optimization engine."""
        self.graph: Optional[nx.DiGraph] = None
        self._build_graph()

    def _build_graph(self):
        """Build directed graph from hub coordinates."""
        self.graph = nx.DiGraph()

        # Add all hubs as nodes
        for hub in GLOBAL_HUBS:
            self.graph.add_node(hub["name"], lat=hub["lat"], lon=hub["lon"])

        # Create edges (simplified: connect all pairs)
        for hub1 in GLOBAL_HUBS:
            for hub2 in GLOBAL_HUBS:
                if hub1["name"] != hub2["name"]:
                    distance = haversine_distance(hub1["lat"], hub1["lon"], hub2["lat"], hub2["lon"])
                    self.graph.add_edge(hub1["name"], hub2["name"], distance=distance, base_weight=distance)

        logger.info(f"Graph built: {len(self.graph.nodes())} nodes, {len(self.graph.edges())} edges")

    def compute_optimal_route(
        self,
        current_route: list[str],
        analyses: list[HubRiskAnalysis],
        request: PrescriptivePathRequest,
    ) -> tuple[list[str], float, ShadowRoute]:
        """Compute optimal route using Dijkstra with weighted cost function.

        Cost function:
        W_e = w1·CostFreight + w2·PenaltySLA + w3·RiskPhysical + w4·ImpactCarbon
        """
        if not self.graph:
            self._build_graph()

        # Create risk map
        risk_map = {analysis.hub_name: analysis for analysis in analyses}

        # Update edge weights with risk + capacity logic
        self._update_edge_weights(risk_map)

        # Find start and end
        start = current_route[0] if current_route else "Shanghai"
        end = current_route[-1] if current_route else "Rotterdam"

        # Run Dijkstra
        try:
            optimal_path = nx.dijkstra_path(self.graph, start, end, weight="weight")
        except nx.NetworkXNoPath:
            logger.warning(f"No path found from {start} to {end}. Using current route.")
            optimal_path = current_route
        except nx.NodeNotFound as e:
            logger.error(f"Node not found: {e}. Using fallback route.")
            optimal_path = current_route

        # Build shadow route with manifest legs
        shadow_route = self._build_shadow_route(
            optimal_path, current_route, analyses, risk_map, request
        )

        return optimal_path, shadow_route.total_weight, shadow_route

    def _update_edge_weights(self, risk_map: dict[str, HubRiskAnalysis]):
        """Update edge weights based on risk scores and node capacity."""
        for u, v, data in self.graph.edges(data=True):
            # Base freight cost
            distance = data.get("distance", 1000)
            freight_cost = distance * settings.FUEL_COST_PER_NM

            # SLA penalty component
            transit_hours = distance / 20  # Assume ~20 nm/hour average speed
            sla_penalty = transit_hours * settings.DELAY_PENALTY_PER_HOUR

            # Physical risk from destination hub
            dest_analysis = risk_map.get(v)
            risk_physical = (dest_analysis.risk_score if dest_analysis else 0.1) * 10000

            # Carbon impact
            carbon_impact = distance * settings.CARBON_COST_PER_TONNE / 100

            # Apply multi-objective weighting
            base_weight = (
                settings.WEIGHT_FREIGHT_COST * freight_cost
                + settings.WEIGHT_PENALTY_SLA * sla_penalty
                + settings.WEIGHT_RISK_PHYSICAL * risk_physical
                + settings.WEIGHT_IMPACT_CARBON * carbon_impact
            )

            # Apply node capacity logic (80% → exponential penalty)
            if dest_analysis and dest_analysis.congestion_factor > settings.CAPACITY_THRESHOLD:
                excess_capacity = dest_analysis.congestion_factor - settings.CAPACITY_THRESHOLD
                capacity_penalty = base_weight * (settings.EXPONENTIAL_PENALTY_FACTOR ** excess_capacity)
                base_weight = capacity_penalty

            # Weather friction adjustment
            if dest_analysis:
                base_weight *= dest_analysis.friction_coefficient

            self.graph[u][v]["weight"] = max(base_weight, 1.0)  # Prevent zero weights

    def _build_shadow_route(
        self,
        optimal_path: list[str],
        current_route: list[str],
        analyses: list[HubRiskAnalysis],
        risk_map: dict[str, HubRiskAnalysis],
        request: PrescriptivePathRequest,
    ) -> ShadowRoute:
        """Build shadow route with manifest legs and comparison metrics."""
        legs: list[ManifestLeg] = []
        total_distance = 0.0
        total_transit_hours = 0.0
        total_weight = 0.0

        # Build legs for optimal path
        for i in range(len(optimal_path) - 1):
            origin = optimal_path[i]
            destination = optimal_path[i + 1]
            distance = self.graph[origin][destination]["distance"]
            transit_hours = distance / 20

            leg = ManifestLeg(
                id=f"leg-{i+1}",
                sequence=i + 1,
                origin=origin,
                destination=destination,
                mode="Ocean",
                vessel="MV Optimized",
                eta_hours=transit_hours,
                risk_score=risk_map.get(destination, HubRiskAnalysis(
                    hub_name=destination,
                    lat=0,
                    lon=0,
                )).risk_score,
                health="optimal",
                note=f"Optimized segment {i+1}",
            )
            legs.append(leg)
            total_distance += distance
            total_transit_hours += transit_hours
            total_weight += self.graph[origin][destination]["weight"]

        # Calculate comparison matrix
        current_distance = sum(
            self.graph[current_route[i]][current_route[i + 1]]["distance"]
            for i in range(len(current_route) - 1)
            if current_route[i] in self.graph and current_route[i + 1] in self.graph
        )
        current_transit_hours = current_distance / 20

        time_saved_hours = max(0, current_transit_hours - total_transit_hours)
        cost_avoided_usd = max(0, (current_distance - total_distance) * settings.FUEL_COST_PER_NM * 0.5)

        comparison = ComparisonMatrix(
            current_transit_hours=current_transit_hours,
            prescribed_transit_hours=total_transit_hours,
            time_saved_hours=time_saved_hours,
            cost_avoided_usd=cost_avoided_usd,
            current_distance_nm=current_distance,
            prescribed_distance_nm=total_distance,
            carbon_delta_percent=((current_distance - total_distance) / current_distance * 100) if current_distance > 0 else 0,
            roi_multiplier=1.0 + (cost_avoided_usd / 100_000) if cost_avoided_usd > 0 else 1.0,
        )

        shadow_route = ShadowRoute(
            id="shadow-optimal",
            title="Optimized Route",
            status="available",
            nodes=optimal_path,
            legs=legs,
            total_weight=total_weight,
            comparison=comparison,
        )

        return shadow_route
