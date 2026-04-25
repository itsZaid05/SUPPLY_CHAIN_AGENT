import { optimizeRoute } from "@/lib/routing-engine";
import type { HubRiskAnalysis, OptimizeRouteRequest, RankedRoute, ScenarioComparison } from "@/types/logistics";

const normalize = (a: string, b: string) => [a, b].sort().join("::");

const buildRiskInjections = (currentRoute: string[], analyses: HubRiskAnalysis[]): OptimizeRouteRequest["riskInjections"] => {
  const riskMap = new Map(analyses.map((analysis) => [analysis.hubName, analysis]));
  return currentRoute.slice(0, -1).flatMap((origin, index) => {
    const destination = currentRoute[index + 1];
    const edgeRisk = Math.max(riskMap.get(origin)?.riskScore ?? 0, riskMap.get(destination)?.riskScore ?? 0);
    if (edgeRisk < 0.35) return [];
    return [{
      fromNode: origin,
      toNode: destination,
      riskScore: edgeRisk,
      weatherFriction: Math.max(riskMap.get(origin)?.frictionCoefficient ?? 0, riskMap.get(destination)?.frictionCoefficient ?? 0),
      reason: `Live analysis disruption pressure at ${origin}/${destination}`,
    }];
  });
};

const toRankedRoute = (
  id: string,
  rankLabel: RankedRoute["rankLabel"],
  selectionRationale: string,
  result: ReturnType<typeof optimizeRoute>,
): RankedRoute => {
  const avgRisk = result.segments.length
    ? result.segments.reduce((acc, segment) => acc + segment.riskScore, 0) / result.segments.length
    : 0;
  const transitHours = result.shadowRoute.legs.reduce((acc, leg) => acc + leg.etaHours, 0);
  const costUsd = Math.round(result.segments.reduce((acc, segment) => acc + segment.distance * 0.82 + segment.riskScore * 14_000, 0));
  const carbonIndex = Math.round(result.segments.reduce((acc, segment) => acc + segment.weatherFriction * segment.distance, 0) / 1000);
  const resilienceScore = Math.max(35, Math.round(100 - avgRisk * 75 - Math.max(transitHours - 220, 0) * 0.08));
  return {
    id,
    rankLabel,
    nodes: result.path,
    etaHours: transitHours,
    costUsd,
    riskScore: Number(avgRisk.toFixed(2)),
    carbonIndex,
    resilienceScore,
    selectionRationale,
  };
};

export function rankRoutes(
  currentRoute: string[],
  shadowRoute: string[] | null,
  analyses: HubRiskAnalysis[],
): RankedRoute[] {
  if (currentRoute.length < 2) return [];

  const startNode = currentRoute[0];
  const endNode = currentRoute[currentRoute.length - 1];
  const riskInjections = buildRiskInjections(currentRoute, analyses);

  const objectiveConfigs = [
    { id: "best", rankLabel: "Best Route" as const, fuelCost: 0.82, delayPenalty: 14_000, carbonCost: 5_000, rationale: "Balanced objective (risk + ETA + cost + carbon)." },
    { id: "second", rankLabel: "Second Best" as const, fuelCost: 0.70, delayPenalty: 12_000, carbonCost: 7_500, rationale: "Cost/carbon weighted corridor with acceptable risk." },
    { id: "safest", rankLabel: "Safest Route" as const, fuelCost: 0.60, delayPenalty: 20_000, carbonCost: 4_500, rationale: "Safety-maximized run with stronger delay penalties." },
  ];

  const ranked = objectiveConfigs.map((config) => {
    const result = optimizeRoute({
      startNode,
      endNode,
      currentRoute: shadowRoute ?? currentRoute,
      fuelCost: config.fuelCost,
      delayPenalty: config.delayPenalty,
      carbonCost: config.carbonCost,
      riskInjections,
    });
    return toRankedRoute(config.id, config.rankLabel, config.rationale, result);
  });

  // De-duplicate labels if multiple objectives produce identical paths.
  const unique = new Map<string, RankedRoute>();
  for (const route of ranked) {
    if (!unique.has(route.nodes.join("→"))) unique.set(route.nodes.join("→"), route);
  }
  const fallbackSecond = ranked[1] ?? ranked[0];
  const fallbackSafest = ranked[2] ?? ranked[0];
  const values = Array.from(unique.values());
  return [
    values[0] ?? ranked[0],
    values[1] ? { ...values[1], rankLabel: "Second Best" } : { ...fallbackSecond, rankLabel: "Second Best" },
    values.find((route) => route.rankLabel === "Safest Route") ?? { ...fallbackSafest, rankLabel: "Safest Route" },
  ];
}

export function compareDisruptionScenarios(
  currentRoute: string[],
  alternateRoute: string[] | null,
  analyses: HubRiskAnalysis[],
  delayPenalty: number = 14_000,
  cargoMultiplier: number = 1.0,
): ScenarioComparison[] {
  const alt = alternateRoute ?? currentRoute;
  const riskMap = new Map(analyses.map((analysis) => [analysis.hubName, analysis.riskScore]));
  const effectivePenalty = delayPenalty * cargoMultiplier;

  const scenarios = [
    { id: "suez_blockage", title: "Suez Canal Blockage", disruptedHubs: ["Suez"], baseDelay: 42, baseCost: 260_000 },
    { id: "port_strike", title: "Rotterdam Port Strike", disruptedHubs: ["Rotterdam"], baseDelay: 26, baseCost: 150_000 },
    { id: "storm_cluster", title: "Bay of Bengal Storm Cluster", disruptedHubs: ["Singapore", "Colombo"], baseDelay: 34, baseCost: 210_000 },
  ];

  return scenarios.map((scenario) => {
    const avgRisk = scenario.disruptedHubs.reduce((acc, hub) => acc + (riskMap.get(hub) ?? 0.5), 0) / scenario.disruptedHubs.length;
    const riskScalar = 0.5 + avgRisk;
    const affectedCurrentHubs = currentRoute.filter((hub) => scenario.disruptedHubs.includes(hub));
    const affectedAlternateHubs = alt.filter((hub) => scenario.disruptedHubs.includes(hub));
    const currentExposure = Math.max(affectedCurrentHubs.length, 0.4);
    const alternateExposure = Math.max(affectedAlternateHubs.length, 0.3);

    return {
      id: scenario.id,
      title: scenario.title,
      disruptedHubs: scenario.disruptedHubs,
      currentDelayHours: Math.round(scenario.baseDelay * riskScalar * currentExposure),
      alternateDelayHours: Math.round(scenario.baseDelay * riskScalar * alternateExposure * 0.85),
      currentCostDeltaUsd: Math.round(scenario.baseCost * riskScalar + effectivePenalty * currentExposure * 0.6),
      alternateCostDeltaUsd: Math.round(scenario.baseCost * riskScalar * 0.82 + effectivePenalty * alternateExposure * 0.4),
      affectedCurrentHubs,
      affectedAlternateHubs,
    };
  });
}

export { normalize };
