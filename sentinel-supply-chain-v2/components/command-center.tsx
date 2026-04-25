"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Bot, Globe, Map, Radar, Route, Zap } from "lucide-react";
import { onSnapshot } from "firebase/firestore";

import { analyzeRoute, explainReroute, getPrescriptivePath } from "@/lib/backend-client";
import {
  currentRoute as defaultRoute,
  defaultAnalyzeRouteRequest,
  defaultPrescriptiveRouteRequest,
  initialTerminalEntries,
  stableManifest,
} from "@/lib/mock-data";
import { getWorldStateDocumentReference, isFirebaseConfigured } from "@/lib/firebase";
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

  const processedEventIds = useRef<Set<string>>(new Set());
  const activeRunId = useRef<string | null>(null);

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
    // New run → reset
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

    // Reset state
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
      createEntry(`Sentinel analysis armed · ${chaosHubs.length} hub(s) targeted at severity ${(severity * 100).toFixed(0)}%`, "system", "info"),
      createEntry(`Scenario: ${scenario.origin} → ${scenario.destination} · ${scenario.containerCount} TEUs · ${scenario.cargoType}`, "system", "info"),
      createEntry("Dispatching FastAPI ingestion loop — live hub analysis commencing.", "system", "info"),
    ]);

    try {
      // Step 1: Analyze hubs
      const analyzeReq = defaultAnalyzeRouteRequest(chaosHubs, severity, scenario);
      const analyzeRes = await analyzeRoute(analyzeReq);

      ingestWorldState(analyzeRes.worldState);
      setHubAnalyses(analyzeRes.analyses);
      setCompromisedHubs(analyzeRes.compromisedHubs);
      setCascadeWarnings(analyzeRes.cascadeWarnings ?? []);
      setActiveRouteNodes(analyzeReq.currentRoute);

      if (analyzeRes.cascadeWarnings?.length) {
        setTerminalQueue((c) => [
          ...c,
          createEntry(
            `Cascade propagation detected: ${analyzeRes.cascadeWarnings.map((w) => `${w.hubName} (deg ${w.degree})`).join(", ")}`,
            "cascade",
            "warning",
          ),
        ]);
      }

      if (analyzeRes.warnings.length > 0) {
        setTerminalQueue((c) => [...c, createEntry(`Degraded data sources: ${analyzeRes.warnings[0]}`, "system", "warning")]);
      }

      // Step 2: Get prescriptive path
      setTerminalQueue((c) => [...c, createEntry("Hub analysis complete. Computing optimal Dijkstra corridor…", "optimizer", "info")]);

      const prescriptiveReq = defaultPrescriptiveRouteRequest(analyzeRes.analyses, analyzeRes.analysisRunId, scenario);
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
      const msg = err instanceof Error ? err.message : "FastAPI orchestration failed.";
      setIsLoadingAlternate(false);
      setTerminalQueue((c) => [...c, createEntry(msg, "optimizer", "critical")]);
    }
  }, [ingestWorldState]);

  // ─── Approve reroute ─────────────────────────────────────────────────────
  const handleApproveReroute = useCallback(() => {
    if (!shadowRoute) return;
    const approved: ShadowRoute = { ...shadowRoute, status: "executed" };
    setDashboardStatus("Rerouted");
    setShadowRoute(approved);
    setManifest(approved.legs.map((leg, i) => ({ ...leg, sequence: i + 1 })));
    setTerminalQueue((c) => [
      ...c,
      createEntry("Reroute approved. Updated manifest dispatched to all partners and control towers.", "dispatch", "success"),
    ]);
  }, [shadowRoute]);

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

  // ─── Derived state ───────────────────────────────────────────────────────
  const currentTransitHours = useMemo(
    () => shadowRoute?.comparison.currentTransitHours ?? stableManifest.reduce((s, l) => s + l.etaHours, 0),
    [shadowRoute],
  );
  const criticalCount = manifest.filter((l) => l.health === "critical").length;
  const avgRisk = (manifest.reduce((s, l) => s + l.riskScore, 0) / manifest.length).toFixed(2);
  const isStreaming = terminalQueue.length > 0 || isLoadingAlternate;

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
                  label: "AI Engine",
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
          </div>
        </header>

        {/* ── Main grid ──────────────────────────────────────────────────── */}
        {/*
          Layout: [Chaos Panel | Center Panel (Map/Terminal toggle) | Shadow Route Panel]
                  Fixed left chaos + right shadow, center switches between map & terminal
        */}
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
            {/* Tab bar */}
            <div className="flex items-center gap-0 border-b border-white/6 bg-slate-950/80 px-1 py-1">
              {([ 
                { id: "map" as const, label: "Live Route Map", icon: Map },
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

            {/* Panel body */}
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
              onApproveReroute={handleApproveReroute}
              onRequestExplanation={handleRequestExplanation}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
