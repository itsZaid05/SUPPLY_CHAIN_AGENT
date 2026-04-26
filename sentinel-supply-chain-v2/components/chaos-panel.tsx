"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Zap } from "lucide-react";
import type { CargoType, ChaosMode, ScenarioConfig } from "@/types/logistics";
import { ALL_HUBS, CARGO_LABELS, PRESET_SCENARIOS } from "@/lib/mock-data";

interface ChaosPanelProps {
  isBusy: boolean;
  onSimulate: (params: {
    chaosHubs: string[];
    severity: number;
    mode: ChaosMode;
    scenario: ScenarioConfig;
  }) => void;
}

const SEVERITY_LABELS: Record<number, string> = {
  0.3: "Minor",
  0.5: "Moderate",
  0.7: "Severe",
  0.9: "Critical",
  1.0: "Catastrophic",
};

const MODE_LABELS: Record<ChaosMode, string> = {
  single: "Single Hub",
  cluster: "Storm Cluster",
  storm: "Global Crisis",
};

export function ChaosPanel({ isBusy, onSimulate }: ChaosPanelProps) {
  const [selectedHubs, setSelectedHubs] = useState<string[]>(["Suez"]);
  const [severity, setSeverity] = useState(0.9);
  const [mode, setMode] = useState<ChaosMode>("single");
  const [origin, setOrigin] = useState("Shanghai");
  const [destination, setDestination] = useState("Rotterdam");
  const [cargoType, setCargoType] = useState<CargoType>("electronics");
  const [containerCount, setContainerCount] = useState(200);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const toggleHub = (hub: string) => {
    setSelectedHubs((prev) =>
      prev.includes(hub) ? prev.filter((h) => h !== hub) : [...prev, hub]
    );
  };

  const loadPreset = (preset: ScenarioConfig) => {
    setOrigin(preset.origin);
    setDestination(preset.destination);
    setCargoType(preset.cargoType);
    setContainerCount(preset.containerCount);
  };

  const handleSimulate = () => {
    if (origin === destination) {
      alert("Origin and destination must be different hubs.");
      return;
    }
    const effectiveMode: ChaosMode =
      selectedHubs.length >= 3 ? "storm" : selectedHubs.length === 2 ? "cluster" : "single";
    onSimulate({
      chaosHubs: selectedHubs,
      severity,
      mode: effectiveMode,
      scenario: { origin, destination, cargoType, priority: "speed", containerCount },
    });
  };

  const severityLabel =
    Object.entries(SEVERITY_LABELS)
      .reverse()
      .find(([k]) => severity >= Number(k))?.[1] ?? "Critical";

  const severityColor =
    severity >= 0.9 ? "text-red-400" : severity >= 0.7 ? "text-amber-400" : severity >= 0.5 ? "text-yellow-400" : "text-emerald-400";

  return (
    <div className="war-panel h-full overflow-y-auto p-4">
      <div className="relative z-10 flex h-full flex-col gap-4">
        {/* Header */}
        <div className="space-y-1">
          <span className="status-chip">
            <Zap className="h-3.5 w-3.5 text-red-400" />
            Chaos Engine
          </span>
          <h2 className="text-base font-semibold text-slate-50">Disruption Simulator</h2>
          <p className="text-xs text-slate-500">Inject real-time disruptions and run AI rerouting.</p>
        </div>

        {/* Preset Scenarios */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">Quick Scenarios</div>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESET_SCENARIOS.map((preset, i) => (
              <button
                key={i}
                onClick={() => loadPreset(preset)}
                className="rounded-lg border border-white/8 bg-slate-900/60 px-2 py-1.5 text-left text-xs text-slate-300 hover:border-violet-500/30 hover:bg-violet-500/5 hover:text-slate-100 transition-all"
              >
                <div className="font-medium">{preset.origin} → {preset.destination}</div>
                <div className="text-slate-500">{CARGO_LABELS[preset.cargoType].split(" ")[0]}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Hub Selection */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Select Hub(s) to Disrupt
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_HUBS.map((hub) => {
              const isSelected = selectedHubs.includes(hub);
              return (
                <button
                  key={hub}
                  onClick={() => toggleHub(hub)}
                  className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition-all ${
                    isSelected
                      ? "border-red-500/40 bg-red-500/10 text-red-200"
                      : "border-white/8 bg-slate-900/40 text-slate-400 hover:border-slate-500/30 hover:text-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{hub}</span>
                    {isSelected && <AlertTriangle className="h-3 w-3 text-red-400" />}
                  </div>
                </button>
              );
            })}
          </div>
          {selectedHubs.length >= 2 && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-2.5 py-1.5 text-xs text-amber-300">
              ⚡ Storm cluster mode: {selectedHubs.length} simultaneous disruptions
            </div>
          )}
        </div>

        {/* Severity Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">Severity</div>
            <div className={`text-xs font-bold ${severityColor}`}>{severityLabel} ({(severity * 100).toFixed(0)}%)</div>
          </div>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.1"
            value={severity}
            onChange={(e) => setSeverity(Number(e.target.value))}
            className="w-full accent-red-500"
          />
          <div className="flex justify-between text-[10px] text-slate-600">
            <span>Minor</span>
            <span>Severe</span>
            <span>Catastrophic</span>
          </div>
        </div>

        {/* Advanced toggle */}
        <button
          onClick={() => setShowAdvanced((p) => !p)}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          Advanced scenario config
        </button>

        {showAdvanced && (
          <div className="space-y-3 rounded-xl border border-white/8 bg-slate-900/40 p-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Origin</label>
              <select
                value={origin}
                onChange={(e) => {
                  const nextOrigin = e.target.value;
                  setOrigin(nextOrigin);
                  if (destination === nextOrigin) {
                    const fallbackDestination = ALL_HUBS.find((hub) => hub !== nextOrigin) ?? nextOrigin;
                    setDestination(fallbackDestination);
                  }
                }}
                className="w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
              >
                {ALL_HUBS.map((h) => <option key={h}>{h}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Destination</label>
              <select value={destination} onChange={(e) => setDestination(e.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-200">
                {ALL_HUBS.filter((h) => h !== origin).map((h) => <option key={h}>{h}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Cargo Type</label>
              <select value={cargoType} onChange={(e) => setCargoType(e.target.value as CargoType)} className="w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-200">
                {(Object.entries(CARGO_LABELS) as [CargoType, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Container Count: {containerCount}</label>
              <input
                type="range"
                min="10"
                max="1000"
                step="10"
                value={containerCount}
                onChange={(e) => setContainerCount(Number(e.target.value))}
                className="w-full accent-violet-500"
              />
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="mt-auto space-y-2">
          <button
            onClick={handleSimulate}
            disabled={isBusy || selectedHubs.length === 0}
            className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-red-600 to-rose-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-red-500/25 transition-all hover:from-red-500 hover:to-rose-500 hover:shadow-red-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Analyzing…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Zap className="h-4 w-4" />
                Simulate Chaos
                {selectedHubs.length > 0 && (
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">
                    {selectedHubs.length} hub{selectedHubs.length > 1 ? "s" : ""}
                  </span>
                )}
              </span>
            )}
          </button>
          {selectedHubs.length === 0 && (
            <p className="text-center text-xs text-slate-600">Select at least one hub to disrupt</p>
          )}
        </div>
      </div>
    </div>
  );
}
