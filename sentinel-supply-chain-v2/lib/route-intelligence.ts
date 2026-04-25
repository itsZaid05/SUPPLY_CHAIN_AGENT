import type { HubRiskAnalysis, RankedRoute, ScenarioComparison } from "@/types/logistics";

interface EdgeStat {
  distance: number;
  baseRisk: number;
  etaHours: number;
  carbon: number;
}

const EDGE_STATS: Record<string, EdgeStat> = {
  "Shanghai::Singapore": { distance: 2400, baseRisk: 0.09, etaHours: 28, carbon: 0.12 },
  "Singapore::Suez": { distance: 8400, baseRisk: 0.18, etaHours: 86, carbon: 0.22 },
  "Suez::Rotterdam": { distance: 6200, baseRisk: 0.14, etaHours: 104, carbon: 0.18 },
  "Singapore::Cape Town": { distance: 9700, baseRisk: 0.20, etaHours: 118, carbon: 0.30 },
  "Cape Town::Rotterdam": { distance: 6900, baseRisk: 0.12, etaHours: 96, carbon: 0.21 },
  "Shanghai::Mumbai": { distance: 4800, baseRisk: 0.13, etaHours: 60, carbon: 0.18 },
  "Mumbai::Dubai": { distance: 1900, baseRisk: 0.10, etaHours: 28, carbon: 0.09 },
  "Dubai::Rotterdam": { distance: 8100, baseRisk: 0.15, etaHours: 168, carbon: 0.19 },
  "Mumbai::Colombo": { distance: 1100, baseRisk: 0.08, etaHours: 18, carbon: 0.11 },
  "Colombo::Singapore": { distance: 2800, baseRisk: 0.10, etaHours: 42, carbon: 0.14 },
  "Colombo::Cape Town": { distance: 6200, baseRisk: 0.16, etaHours: 84, carbon: 0.25 },
};

const normalize = (a: string, b: string) => [a, b].sort().join("::");

interface RouteAssessment {
  nodes: string[];
  etaHours: number;
  costUsd: number;
  riskScore: number;
  carbonIndex: number;
  resilienceScore: number;
}

const assessRoute = (nodes: string[], analyses: HubRiskAnalysis[]): RouteAssessment => {
  const riskMap = new Map(analyses.map((analysis) => [analysis.hubName, analysis.riskScore]));
  let etaHours = 0;
  let costUsd = 0;
  let riskTotal = 0;
  let carbonTotal = 0;
  let fallbackCoverage = 0;

  for (let i = 0; i < nodes.length - 1; i += 1) {
    const from = nodes[i];
    const to = nodes[i + 1];
    const edge = EDGE_STATS[normalize(from, to)] ?? { distance: 3500, baseRisk: 0.18, etaHours: 72, carbon: 0.17 };
    const fromRisk = riskMap.get(from) ?? edge.baseRisk;
    const toRisk = riskMap.get(to) ?? edge.baseRisk;
    const risk = Math.max(edge.baseRisk, (fromRisk + toRisk) / 2);
    const delayPenalty = risk >= 0.5 ? 26 : risk >= 0.35 ? 12 : 0;
    etaHours += edge.etaHours + delayPenalty;
    costUsd += edge.distance * 0.82 + risk * 14_000;
    riskTotal += risk;
    carbonTotal += edge.carbon * edge.distance;
    if (risk < 0.35) fallbackCoverage += 1;
  }

  const legCount = Math.max(nodes.length - 1, 1);
  const avgRisk = riskTotal / legCount;
  const normalizedCarbon = Math.round(carbonTotal / 1000);
  const resilienceScore = Math.max(
    35,
    Math.round(100 - avgRisk * 75 - Math.max(etaHours - 220, 0) * 0.08 + (fallbackCoverage / legCount) * 12),
  );

  return {
    nodes,
    etaHours: Math.round(etaHours),
    costUsd: Math.round(costUsd),
    riskScore: Number(avgRisk.toFixed(2)),
    carbonIndex: normalizedCarbon,
    resilienceScore,
  };
};

