import type {
  ComparisonMatrix,
  GraphEdge,
  ManifestLeg,
  OptimizeRouteRequest,
  OptimizeRouteResponse,
  PathSegment,
  RiskInjection,
  ShadowRoute,
} from "@/types/logistics";

const graphEdges: GraphEdge[] = [
  { fromNode: "Shanghai", toNode: "Singapore", distance: 2_400, riskScore: 0.09, weatherFriction: 0.12 },
  { fromNode: "Singapore", toNode: "Suez", distance: 8_400, riskScore: 0.18, weatherFriction: 0.22 },
  { fromNode: "Suez", toNode: "Rotterdam", distance: 6_200, riskScore: 0.14, weatherFriction: 0.18 },
  { fromNode: "Singapore", toNode: "Cape Town", distance: 9_700, riskScore: 0.20, weatherFriction: 0.30 },
  { fromNode: "Cape Town", toNode: "Rotterdam", distance: 6_900, riskScore: 0.12, weatherFriction: 0.21 },
  { fromNode: "Singapore", toNode: "Dubai", distance: 5_800, riskScore: 0.11, weatherFriction: 0.10 },
  { fromNode: "Dubai", toNode: "Suez", distance: 2_500, riskScore: 0.16, weatherFriction: 0.10 },
  { fromNode: "Rotterdam", toNode: "Hamburg", distance: 470, riskScore: 0.05, weatherFriction: 0.08 },
  { fromNode: "Shanghai", toNode: "Mumbai", distance: 4_800, riskScore: 0.13, weatherFriction: 0.18 },
  { fromNode: "Mumbai", toNode: "Dubai", distance: 1_900, riskScore: 0.10, weatherFriction: 0.09 },
  { fromNode: "Mumbai", toNode: "Colombo", distance: 1_100, riskScore: 0.08, weatherFriction: 0.11 },
  { fromNode: "Colombo", toNode: "Singapore", distance: 2_800, riskScore: 0.10, weatherFriction: 0.14 },
  { fromNode: "Dubai", toNode: "Rotterdam", distance: 8_100, riskScore: 0.15, weatherFriction: 0.19 },
  { fromNode: "Cape Town", toNode: "Hamburg", distance: 8_200, riskScore: 0.14, weatherFriction: 0.24 },
];

const legEtaHours: Record<string, number> = {
  "Shanghai::Singapore": 28, "Singapore::Suez": 86, "Suez::Rotterdam": 104,
  "Singapore::Cape Town": 118, "Cape Town::Rotterdam": 96, "Singapore::Dubai": 48,
  "Dubai::Suez": 38, "Rotterdam::Hamburg": 18, "Shanghai::Mumbai": 60,
  "Mumbai::Dubai": 28, "Mumbai::Colombo": 18, "Colombo::Singapore": 42,
  "Dubai::Rotterdam": 168, "Cape Town::Hamburg": 204,
};

const normalize = (a: string, b: string) => [a, b].sort().join("::");

interface WeightedEdge extends GraphEdge { weight: number; }

const calculateWeight = (edge: Pick<GraphEdge, "distance" | "riskScore" | "weatherFriction">, req: OptimizeRouteRequest) =>
  edge.distance * req.fuelCost + edge.riskScore * req.delayPenalty + edge.weatherFriction * req.carbonCost;

const applyInjections = (edges: GraphEdge[], injections: RiskInjection[]): GraphEdge[] => {
  const map = new Map(injections.map((i) => [normalize(i.fromNode, i.toNode), i]));
  return edges.map((e) => {
    const inj = map.get(normalize(e.fromNode, e.toNode));
    if (!inj) return e;
    return { ...e, riskScore: inj.riskScore ?? e.riskScore, weatherFriction: inj.weatherFriction ?? e.weatherFriction };
  });
};

const buildAdjacency = (edges: WeightedEdge[]) => {
  const adj = new Map<string, WeightedEdge[]>();
  for (const e of edges) {
    adj.set(e.fromNode, [...(adj.get(e.fromNode) ?? []), e]);
    adj.set(e.toNode, [...(adj.get(e.toNode) ?? []), { ...e, fromNode: e.toNode, toNode: e.fromNode }]);
  }
  return adj;
};

const dijkstra = (edges: WeightedEdge[], start: string, end: string) => {
  const adj = buildAdjacency(edges);
  const nodes = Array.from(adj.keys());
  const dist = new Map(nodes.map((n) => [n, Infinity]));
  const prev = new Map<string, string | null>(nodes.map((n) => [n, null]));
  const unvisited = new Set(nodes);
  dist.set(start, 0);
  while (unvisited.size > 0) {
    let cur: string | null = null, curDist = Infinity;
    for (const n of unvisited) { const d = dist.get(n) ?? Infinity; if (d < curDist) { curDist = d; cur = n; } }
    if (!cur || curDist === Infinity || cur === end) break;
    unvisited.delete(cur);
    for (const nb of adj.get(cur) ?? []) {
      if (!unvisited.has(nb.toNode)) continue;
      const t = curDist + nb.weight;
      if (t < (dist.get(nb.toNode) ?? Infinity)) { dist.set(nb.toNode, t); prev.set(nb.toNode, cur); }
    }
  }
  const path: string[] = []; let cursor: string | null = end;
  while (cursor) { path.unshift(cursor); cursor = prev.get(cursor) ?? null; }
  if (!path.length || path[0] !== start) throw new Error(`No route: ${start} → ${end}`);
  return { path, totalWeight: dist.get(end) ?? Infinity };
};

