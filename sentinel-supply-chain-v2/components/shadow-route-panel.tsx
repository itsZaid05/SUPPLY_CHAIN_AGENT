"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  GitBranch,
  Loader2,
  Route,
  Scale,
  Sparkles,
  TrendingDown,
  Clock,
  DollarSign,
  Leaf,
} from "lucide-react";
import type {
  CascadeWarning,
  DashboardStatus,
  RankedRoute,
  RouteExplanation,
  ScenarioComparison,
  ShadowRoute,
} from "@/types/logistics";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const counterMemory = new Map<string, number>();

interface AnimatedCounterProps {
  memoryKey: string;
  value: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

function AnimatedCounter({ memoryKey, value, prefix = "", suffix = "", className = "" }: AnimatedCounterProps) {
  const initial = counterMemory.get(memoryKey) ?? value;
  const [display, setDisplay] = useState(initial);
  const prevRef = useRef(initial);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    const diff = end - start;
    const duration = 1200;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + diff * eased));
      if (progress < 1) requestAnimationFrame(tick);
      else {
        prevRef.current = end;
        counterMemory.set(memoryKey, end);
      }
    };

    requestAnimationFrame(tick);
  }, [memoryKey, value]);

  return (
    <span className={className}>
      {prefix}{display.toLocaleString()}{suffix}
    </span>
  );
}

interface ShadowRoutePanelProps {
  dashboardStatus: DashboardStatus;
  shadowRoute: ShadowRoute | null;
  isVisible: boolean;
  isLoading: boolean;
  currentRouteNodes: string[];
  currentTransitHours: number;
  cascadeWarnings: CascadeWarning[];
  explanation: RouteExplanation | null;
  isLoadingExplanation: boolean;
  rankedRoutes: RankedRoute[];
  scenarioComparisons: ScenarioComparison[];
  currentResilienceScore: number;
  shadowResilienceScore: number;
  onApproveReroute: () => void;
  onRequestExplanation: () => void;
}

