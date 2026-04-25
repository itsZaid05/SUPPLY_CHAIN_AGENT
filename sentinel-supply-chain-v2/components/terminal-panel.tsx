"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";
import type { DashboardStatus, TerminalEntry } from "@/types/logistics";

interface TerminalPanelProps {
  entries: TerminalEntry[];
  dashboardStatus: DashboardStatus;
  isStreaming: boolean;
}

const sourceLabel: Record<TerminalEntry["source"], string> = {
  system:    "SYS",
  signal:    "SIG",
  risk:      "RISK",
  optimizer: "OPT",
  dispatch:  "DSPCH",
  cascade:   "CASCADE",
};

const toneStyles: Record<TerminalEntry["tone"], string> = {
  info:     "text-slate-400",
  warning:  "text-amber-400",
  critical: "text-red-400",
  success:  "text-emerald-400",
};

const sourceBadgeStyles: Record<TerminalEntry["source"], string> = {
  system:    "text-slate-500 bg-slate-800",
  signal:    "text-cyan-500 bg-cyan-950",
  risk:      "text-red-500 bg-red-950",
  optimizer: "text-violet-400 bg-violet-950",
  dispatch:  "text-emerald-400 bg-emerald-950",
  cascade:   "text-amber-400 bg-amber-950",
};

export function TerminalPanel({ entries, dashboardStatus, isStreaming }: TerminalPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  return (
    <section className="war-panel flex h-full flex-col overflow-hidden">
      <div className="relative z-10 flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/6 px-4 py-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-slate-500" />
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              Intelligence Feed
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                isStreaming
                  ? "animate-pulse bg-emerald-400"
                  : dashboardStatus === "Rerouted"
                  ? "bg-violet-400"
                  : "bg-slate-600"
              }`}
            />
            <span className="text-[10px] text-slate-600">
              {isStreaming ? "LIVE" : dashboardStatus === "Rerouted" ? "REROUTED" : "IDLE"}
            </span>
          </div>
        </div>

        {/* Feed */}
        <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
          {entries.map((entry) => (
            <div key={entry.id} className="mb-1.5 flex gap-2">
              <span className="shrink-0 text-slate-700">{entry.timestamp}</span>
              <span className={`shrink-0 rounded px-1 text-[9px] font-bold uppercase ${sourceBadgeStyles[entry.source]}`}>
                {sourceLabel[entry.source]}
              </span>
              <span className={toneStyles[entry.tone]}>{entry.message}</span>
            </div>
          ))}
          {isStreaming && (
            <div className="flex items-center gap-1 text-slate-600">
              <span className="inline-block h-3 w-1.5 animate-pulse bg-slate-500" />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </section>
  );
}
