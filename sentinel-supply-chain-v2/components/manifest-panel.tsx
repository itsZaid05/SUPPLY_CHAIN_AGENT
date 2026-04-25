"use client";

import { Activity, AlertTriangle, CheckCircle2, Ship } from "lucide-react";
import type { DashboardStatus, ManifestLeg } from "@/types/logistics";

interface ManifestPanelProps {
  manifest: ManifestLeg[];
  dashboardStatus: DashboardStatus;
  isBusy: boolean;
}

const healthConfig = {
  optimal: {
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    bar: "bg-emerald-500",
    dot: "bg-emerald-400",
    icon: CheckCircle2,
    label: "Optimal",
  },
  warning: {
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    bar: "bg-amber-500",
    dot: "bg-amber-400",
    icon: AlertTriangle,
    label: "Warning",
  },
  critical: {
    badge: "border-red-500/30 bg-red-500/10 text-red-300",
    bar: "bg-red-500",
    dot: "bg-red-400 animate-pulse",
    icon: AlertTriangle,
    label: "Critical",
  },
};

export function ManifestPanel({ manifest, dashboardStatus, isBusy }: ManifestPanelProps) {
  const criticalCount = manifest.filter((l) => l.health === "critical").length;
  const warningCount = manifest.filter((l) => l.health === "warning").length;
  const avgRisk = manifest.length > 0
    ? (manifest.reduce((s, l) => s + l.riskScore, 0) / manifest.length).toFixed(2)
    : "0.00";
  const totalHours = manifest.reduce((s, l) => s + l.etaHours, 0);

  return (
    <section className="war-panel flex h-full flex-col overflow-hidden">
      <div className="relative z-10 flex h-full flex-col">
        {/* Header */}
        <div className="border-b border-white/6 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Ship className="h-4 w-4 text-slate-500" />
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Live Manifest</span>
          </div>

          {/* Summary chips */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-lg border border-white/8 bg-slate-900/50 px-2 py-1.5 text-center">
              <div className="text-sm font-bold text-slate-100">{totalHours}h</div>
              <div className="text-[9px] text-slate-600 uppercase tracking-wider">Transit</div>
            </div>
            <div className="rounded-lg border border-white/8 bg-slate-900/50 px-2 py-1.5 text-center">
              <div className={`text-sm font-bold ${criticalCount > 0 ? "text-red-300" : "text-slate-100"}`}>{criticalCount}</div>
              <div className="text-[9px] text-slate-600 uppercase tracking-wider">Critical</div>
            </div>
            <div className="rounded-lg border border-white/8 bg-slate-900/50 px-2 py-1.5 text-center">
              <div className="text-sm font-bold text-slate-100">{avgRisk}</div>
              <div className="text-[9px] text-slate-600 uppercase tracking-wider">Avg Risk</div>
            </div>
          </div>
        </div>

        {/* Status bar */}
        <div className={`flex items-center gap-2 border-b border-white/6 px-4 py-2 text-xs ${
          dashboardStatus === "Rerouted"
            ? "bg-violet-500/8 text-violet-300"
            : isBusy
            ? "bg-amber-500/6 text-amber-300"
            : criticalCount > 0
            ? "bg-red-500/6 text-red-300"
            : "text-emerald-300"
        }`}>
          <Activity className="h-3.5 w-3.5" />
          <span className="font-medium">
            {dashboardStatus === "Rerouted"
              ? "Shadow route approved and active"
              : isBusy
              ? "Running live analysis…"
              : criticalCount > 0
              ? `${criticalCount} leg(s) require action`
              : warningCount > 0
              ? `${warningCount} leg(s) under elevated risk`
              : "All corridors nominal"}
          </span>
        </div>

        {/* Leg cards */}
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {manifest.map((leg) => {
            const cfg = healthConfig[leg.health];
            const Icon = cfg.icon;
            const riskPct = Math.round(leg.riskScore * 100);

            return (
              <article
                key={leg.id}
                className={`rounded-2xl border p-3 transition-all ${
                  leg.health === "critical"
                    ? "border-red-500/25 bg-red-500/5"
                    : leg.health === "warning"
                    ? "border-amber-500/20 bg-amber-500/4"
                    : "border-white/8 bg-slate-900/40"
                }`}
              >
                {/* Leg header */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                      <span className="text-sm font-semibold text-slate-100 truncate">
                        {leg.origin} → {leg.destination}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {leg.vessel} · {leg.mode} · {leg.etaHours}h ETA
                    </div>
                  </div>
                  <span className={`shrink-0 flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cfg.badge}`}>
                    <Icon className="h-2.5 w-2.5" />
                    {cfg.label}
                  </span>
                </div>

                {/* Risk bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-600">Risk exposure</span>
                    <span className={`font-mono font-semibold ${leg.health === "critical" ? "text-red-400" : leg.health === "warning" ? "text-amber-400" : "text-emerald-400"}`}>
                      {riskPct}%
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${cfg.bar}`}
                      style={{ width: `${riskPct}%` }}
                    />
                  </div>
                </div>

                {/* Note */}
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500 line-clamp-2">
                  {leg.note}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
