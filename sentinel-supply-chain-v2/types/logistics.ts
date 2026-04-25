export type HealthStatus = "optimal" | "warning" | "critical";
export type DashboardStatus = "Normal" | "Analyzing" | "Rerouted";
export type WorldStateStatus =
  | "idle"
  | "analyzing"
  | "analysis_complete"
  | "rerouted"
  | "error";

export type CargoType = "electronics" | "automotive" | "chemicals" | "bulk" | "perishable" | "luxury";
export type ChaosMode = "single" | "cluster" | "storm";

export interface ShippingHub {
  name: string;
  lat: number;
  lon: number;
}

export interface ManifestLeg {
  id: string;
  sequence: number;
  origin: string;
  destination: string;
  mode: "Ocean" | "Port" | "Rail";
  vessel: string;
  etaHours: number;
  riskScore: number;
  health: HealthStatus;
  note: string;
}

export interface TerminalEntry {
  id: string;
  source: "system" | "signal" | "risk" | "optimizer" | "dispatch" | "cascade";
  tone: "info" | "warning" | "critical" | "success";
  message: string;
  timestamp: string;
}

export interface WorldStateEvent {
  id: string;
  source: TerminalEntry["source"];
  tone: TerminalEntry["tone"];
  message: string;
  createdAt: string;
  hubName?: string | null;
}

export interface HubRiskAnalysis {
  hubName: string;
  lat: number;
  lon: number;
  riskScore: number;
  frictionCoefficient: number;
  reasoningLog: string;
  status: HealthStatus;
  newsSummary: string;
  weatherSummary: string;
  analyzedAt: string;
  sourceErrors: string[];
  cascadeFrom?: string | null;
  cascadeDegree?: number;
}

export interface CascadeWarning {
  hubName: string;
  degree: number;
  originDisruption: string;
  propagatedRisk: number;
  reason: string;
}

export interface RouteExplanation {
  summary: string;
  riskAvoided: string;
  timeSavedRationale: string;
  costLogic: string;
  confidenceScore: number;
  alternativesConsidered: string[];
}

export interface RankedRoute {
  id: string;
  rankLabel: "Best Route" | "Second Best" | "Safest Route";
  nodes: string[];
  etaHours: number;
  costUsd: number;
  riskScore: number;
  carbonIndex: number;
  resilienceScore: number;
  selectionRationale: string;
}

export interface ScenarioComparison {
  id: string;
  title: string;
  disruptedHubs: string[];
  currentDelayHours: number;
  alternateDelayHours: number;
  currentCostDeltaUsd: number;
  alternateCostDeltaUsd: number;
  affectedCurrentHubs: string[];
  affectedAlternateHubs: string[];
}

export interface ChaosConfig {
  chaosHubs: string[];
  severity: number;
  mode: ChaosMode;
}

export interface ScenarioConfig {
  origin: string;
  destination: string;
  cargoType: CargoType;
  priority: "cost" | "speed" | "safety";
  containerCount: number;
}

export interface AnalyzeRouteRequest {
  hubs: string[];
  currentRoute: string[];
  simulateChaos?: boolean;
  chaosHub?: string | null;
  chaosHubs?: string[];
  chaosSeverity?: number;
  chaosMode?: ChaosMode;
}

export interface AnalyzeRouteResponse {
  analysisRunId: string;
  status: "ok" | "degraded";
  analyses: HubRiskAnalysis[];
  compromisedHubs: string[];
  cascadeWarnings: CascadeWarning[];
  warnings: string[];
  worldState: WorldStateDocument;
}

export interface RiskInjection {
  fromNode: string;
  toNode: string;
  riskScore?: number;
  weatherFriction?: number;
  reason: string;
}

export interface OptimizeRouteRequest {
  startNode: string;
  endNode: string;
  currentRoute?: string[];
  fuelCost: number;
  delayPenalty: number;
  carbonCost: number;
  riskInjections: RiskInjection[];
}

export interface PrescriptivePathRequest {
  analysisRunId?: string;
  currentRoute: string[];
  hubAnalyses: HubRiskAnalysis[];
  fuelCost: number;
  delayPenalty: number;
  carbonCost: number;
  cargoType?: CargoType;
  origin?: string;
  destination?: string;
  containerCount?: number;
}

export interface ExplainRerouteRequest {
  currentRoute: string[];
  shadowRoute: string[];
  comparison: ComparisonMatrix;
  compromisedHubs: string[];
  cascadeWarnings?: CascadeWarning[];
}

export interface ExplainRerouteResponse {
  explanation: RouteExplanation;
}

export interface PathSegment {
  fromNode: string;
  toNode: string;
  distance: number;
  riskScore: number;
  weatherFriction: number;
  weight: number;
}

export interface ComparisonMatrix {
  currentDelayHours: number;
  currentPenaltyUsd: number;
  prescribedDelayHours: number;
  prescribedPenaltyUsd: number;
  carbonDeltaPercent: number;
  currentTransitHours: number;
  prescribedTransitHours: number;
  timeSavedHours: number;
  costAvoidedUsd: number;
  currentDistanceNm?: number;
  prescribedDistanceNm?: number;
  roiMultiplier?: number;
}

export interface ShadowRoute {
  id: string;
  title: string;
  status: "available" | "executed";
  nodes: string[];
  legs: ManifestLeg[];
  totalWeight: number;
  comparison: ComparisonMatrix;
}

export interface OptimizeRouteResponse {
  path: string[];
  totalWeight: number;
  segments: PathSegment[];
  shadowRoute: ShadowRoute;
}

export interface PrescriptivePathResponse extends OptimizeRouteResponse {
  analysisRunId: string;
  status: "ok" | "degraded";
  currentRoute: string[];
  currentTransitHours: number;
  prescribedTransitHours: number;
  timeSavedHours: number;
  costAvoidedUsd: number;
  cascadeWarnings: CascadeWarning[];
  warnings: string[];
  worldState: WorldStateDocument;
}

export interface GraphEdge {
  fromNode: string;
  toNode: string;
  distance: number;
  riskScore: number;
  weatherFriction: number;
}

export interface WorldStateDocument {
  analysisRunId: string;
  status: WorldStateStatus;
  currentRoute: string[];
  compromisedHubs: string[];
  cascadeWarnings?: CascadeWarning[];
  analyses: HubRiskAnalysis[];
  terminalEvents: WorldStateEvent[];
  shadowRoute: ShadowRoute | null;
  warnings: string[];
  lastUpdatedAt: string;
  lastError?: string | null;
}
