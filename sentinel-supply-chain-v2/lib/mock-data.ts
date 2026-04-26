import type {
  AnalyzeRouteRequest,
  CargoType,
  ManifestLeg,
  PrescriptivePathRequest,
  ScenarioConfig,
  ShippingHub,
  TerminalEntry,
} from "@/types/logistics";

const createTimestamp = (offsetMinutes = 0) => {
  const stamp = new Date(Date.now() + offsetMinutes * 60_000);
  return stamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

export const routeHubs: ShippingHub[] = [
  { name: "Shanghai", lat: 31.2304, lon: 121.4737 },
  { name: "Singapore", lat: 1.2644, lon: 103.82 },
  { name: "Suez", lat: 29.9668, lon: 32.5498 },
  { name: "Rotterdam", lat: 51.9244, lon: 4.4777 },
  { name: "Cape Town", lat: -33.9249, lon: 18.4241 },
  { name: "Dubai", lat: 25.2048, lon: 55.2708 },
  { name: "Hamburg", lat: 53.5511, lon: 9.9937 },
  { name: "Mumbai", lat: 18.9667, lon: 72.8333 },
  { name: "Colombo", lat: 6.9271, lon: 79.8612 },
];

export const HUB_COORDINATES: Record<string, [number, number]> = {
  Shanghai: [31.2304, 121.4737],
  Singapore: [1.2644, 103.82],
  Suez: [29.9668, 32.5498],
  Rotterdam: [51.9244, 4.4777],
  "Cape Town": [-33.9249, 18.4241],
  Dubai: [25.2048, 55.2708],
  Hamburg: [53.5511, 9.9937],
  Mumbai: [18.9667, 72.8333],
  Colombo: [6.9271, 79.8612],
};

export const ALL_HUBS = Object.keys(HUB_COORDINATES);

export const currentRoute = ["Shanghai", "Singapore", "Suez", "Rotterdam"];

export const PRESET_SCENARIOS: ScenarioConfig[] = [
  { origin: "Shanghai", destination: "Rotterdam", cargoType: "electronics", priority: "speed", containerCount: 200 },
  { origin: "Shanghai", destination: "Hamburg", cargoType: "automotive", priority: "safety", containerCount: 150 },
  { origin: "Mumbai", destination: "Rotterdam", cargoType: "chemicals", priority: "safety", containerCount: 80 },
  { origin: "Singapore", destination: "Hamburg", cargoType: "bulk", priority: "cost", containerCount: 500 },
];

export const CARGO_LABELS: Record<CargoType, string> = {
  electronics: "Electronics (High-Value)",
  automotive: "Automotive Parts",
  chemicals: "Chemicals (Hazmat)",
  bulk: "Bulk Commodities",
  perishable: "Perishables",
  luxury: "Luxury Goods",
};

export const stableManifest: ManifestLeg[] = [
  { id: "leg-1", sequence: 1, origin: "Shanghai", destination: "Singapore", mode: "Ocean", vessel: "MV Meridian", etaHours: 28, riskScore: 0.14, health: "optimal", note: "Origin containers sealed and transshipment berth confirmed." },
  { id: "leg-2", sequence: 2, origin: "Singapore", destination: "Suez", mode: "Ocean", vessel: "MV Meridian", etaHours: 86, riskScore: 0.19, health: "optimal", note: "Canal entry window confirmed with standard congestion buffer." },
  { id: "leg-3", sequence: 3, origin: "Suez", destination: "Rotterdam", mode: "Ocean", vessel: "MV Meridian", etaHours: 104, riskScore: 0.23, health: "optimal", note: "North Sea slot reservation held under current plan." },
];

export const initialTerminalEntries: TerminalEntry[] = [
  { id: "terminal-boot", source: "system", tone: "success", message: "Sentinel v2.0 · Global Supply Chain Intelligence Platform online.", timestamp: createTimestamp(-2) },
  { id: "terminal-net", source: "signal", tone: "info", message: `NetworkX graph initialized with ${ALL_HUBS.length} hubs · live risk graph armed.`, timestamp: createTimestamp(-1) },
  { id: "terminal-ready", source: "optimizer", tone: "info", message: "System optimal. Select a scenario or inject chaos to begin analysis.", timestamp: createTimestamp(0) },
];

export const defaultAnalyzeRouteRequest = (
  chaosHubs: string[],
  chaosSeverity: number,
  scenario?: ScenarioConfig,
): AnalyzeRouteRequest => {
  const route = scenario
    ? buildRouteForScenario(scenario)
    : currentRoute;
  return {
    hubs: route,
    currentRoute: route,
    simulateChaos: chaosHubs.length > 0,
    chaosHub: chaosHubs[0] ?? null,
    chaosHubs,
    chaosSeverity,
    chaosMode: chaosHubs.length >= 2 ? "cluster" : "single",
  };
};

export const defaultPrescriptiveRouteRequest = (
  hubAnalyses: PrescriptivePathRequest["hubAnalyses"],
  analysisRunId?: string,
  scenario?: ScenarioConfig,
): PrescriptivePathRequest => ({
  analysisRunId,
  currentRoute: scenario ? buildRouteForScenario(scenario) : currentRoute,
  hubAnalyses,
  fuelCost: 0.82,
  delayPenalty: 14_000,
  carbonCost: 5_000,
  cargoType: scenario?.cargoType ?? "bulk",
  containerCount: scenario?.containerCount ?? 1,
  origin: scenario?.origin,
  destination: scenario?.destination,
});

function buildRouteForScenario(scenario: ScenarioConfig): string[] {
  const routes: Record<string, string[]> = {
    "Shanghai-Rotterdam": ["Shanghai", "Singapore", "Suez", "Rotterdam"],
    "Shanghai-Hamburg": ["Shanghai", "Singapore", "Suez", "Rotterdam", "Hamburg"],
    "Mumbai-Rotterdam": ["Mumbai", "Dubai", "Suez", "Rotterdam"],
    "Singapore-Hamburg": ["Singapore", "Suez", "Rotterdam", "Hamburg"],
    "Shanghai-Singapore": ["Shanghai", "Singapore"],
  };
  const key = `${scenario.origin}-${scenario.destination}`;
  return routes[key] ?? ["Shanghai", "Singapore", "Suez", "Rotterdam"];
}