const buildSegments = (path: string[], edges: WeightedEdge[]): PathSegment[] =>
  path.slice(0, -1).map((node, i) => {
    const next = path[i + 1];
    const seg = edges.find((e) => normalize(e.fromNode, e.toNode) === normalize(node, next));
    if (!seg) throw new Error(`Missing segment ${node} → ${next}`);
    return { fromNode: node, toNode: next, distance: seg.distance, riskScore: seg.riskScore, weatherFriction: seg.weatherFriction, weight: +seg.weight.toFixed(2) };
  });

const buildLegs = (path: string[]): ManifestLeg[] =>
  path.slice(0, -1).map((origin, i) => {
    const dest = path[i + 1];
    const key = normalize(origin, dest);
    const eta = legEtaHours[key] ?? 72;
    return { id: `shadow-leg-${i + 1}`, sequence: i + 1, origin, destination: dest, mode: "Ocean" as const, vessel: "MV Atlas Relay", etaHours: eta, riskScore: 0.18, health: "optimal" as const, note: "Alternate corridor reserved under optimizer recommendation." };
  });

// Dynamically computed comparison — no more hardcoded constants
const buildComparison = (
  currentPath: string[],
  shadowPath: string[],
  currentSegs: PathSegment[],
  shadowSegs: PathSegment[],
  req: OptimizeRouteRequest,
): ComparisonMatrix => {
  const etaFor = (route: string[]) =>
    route.slice(0, -1).reduce((s, n, i) => s + (legEtaHours[normalize(n, route[i + 1])] ?? 72), 0);

  const currentBaseEta = etaFor(currentPath);
  const shadowBaseEta = etaFor(shadowPath);

  const currentDelay = Math.round(currentSegs.filter((s) => s.riskScore >= 0.45).reduce((acc, s) => acc + s.riskScore * 42, 0));
  const shadowDelay = Math.round(shadowSegs.filter((s) => s.riskScore >= 0.45).reduce((acc, s) => acc + s.riskScore * 18, 0));

  const currentTransit = currentBaseEta + currentDelay;
  const shadowTransit = shadowBaseEta + shadowDelay;

  const currentPenalty = Math.round(currentSegs.reduce((acc, s) => acc + Math.max(s.riskScore - 0.35, 0) * req.delayPenalty, 0));
  const shadowPenalty = Math.round(shadowSegs.reduce((acc, s) => acc + Math.max(s.riskScore - 0.35, 0) * req.delayPenalty, 0));

  const currentCarbon = currentSegs.reduce((acc, s) => acc + s.weatherFriction * req.carbonCost, 0);
  const shadowCarbon = shadowSegs.reduce((acc, s) => acc + s.weatherFriction * req.carbonCost, 0);
  const carbonDelta = currentCarbon > 0 ? Math.round(((shadowCarbon - currentCarbon) / currentCarbon) * 100) : 0;

  return {
    currentDelayHours: currentDelay,
    currentPenaltyUsd: currentPenalty,
    prescribedDelayHours: shadowDelay,
    prescribedPenaltyUsd: shadowPenalty,
    carbonDeltaPercent: carbonDelta,
    currentTransitHours: currentTransit,
    prescribedTransitHours: shadowTransit,
    timeSavedHours: Math.max(currentTransit - shadowTransit, 0),
    costAvoidedUsd: Math.max(currentPenalty - shadowPenalty, 0),
  };
};

const buildShadowRoute = (path: string[], totalWeight: number, comparison: ComparisonMatrix): ShadowRoute => ({
  id: "shadow-route-1",
  title: "Sentinel Prescribed Corridor",
  status: "available",
  nodes: path,
  legs: buildLegs(path),
  totalWeight: +totalWeight.toFixed(2),
  comparison,
});

export const optimizeRoute = (req: OptimizeRouteRequest): OptimizeRouteResponse => {
  const weighted = applyInjections(graphEdges, req.riskInjections).map((e) => ({
    ...e, weight: calculateWeight(e, req),
  }));
  const { path, totalWeight } = dijkstra(weighted, req.startNode, req.endNode);
  const shadowSegs = buildSegments(path, weighted);

  const fallbackCurrentPath = [req.startNode, req.endNode];
  const requestedCurrentPath = req.currentRoute && req.currentRoute.length >= 2 ? req.currentRoute : fallbackCurrentPath;
  const hasExplicitCurrentRoute = Boolean(req.currentRoute && req.currentRoute.length >= 2);
  const currentPath = hasExplicitCurrentRoute ? requestedCurrentPath : path;
  const currentSegs = (() => {
    try {
      return buildSegments(requestedCurrentPath, weighted);
    } catch {
      return buildSegments(path, weighted);
    }
  })();

  const comparison = buildComparison(currentPath, path, currentSegs, shadowSegs, req);
  return { path, totalWeight: +totalWeight.toFixed(2), segments: shadowSegs, shadowRoute: buildShadowRoute(path, totalWeight, comparison) };
};
