"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Bot, Globe, Map as MapIcon, Radar, Route, Zap } from "lucide-react";
import { onSnapshot } from "firebase/firestore";

import { analyzeRoute, analyzeRouteStream, explainReroute, getPrescriptivePath } from "@/lib/backend-client";
import type { StreamLogPayload } from "@/lib/backend-client";
import {
  currentRoute as defaultRoute,
  defaultAnalyzeRouteRequest,
  defaultPrescriptiveRouteRequest,
  initialTerminalEntries,
  stableManifest,
} from "@/lib/mock-data";
import { getWorldStateDocumentReference, isFirebaseConfigured } from "@/lib/firebase";
import { compareDisruptionScenarios, rankRoutes } from "@/lib/route-intelligence";
import { ManifestPanel } from "@/components/manifest-panel";
import { ShadowRoutePanel } from "@/components/shadow-route-panel";
import { TerminalPanel } from "@/components/terminal-panel";
import { MapPanel } from "@/components/map-panel";
import { ChaosPanel } from "@/components/chaos-panel";
import type {
  CascadeWarning,
  ChaosMode,
  DashboardStatus,
  HubRiskAnalysis,
  ManifestLeg,
  PrescriptivePathResponse,
  RouteExplanation,
  ScenarioComparison,
  RankedRoute,
  ScenarioConfig,
  ShadowRoute,
  TerminalEntry,
  WorldStateDocument,
  WorldStateEvent,
  WorldStateStatus,
} from "@/types/logistics";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const createEntry = (
  message: string,
  source: TerminalEntry["source"],
  tone: TerminalEntry["tone"],
): TerminalEntry => ({
  id: `${source}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  source,
  tone,
  message,
  timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
});

const cloneEntries = (entries: TerminalEntry[]): TerminalEntry[] =>
  entries.map((e, i) => ({ ...e, id: `${e.id}-clone-${i}` }));

const worldStatusToDashboard = (status: WorldStateStatus): DashboardStatus => {
  if (status === "rerouted") return "Rerouted";
  if (status === "analyzing" || status === "analysis_complete" || status === "error") return "Analyzing";
  return "Normal";
};

const eventToEntry = (ev: WorldStateEvent): TerminalEntry => ({
  id: ev.id,
  source: ev.source as TerminalEntry["source"],
  tone: ev.tone as TerminalEntry["tone"],
  message: ev.message,
  timestamp: new Date(ev.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
});

const applyAnalysesToManifest = (base: ManifestLeg[], analyses: HubRiskAnalysis[]): ManifestLeg[] => {
  const map = new Map(analyses.map((a) => [a.hubName, a]));
  return base.map((leg) => {
    const dest = map.get(leg.destination);
    const orig = map.get(leg.origin);
    if (!dest && !orig) return leg;
    const dominant = dest ?? orig!;
    const health = (dest?.status ?? orig?.status ?? leg.health) as ManifestLeg["health"];
    return { ...leg, riskScore: Math.max(leg.riskScore, dominant.riskScore), health, note: dominant.reasoningLog };
  });
};

// ─── Component ────────────────────────────────────────────────────────────────

type ActivePanel = "map" | "terminal";

export function CommandCenter() {
  // ✅ RESOLVED: use codex values — 60s interval + quota cap (not 15s + no cap from main)
  const monitoringIntervalMs = 60_000;
  const maxMonitoringCalls = 3;

  const [dashboardStatus, setDashboardStatus] = useState<DashboardStatus>("Normal");
  const [manifest, setManifest] = useState<ManifestLeg[]>(stableManifest);
  const [terminalLines, setTerminalLines] = useState<TerminalEntry[]>(initialTerminalEntries);
  const [terminalQueue, setTerminalQueue] = useState<TerminalEntry[]>([]);
  const [shadowRoute, setShadowRoute] = useState<ShadowRoute | null>(null);
  const [isAlternateVisible, setIsAlternateVisible] = useState(false);
  const [isLoadingAlternate, setIsLoadingAlternate] = useState(false);
  const [activeRouteNodes, setActiveRouteNodes] = useState<string[]>(defaultRoute);
  const [shadowRouteNodes, setShadowRouteNodes] = useState<string[] | null>(null);
  const [hubAnalyses, setHubAnalyses] = useState<HubRiskAnalysis[]>([]);
  const [compromisedHubs, setCompromisedHubs] = useState<string[]>([]);
  const [cascadeWarnings, setCascadeWarnings] = useState<CascadeWarning[]>([]);
  const [explanation, setExplanation] = useState<RouteExplanation | null>(null);
  const [isLoadingExplanation, setIsLoadingExplanation] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>("map");

  // ✅ RESOLVED: use codex — OFF by default + call counter (not ON with no counter from main)
  const [monitoringMode, setMonitoringMode] = useState(false);
  const [monitoringCallCount, setMonitoringCallCount] = useState(0);

  const [lastScenario, setLastScenario] = useState<ScenarioConfig>({
    origin: "Shanghai",
    destination: "Rotterdam",
    cargoType: "electronics",
    priority: "speed",
    containerCount: 200,
  });

  const processedEventIds = useRef<Set<string>>(new Set());
  const activeRunId = useRef<string | null>(null);
  const activeStream = useRef<AbortController | null>(null);

  // ─── Terminal queue drain ────────────────────────────────────────────────
  useEffect(() => {
    if (terminalQueue.length === 0) return;
    const timer = setTimeout(() => {
      setTerminalLines((c) => [...c, terminalQueue[0]]);
      setTerminalQueue((c) => c.slice(1));
    }, 480);
    return () => clearTimeout(timer);
  }, [terminalQueue]);

  // ─── World state ingestion ───────────────────────────────────────────────
  const ingestWorldState = useCallback((ws: WorldStateDocument) => {
    if (activeRunId.current !== ws.analysisRunId) {
      activeRunId.current = ws.analysisRunId;
      processedEventIds.current = new Set();
      setTerminalLines(cloneEntries(initialTerminalEntries));
      setTerminalQueue([]);
      setShadowRoute(null);
      setShadowRouteNodes(null);
      setIsAlternateVisible(false);
      setExplanation(null);
    }

    setDashboardStatus(worldStatusToDashboard(ws.status));

    if (ws.analyses.length > 0) {
      setHubAnalyses(ws.analyses);
      setManifest(applyAnalysesToManifest(stableManifest, ws.analyses));
      setCompromisedHubs(ws.compromisedHubs);
      setCascadeWarnings(ws.cascadeWarnings ?? []);
    }

    if (ws.shadowRoute) {
      setShadowRoute(ws.shadowRoute);
      setShadowRouteNodes(ws.shadowRoute.nodes);
      setIsAlternateVisible(true);
      setIsLoadingAlternate(false);
    }

    const unseen = ws.terminalEvents.filter((e) => {
      if (processedEventIds.current.has(e.id)) return false;
      processedEventIds.current.add(e.id);
      return true;
    });
    if (unseen.length > 0) {
      setTerminalQueue((c) => [...c, ...unseen.map(eventToEntry)]);
    }

    if (ws.lastError) {
      setTerminalQueue((c) => [...c, createEntry(ws.lastError!, "system", "critical")]);
    }
  }, []);

  // ─── Firestore live sync ─────────────────────────────────────────────────
  useEffect(() => {
    const ref = getWorldStateDocumentReference();
    if (!ref || !isFirebaseConfigured) return;
    return onSnapshot(
      ref,
      (snap) => { const d = snap.data(); if (d) ingestWorldState(d as WorldStateDocument); },
      (err) => setTerminalQueue((c) => [...c, createEntry(`Firestore degraded: ${err.message}`, "system", "warning")]),
    );
  }, [ingestWorldState]);

  // ─── Main simulation ─────────────────────────────────────────────────────
  const handleSimulate = useCallback(async (params: {
    chaosHubs: string[];
    severity: number;
    mode: ChaosMode;
    scenario: ScenarioConfig;
  }) => {
    const { chaosHubs, severity, scenario } = params;
    setLastScenario(scenario);

    // Cancel any running stream
    activeStream.current?.abort();
    activeStream.current = null;

    processedEventIds.current = new Set();
    activeRunId.current = null;
    setDashboardStatus("Analyzing");
    setManifest(stableManifest);
    setTerminalLines(cloneEntries(initialTerminalEntries));
    setShadowRoute(null);
    setShadowRouteNodes(null);
    setIsAlternateVisible(false);
    setIsLoadingAlternate(true);
    setHubAnalyses([]);
    setCompromisedHubs([]);
    setCascadeWarnings([]);
    setExplanation(null);

    setTerminalQueue([
      createEntry(`Sentinel stream armed · ${chaosHubs.length} hub(s) at severity ${(severity * 100).toFixed(0)}%`, "system", "info"),
      createEntry(`Scenario: ${scenario.origin} → ${scenario.destination} · ${scenario.containerCount} TEUs · ${scenario.cargoType}`, "system", "info"),
      createEntry("Opening SSE stream — live hub analysis commencing.", "system", "info"),
    ]);

    const analyzeReq = defaultAnalyzeRouteRequest(chaosHubs, severity, scenario);

    // Accumulate analyses from the stream so we can feed them into Phase 2
    const streamedAnalyses: HubRiskAnalysis[] = [];
    let streamRunId: string | null = null;
    let streamCompromised: string[] = [];

    await new Promise<void>((resolve) => {
      const controller = analyzeRouteStream(analyzeReq, {
        onLog: (payload: StreamLogPayload) => {
          setTerminalQueue((c) => [
            ...c,
            createEntry(
              payload.message,
              payload.source as TerminalEntry["source"],
              payload.tone as TerminalEntry["tone"],
            ),
          ]);
        },
        onAnalysis: (analysis: HubRiskAnalysis, runId: string) => {
          streamRunId = runId;
          streamedAnalyses.push(analysis);
          // Incrementally update the map as each hub resolves
          setHubAnalyses([...streamedAnalyses]);
          setManifest(applyAnalysesToManifest(stableManifest, streamedAnalyses));
        },
        onComplete: (payload, runId) => {
          streamRunId = runId;
          streamCompromised = (payload.compromised_hubs as string[]) ?? [];
          setCompromisedHubs(streamCompromised);
          resolve();
        },
        onError: (message) => {
          setTerminalQueue((c) => [...c, createEntry(`Stream error: ${message}`, "system", "critical")]);
          setIsLoadingAlternate(false);
          resolve();
        },
      });
      activeStream.current = controller;
    });

    // Phase 2: Dijkstra optimisation (regular POST — fast, no streaming needed)
    if (streamedAnalyses.length === 0) {
      setIsLoadingAlternate(false);
      return;
    }

    try {
      setTerminalQueue((c) => [...c, createEntry("Hub analysis complete. Computing optimal Dijkstra corridor…", "optimizer", "info")]);

      setActiveRouteNodes(analyzeReq.currentRoute);
      const prescriptiveReq = defaultPrescriptiveRouteRequest(streamedAnalyses, streamRunId ?? undefined, scenario);
      const prescriptiveRes: PrescriptivePathResponse = await getPrescriptivePath(prescriptiveReq);

      ingestWorldState(prescriptiveRes.worldState);
      setShadowRoute(prescriptiveRes.shadowRoute);
      setShadowRouteNodes(prescriptiveRes.shadowRoute.nodes);
      setIsAlternateVisible(true);
      setIsLoadingAlternate(false);

      const comparison = prescriptiveRes.shadowRoute.comparison;
      setTerminalQueue((c) => [
        ...c,
        createEntry(
          `Prescribed corridor: ${prescriptiveRes.shadowRoute.nodes.join(" → ")} · ${comparison.timeSavedHours}h saved · $${comparison.costAvoidedUsd.toLocaleString()} penalty eliminated`,
          "dispatch",
          "success",
        ),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "FastAPI optimisation failed.";
      setIsLoadingAlternate(false);
      setTerminalQueue((c) => [...c, createEntry(msg, "optimizer", "critical")]);
    }
  }, [ingestWorldState]);

  // ─── Approve reroute ─────────────────────────────────────────────────────
  const handleApproveReroute = useCallback(() => {
    if (!shadowRoute) return;
    const previousRoute = activeRouteNodes.join(" → ");
    const approvedRoute = shadowRoute.nodes.join(" → ");
    const approved: ShadowRoute = { ...shadowRoute, status: "executed" };
    setDashboardStatus("Rerouted");
    setShadowRoute(approved);
    setManifest(approved.legs.map((leg, i) => ({ ...leg, sequence: i + 1 })));
    setActiveRouteNodes(approved.nodes);
    setShadowRouteNodes(null);
    setIsAlternateVisible(false);
    setCompromisedHubs([]);
    setCascadeWarnings([]);
    setTerminalQueue((c) => [
      ...c,
      createEntry(`State transition: ACTIVE_ROUTE_SWITCHED (${previousRoute} → ${approvedRoute}).`, "dispatch", "success"),
      createEntry("Reroute approved. Updated manifest dispatched to all partners and control towers.", "dispatch", "success"),
    ]);
  }, [activeRouteNodes, shadowRoute]);

  // ─── AI Explanation ──────────────────────────────────────────────────────
  const handleRequestExplanation = useCallback(async () => {
    if (!shadowRoute || !shadowRouteNodes || isLoadingExplanation) return;
    setIsLoadingExplanation(true);
    try {
      const res = await explainReroute({
        currentRoute: activeRouteNodes,
        shadowRoute: shadowRouteNodes,
        comparison: shadowRoute.comparison,
        compromisedHubs,
        cascadeWarnings,
      });
      setExplanation(res.explanation);
    } catch {
      setExplanation({
        summary: "Rerouting eliminates direct exposure to compromised hubs by switching to the lowest-weight Dijkstra path across the live risk graph.",
        riskAvoided: "Bypasses disrupted hubs where risk-weighted edge costs exceed viable thresholds.",
        timeSavedRationale: `Removing ${shadowRoute.comparison.currentDelayHours - shadowRoute.comparison.prescribedDelayHours}h of expected delay at high-risk legs.`,
        costLogic: `Penalty exposure drops by $${shadowRoute.comparison.costAvoidedUsd.toLocaleString()} by routing below the 0.35 risk threshold.`,
        confidenceScore: 0.84,
        alternativesConsidered: ["Cape of Good Hope bypass", "Dubai relay", "Current route with delay buffer"],
      });
    } finally {
      setIsLoadingExplanation(false);
    }
  }, [shadowRoute, shadowRouteNodes, activeRouteNodes, compromisedHubs, cascadeWarnings, isLoadingExplanation]);

  // ─── Continuous monitoring ───────────────────────────────────────────────
  // ✅ RESOLVED: use codex — includes quota cap check (not the uncapped main version)
  useEffect(() => {
    if (!monitoringMode || dashboardStatus === "Analyzing") return;
    if (monitoringCallCount >= maxMonitoringCalls) {
      setMonitoringMode(false);
      setTerminalQueue((c) => [...c, createEntry("Monitoring quota reached. Manual trigger required.", "system", "warning")]);
      return;
    }
    const timer = setInterval(async () => {
      try {
        setMonitoringCallCount((count) => count + 1);
        const analyzeReq = defaultAnalyzeRouteRequest([], 0, lastScenario);
        analyzeReq.currentRoute = activeRouteNodes;
        analyzeReq.hubs = activeRouteNodes;

        const analyzeRes = await analyzeRoute(analyzeReq);
        setHubAnalyses(analyzeRes.analyses);
        setCompromisedHubs(analyzeRes.compromisedHubs);
        setCascadeWarnings(analyzeRes.cascadeWarnings ?? []);
        setManifest((currentManifest) => applyAnalysesToManifest(currentManifest, analyzeRes.analyses));
        setTerminalQueue((c) => [
          ...c,
          createEntry(`Monitoring tick complete · ${analyzeRes.analyses.length} hubs re-evaluated.`, "system", "info"),
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Monitoring refresh failed.";
        setTerminalQueue((c) => [...c, createEntry(`Monitoring degraded: ${message}`, "system", "warning")]);
      }
    }, monitoringIntervalMs);

    return () => clearInterval(timer);
  // ✅ RESOLVED: use codex dependency array (includes monitoringCallCount + maxMonitoringCalls)
  }, [activeRouteNodes, dashboardStatus, lastScenario, maxMonitoringCalls, monitoringCallCount, monitoringIntervalMs, monitoringMode]);

  // ─── Derived state ───────────────────────────────────────────────────────
  const currentTransitHours = useMemo(
    () => shadowRoute?.comparison.currentTransitHours ?? stableManifest.reduce((s, l) => s + l.etaHours, 0),
    [shadowRoute],
  );
  const criticalCount = manifest.filter((l) => l.health === "critical").length;
  const avgRisk = (manifest.reduce((s, l) => s + l.riskScore, 0) / manifest.length).toFixed(2);
  const isStreaming = terminalQueue.length > 0 || isLoadingAlternate;
  const rankedRoutes: RankedRoute[] = useMemo(
    () => rankRoutes(activeRouteNodes, shadowRouteNodes, hubAnalyses),
    [activeRouteNodes, shadowRouteNodes, hubAnalyses],
  );

  // ✅ RESOLVED: use codex — passes hubAnalyses + cargo multiplier (not the bare call from main)
  const scenarioComparisons: ScenarioComparison[] = useMemo(
    () => compareDisruptionScenarios(activeRouteNodes, shadowRouteNodes, hubAnalyses, 14_000, lastScenario.containerCount >= 250 ? 1.4 : 1.0),
    [activeRouteNodes, shadowRouteNodes, hubAnalyses, lastScenario.containerCount],
  );

  const currentResilienceScore = rankedRoutes.find((route) => route.nodes.join("→") === activeRouteNodes.join("→"))?.resilienceScore
    ?? rankedRoutes[0]?.resilienceScore
    ?? 62;
  const shadowResilienceScore = rankedRoutes.find((route) => route.nodes.join("→") === (shadowRouteNodes ?? []).join("→"))?.resilienceScore
    ?? rankedRoutes[1]?.resilienceScore
    ?? currentResilienceScore;

  return (
    <main className="h-screen overflow-hidden bg-slate-950 px-3 py-3 sm:px-4 lg:px-6">
      <div className="mx-auto grid h-full max-w-[1900px] grid-rows-[auto_minmax(0,1fr)] gap-3">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="war-panel p-4">
          <div className="relative z-10 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10">
                <Radar className="h-5 w-5 text-violet-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight text-slate-50">
                    Sentinel
                  </h1>
                  <span className="rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-violet-300">
                    v2.0
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Global Supply Chain Intelligence Platform · FastAPI + Gemini + NetworkX + Firestore
                </p>
              </div>
            </div>

            {/* KPI strip */}
            <div className="flex flex-col gap-2 xl:items-end">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                {
                  icon: Activity,
                  label: "Status",
                  value: dashboardStatus,
                  sub: `${criticalCount} critical leg(s)`,
                  color: dashboardStatus === "Rerouted" ? "text-violet-300" : dashboardStatus === "Analyzing" ? "text-amber-300" : criticalCount > 0 ? "text-red-300" : "text-emerald-300",
                },
                {
                  icon: Bot,
                  label: "Decision Engine",
                  value: isStreaming ? "Processing" : "Monitoring",
                  sub: `Network risk ${avgRisk}`,
                  color: isStreaming ? "text-amber-300" : "text-slate-200",
                },
                {
                  icon: Route,
                  label: "Shadow Route",
                  value: shadowRoute ? (dashboardStatus === "Rerouted" ? "Approved" : "Ready") : "Standby",
                  sub: shadowRoute ? shadowRoute.nodes.join(" → ") : "Awaiting analysis",
                  color: shadowRoute ? "text-violet-300" : "text-slate-500",
                },
                {
                  icon: Globe,
                  label: "Cascade Alerts",
                  value: cascadeWarnings.length > 0 ? `${cascadeWarnings.length} Active` : "Clear",
                  sub: cascadeWarnings.length > 0 ? cascadeWarnings.map((w) => w.hubName).join(", ") : "No downstream effects",
                  color: cascadeWarnings.length > 0 ? "text-amber-300" : "text-slate-500",
                },
              ].map(({ icon: Icon, label, value, sub, color }) => (
                <div key={label} className="rounded-xl border border-white/8 bg-slate-950/50 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-1">
                    <Icon className="h-3 w-3" />
                    {label}
                  </div>
                  <div className={`text-base font-bold ${color}`}>{value}</div>
                  <p className="mt-0.5 text-[10px] text-slate-600 truncate">{sub}</p>
                </div>
              ))}
              </div>
              {/* ✅ RESOLVED: shows call count from codex (not bare ON/OFF from main) */}
              <button
                onClick={() => setMonitoringMode((value) => !value)}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                  monitoringMode
                    ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                    : "border-white/10 bg-slate-950/50 text-slate-400"
                }`}
              >
                {monitoringMode
                  ? `Monitoring Mode: ON (${Math.min(monitoringCallCount, maxMonitoringCalls)}/${maxMonitoringCalls})`
                  : "Monitoring Mode: OFF"}
              </button>
            </div>
          </div>
        </header>

        {/* ── Main grid ──────────────────────────────────────────────────── */}
        <div className="grid min-h-0 gap-3 xl:grid-cols-[260px_minmax(0,1fr)_300px]">

          {/* LEFT: Chaos engine + manifest */}
          <div className="flex min-h-0 flex-col gap-3">
            <div className="min-h-0 flex-1 overflow-hidden rounded-3xl">
              <ChaosPanel isBusy={dashboardStatus === "Analyzing"} onSimulate={handleSimulate} />
            </div>
            <div className="h-[40%] min-h-0 overflow-hidden rounded-3xl">
              <ManifestPanel
                manifest={manifest}
                dashboardStatus={dashboardStatus}
                isBusy={dashboardStatus === "Analyzing"}
              />
            </div>
          </div>

          {/* CENTER: Map / Terminal toggle */}
          <div className="flex min-h-0 flex-col gap-0 overflow-hidden rounded-3xl border border-white/6 bg-slate-950/60">
            <div className="flex items-center gap-0 border-b border-white/6 bg-slate-950/80 px-1 py-1">
              {([
                { id: "map" as const, label: "Live Route Map", icon: MapIcon },
                { id: "terminal" as const, label: "Intelligence Feed", icon: Bot },
              ]).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActivePanel(id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-medium transition-all ${
                    activePanel === id
                      ? "bg-slate-800 text-slate-100 shadow-sm"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  {id === "terminal" && isStreaming && (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                  {id === "map" && cascadeWarnings.length > 0 && (
                    <span className="rounded-full bg-amber-500/20 px-1.5 text-[9px] font-bold text-amber-300">
                      {cascadeWarnings.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1">
              {activePanel === "map" ? (
                <MapPanel
                  currentRoute={activeRouteNodes}
                  shadowRoute={shadowRouteNodes}
                  analyses={hubAnalyses}
                  cascadeWarnings={cascadeWarnings}
                  compromisedHubs={compromisedHubs}
                  isLoading={isLoadingAlternate}
                />
              ) : (
                <TerminalPanel
                  entries={terminalLines}
                  dashboardStatus={dashboardStatus}
                  isStreaming={isStreaming}
                />
              )}
            </div>
          </div>

          {/* RIGHT: Shadow route panel */}
          <div className="min-h-0 overflow-hidden rounded-3xl">
            <ShadowRoutePanel
              dashboardStatus={dashboardStatus}
              shadowRoute={shadowRoute}
              isVisible={isAlternateVisible}
              isLoading={isLoadingAlternate}
              currentRouteNodes={activeRouteNodes}
              currentTransitHours={currentTransitHours}
              cascadeWarnings={cascadeWarnings}
              explanation={explanation}
              isLoadingExplanation={isLoadingExplanation}
              rankedRoutes={rankedRoutes}
              scenarioComparisons={scenarioComparisons}
              currentResilienceScore={currentResilienceScore}
              shadowResilienceScore={shadowResilienceScore}
              onApproveReroute={handleApproveReroute}
              onRequestExplanation={handleRequestExplanation}
            />
          </div>
        </div>
      </div>
    </main>
  );
}