export function ShadowRoutePanel({
  dashboardStatus,
  shadowRoute,
  isVisible,
  isLoading,
  currentRouteNodes,
  currentTransitHours,
  cascadeWarnings,
  explanation,
  isLoadingExplanation,
  rankedRoutes,
  scenarioComparisons,
  currentResilienceScore,
  shadowResilienceScore,
  onApproveReroute,
  onRequestExplanation,
}: ShadowRoutePanelProps) {
  const [showExplanation, setShowExplanation] = useState(false);
  const comparison = shadowRoute?.comparison;
  const proposedTransitHours = comparison?.prescribedTransitHours ?? shadowRoute?.legs.reduce((t, l) => t + l.etaHours, 0) ?? 0;
  const isApproved = dashboardStatus === "Rerouted";

  const costAvoided = comparison?.costAvoidedUsd ?? 0;
  const timeSaved = comparison?.timeSavedHours ?? 0;
  const carbonDelta = comparison?.carbonDeltaPercent ?? 0;
  const roiMultiplier = comparison?.roiMultiplier ?? 1;

  return (
    <section className="war-panel h-full overflow-y-auto p-4">
      <div className="relative z-10 flex h-full flex-col gap-4">
        {/* Header */}
        <div className="space-y-1">
          <span className="status-chip">
            <GitBranch className="h-3.5 w-3.5 text-violet-300" />
            Prescriptive Alternate
          </span>
          <h2 className="text-base font-semibold text-slate-50">Shadow Route</h2>
          <p className="text-xs text-slate-500">
            Prescriptive decision corridor activated after live hub analysis.
          </p>
        </div>

        {/* Empty state */}
        {!isVisible && !isLoading && (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-slate-950/30 p-6 text-center">
            <div className="space-y-2">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5">
                <Scale className="h-5 w-5 text-slate-500" />
              </div>
              <h3 className="text-sm font-semibold text-slate-200">System Optimal</h3>
              <p className="text-xs text-slate-500">Awaiting deviations from chaos engine.</p>
            </div>
          </div>
        )}

        {/* Loading state */}
        {(isLoading && !shadowRoute) && (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-cyan-400/15 bg-slate-950/35 p-5">
            <div className="text-center space-y-3">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-cyan-400" />
              <p className="text-sm text-cyan-200">Assembling shadow corridor…</p>
              <p className="text-xs text-cyan-400/60">NetworkX Dijkstra running with live risk weights</p>
            </div>
          </div>
        )}

        {/* ROI Hero Card */}
        {shadowRoute && costAvoided > 0 && (
          <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 via-slate-950/60 to-teal-500/8 p-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-emerald-400/70 mb-2">
              Penalty Risk Eliminated
            </div>
            <div className="flex items-baseline gap-1">
              <AnimatedCounter
                memoryKey="shadow-cost-avoided"
                value={costAvoided}
                prefix="$"
                className="text-3xl font-bold text-emerald-300 tabular-nums"
              />
            </div>
            <div className="mt-1 flex items-center gap-1 text-xs text-emerald-400/70">
              <TrendingDown className="h-3.5 w-3.5" />
              {roiMultiplier > 1 ? `${roiMultiplier.toFixed(1)}× ROI on rerouting cost` : "Breakeven or better"}
            </div>
          </div>
        )}

        {/* Comparison metrics */}
        {shadowRoute && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-white/8 bg-slate-900/50 p-2.5 text-center">
              <Clock className="mx-auto h-4 w-4 text-violet-400 mb-1" />
              <AnimatedCounter memoryKey="shadow-time-saved" value={timeSaved} suffix="h" className="text-lg font-bold text-violet-300 block" />
              <div className="text-[10px] text-slate-500">Saved</div>
            </div>
            <div className="rounded-xl border border-white/8 bg-slate-900/50 p-2.5 text-center">
              <DollarSign className="mx-auto h-4 w-4 text-amber-400 mb-1" />
              <AnimatedCounter memoryKey="shadow-current-penalty" value={comparison?.currentPenaltyUsd ?? 0} prefix="$" className="text-lg font-bold text-amber-300 block" />
              <div className="text-[10px] text-slate-500">Old risk</div>
            </div>
            <div className="rounded-xl border border-white/8 bg-slate-900/50 p-2.5 text-center">
              <Leaf className="mx-auto h-4 w-4 text-teal-400 mb-1" />
              <span className={`text-lg font-bold block ${carbonDelta <= 0 ? "text-teal-300" : "text-red-300"}`}>
                {carbonDelta > 0 ? "+" : ""}{carbonDelta}%
              </span>
              <div className="text-[10px] text-slate-500">Carbon</div>
            </div>
          </div>
        )}

        {/* Resilience scorecards */}
        {(shadowRoute || rankedRoutes.length > 0) && (
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-cyan-300/80">
              Resilience Score
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/10 bg-slate-900/50 p-2">
                <div className="text-[10px] text-slate-500">Current route</div>
                <div className="text-lg font-bold text-slate-200">{currentResilienceScore}</div>
              </div>
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/8 p-2">
                <div className="text-[10px] text-emerald-300/80">Shadow route</div>
                <div className="text-lg font-bold text-emerald-300">{shadowResilienceScore}</div>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-cyan-200/70">
              Blend of disruption risk, delay variance, and fallback corridor coverage.
            </p>
          </div>
        )}

        {/* Top-3 route ranking */}
        {rankedRoutes.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Top Route Rankings
            </div>
            {rankedRoutes.slice(0, 3).map((route) => (
              <div key={route.id} className="rounded-xl border border-white/10 bg-slate-900/45 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-violet-300">{route.rankLabel}</span>
                  <span className="text-[10px] text-slate-500">Resilience {route.resilienceScore}</span>
                </div>
                <div className="mt-1 truncate text-xs text-slate-200">{route.nodes.join(" → ")}</div>
                <div className="mt-1 grid grid-cols-4 gap-1 text-[10px] text-slate-400">
                  <span>Risk {(route.riskScore * 100).toFixed(0)}%</span>
                  <span>ETA {route.etaHours}h</span>
                  <span>Cost {currency.format(route.costUsd)}</span>
                  <span>Carbon {route.carbonIndex}</span>
                </div>
                <p className="mt-1 text-[10px] text-slate-500">{route.selectionRationale}</p>
              </div>
            ))}
          </div>
        )}

        {/* Route comparison */}
        {shadowRoute && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/6 p-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-red-400/70">Current (Compromised)</div>
                <div className="mt-0.5 truncate text-xs font-medium text-slate-300">{currentRouteNodes.join(" → ")}</div>
                <div className="mt-0.5 text-[10px] text-slate-500">{currentTransitHours}h transit · {currency.format(comparison?.currentPenaltyUsd ?? 0)} penalty</div>
              </div>
            </div>

            <div className="flex justify-center">
              <ArrowRight className="h-4 w-4 rotate-90 text-violet-400" />
            </div>

            <div className="flex items-center gap-1.5 rounded-xl border border-violet-500/25 bg-violet-500/8 p-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-400/70">
                  {isApproved ? "Approved Corridor" : "Prescribed Corridor"}
                </div>
                <div className="mt-0.5 truncate text-xs font-medium text-slate-200">{shadowRoute.nodes.join(" → ")}</div>
                <div className="mt-0.5 text-[10px] text-slate-500">{proposedTransitHours}h transit · {currency.format(comparison?.prescribedPenaltyUsd ?? 0)} penalty</div>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                isApproved ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-violet-400/20 bg-violet-400/10 text-violet-200"
              }`}>
                {isApproved ? "Active" : "Ready"}
              </span>
            </div>
          </div>
        )}

        {/* Scenario comparison mode */}
        {scenarioComparisons.length > 0 && (
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/6 p-3 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-300/80">
              Scenario Comparison Mode
            </div>
            {scenarioComparisons.map((scenario) => (
              <div key={scenario.id} className="rounded-lg border border-white/10 bg-slate-950/45 p-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-slate-200">{scenario.title}</div>
                  <div className="text-[10px] text-slate-500">{scenario.disruptedHubs.join(", ")}</div>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded bg-red-500/10 px-2 py-1 text-red-200">
                    Current: +{scenario.currentDelayHours}h · +{currency.format(scenario.currentCostDeltaUsd)}
                  </div>
                  <div className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-200">
                    Alternate: +{scenario.alternateDelayHours}h · +{currency.format(scenario.alternateCostDeltaUsd)}
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  Affected hubs — Current: {scenario.affectedCurrentHubs.join(", ") || "none"} · Alternate: {scenario.affectedAlternateHubs.join(", ") || "none"}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Cascade warnings */}
        {cascadeWarnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/6 p-3 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/80">
              ⚡ Cascade Propagation
            </div>
            {cascadeWarnings.slice(0, 3).map((w, i) => (
              <div key={i} className="text-xs text-amber-200/80">
                <span className="font-medium">{w.hubName}</span>
                <span className="text-amber-400/60"> · Degree {w.degree} · {(w.propagatedRisk * 100).toFixed(0)}% risk</span>
              </div>
            ))}
          </div>
        )}

        {/* AI Explanation Panel */}
        {shadowRoute && (
          <div className="rounded-xl border border-white/8 bg-slate-900/40">
            <button
              onClick={() => {
                setShowExplanation((p) => !p);
                if (!explanation && !isLoadingExplanation) onRequestExplanation();
              }}
              className="flex w-full items-center justify-between p-3 text-left"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-400" />
                <span className="text-xs font-semibold text-slate-300">Why this route?</span>
                {explanation && (
                  <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-300">
                    {(explanation.confidenceScore * 100).toFixed(0)}% confidence
                  </span>
                )}
              </div>
              <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${showExplanation ? "rotate-180" : ""}`} />
            </button>

            {showExplanation && (
              <div className="border-t border-white/8 p-3 space-y-3">
                {isLoadingExplanation && (
                  <div className="flex items-center gap-2 text-xs text-violet-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Gemini analyzing reroute rationale…
                  </div>
                )}
                {explanation && (
                  <>
                    <p className="text-xs leading-relaxed text-slate-300">{explanation.summary}</p>
                    <div className="space-y-2">
                      {[
                        { icon: "🛡", label: "Risk avoided", text: explanation.riskAvoided },
                        { icon: "⏱", label: "Time logic", text: explanation.timeSavedRationale },
                        { icon: "💰", label: "Cost logic", text: explanation.costLogic },
                      ].map(({ icon, label, text }) => (
                        <div key={label} className="flex gap-2 text-xs">
                          <span className="shrink-0 text-base leading-none">{icon}</span>
                          <div>
                            <span className="font-semibold text-slate-400">{label}: </span>
                            <span className="text-slate-400">{text}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {explanation.alternativesConsidered.length > 0 && (
                      <div className="text-xs text-slate-600">
                        Also evaluated: {explanation.alternativesConsidered.join(" · ")}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Shadow legs */}
        {shadowRoute && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Corridor Legs</div>
            {shadowRoute.legs.map((leg) => {
              const healthColor =
                leg.health === "critical" ? "border-red-500/30 bg-red-500/6 text-red-300" :
                leg.health === "warning" ? "border-amber-500/25 bg-amber-500/6 text-amber-300" :
                "border-emerald-500/20 bg-emerald-500/5 text-emerald-300";
              return (
                <div key={leg.id} className={`rounded-lg border p-2 ${healthColor}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-medium">
                      <Route className="h-3 w-3 opacity-70" />
                      {leg.origin} → {leg.destination}
                    </div>
                    <span className="text-[10px] font-semibold opacity-80">{leg.etaHours}h</span>
                  </div>
                  <div className="mt-0.5 text-[10px] opacity-60">{leg.vessel} · {leg.mode} · Risk {(leg.riskScore * 100).toFixed(0)}%</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Approve button */}
        {shadowRoute && !isApproved && (
          <div className="mt-auto pt-2">
            <button
              onClick={onApproveReroute}
              className="w-full rounded-xl border border-emerald-500/25 bg-gradient-to-r from-emerald-600/25 to-teal-600/20 px-4 py-3 text-sm font-semibold text-emerald-200 transition-all hover:from-emerald-600/35 hover:to-teal-600/30 hover:shadow-lg hover:shadow-emerald-500/10"
            >
              <span className="flex items-center justify-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Approve &amp; Execute Reroute
              </span>
            </button>
          </div>
        )}

        {isApproved && (
          <div className="mt-auto rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-3 text-center">
            <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-400 mb-1" />
            <p className="text-xs font-semibold text-emerald-300">Reroute executed</p>
            <p className="text-[10px] text-emerald-400/70 mt-0.5">Manifest dispatched to all partners</p>
          </div>
        )}
      </div>
    </section>
  );
}