const routeLabel = (route: RouteAssessment, baseline: RouteAssessment): string => {
  const riskDelta = (baseline.riskScore - route.riskScore).toFixed(2);
  const etaDelta = baseline.etaHours - route.etaHours;
  if (route.riskScore <= baseline.riskScore && route.etaHours <= baseline.etaHours) {
    return `Avoids high-risk hubs while saving ${Math.max(etaDelta, 0)}h.`;
  }
  if (route.riskScore < baseline.riskScore) {
    return `Lowest exposure profile (${riskDelta} lower risk than current).`;
  }
  return `Balanced option with stronger recovery coverage across hubs.`;
};

export function rankRoutes(
  currentRoute: string[],
  shadowRoute: string[] | null,
  analyses: HubRiskAnalysis[],
): RankedRoute[] {
  if (currentRoute.length < 2) return [];
  const origin = currentRoute[0];
  const destination = currentRoute[currentRoute.length - 1];
  const templates = [
    currentRoute,
    shadowRoute ?? currentRoute,
    [origin, "Singapore", "Cape Town", destination],
    [origin, "Mumbai", "Dubai", destination],
    [origin, "Mumbai", "Colombo", "Singapore", "Cape Town", destination],
  ];

  const uniqueRoutes = Array.from(
    new Map(
      templates
        .filter((nodes) => nodes.length >= 2 && nodes[0] === origin && nodes[nodes.length - 1] === destination)
        .map((nodes) => [nodes.join("→"), nodes]),
    ).values(),
  );

  const assessed = uniqueRoutes.map((nodes) => assessRoute(nodes, analyses));
  const baseline = assessed[0];
  const byComposite = [...assessed].sort((a, b) => {
    const aScore = a.riskScore * 0.45 + a.etaHours * 0.003 + a.costUsd * 0.00001 + a.carbonIndex * 0.004;
    const bScore = b.riskScore * 0.45 + b.etaHours * 0.003 + b.costUsd * 0.00001 + b.carbonIndex * 0.004;
    return aScore - bScore;
  });
  const safest = [...assessed].sort((a, b) => a.riskScore - b.riskScore || b.resilienceScore - a.resilienceScore)[0];

  const ordered = [byComposite[0], byComposite[1] ?? byComposite[0], safest];
  return ordered.map((route, index) => {
    const rankLabel: RankedRoute["rankLabel"] =
      index === 0 ? "Best Route" : index === 1 ? "Second Best" : "Safest Route";
    return {
      id: `${rankLabel}-${route.nodes.join("-")}`,
      rankLabel,
      nodes: route.nodes,
      etaHours: route.etaHours,
      costUsd: route.costUsd,
      riskScore: route.riskScore,
      carbonIndex: route.carbonIndex,
      resilienceScore: route.resilienceScore,
      selectionRationale: routeLabel(route, baseline),
    };
  });
}

export function compareDisruptionScenarios(currentRoute: string[], alternateRoute: string[] | null): ScenarioComparison[] {
  const alt = alternateRoute ?? currentRoute;
  const scenarios = [
    { id: "suez_blockage", title: "Suez blockage", disruptedHubs: ["Suez"], delay: 42, cost: 260_000 },
    { id: "port_strike", title: "Port strike", disruptedHubs: ["Rotterdam"], delay: 26, cost: 150_000 },
    { id: "storm_cluster", title: "Severe storm cluster", disruptedHubs: ["Singapore", "Dubai", "Colombo"], delay: 34, cost: 210_000 },
  ];

  return scenarios.map((scenario) => {
    const affectedCurrentHubs = currentRoute.filter((hub) => scenario.disruptedHubs.includes(hub));
    const affectedAlternateHubs = alt.filter((hub) => scenario.disruptedHubs.includes(hub));
    const currentMultiplier = affectedCurrentHubs.length === 0 ? 0.25 : 1 + affectedCurrentHubs.length * 0.35;
    const alternateMultiplier = affectedAlternateHubs.length === 0 ? 0.2 : 0.85 + affectedAlternateHubs.length * 0.28;

    return {
      id: scenario.id,
      title: scenario.title,
      disruptedHubs: scenario.disruptedHubs,
      currentDelayHours: Math.round(scenario.delay * currentMultiplier),
      alternateDelayHours: Math.round(scenario.delay * alternateMultiplier),
      currentCostDeltaUsd: Math.round(scenario.cost * currentMultiplier),
      alternateCostDeltaUsd: Math.round(scenario.cost * alternateMultiplier),
      affectedCurrentHubs,
      affectedAlternateHubs,
    };
  });
}
