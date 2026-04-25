"use client";

import { useEffect, useRef } from "react";
import type { CascadeWarning, HubRiskAnalysis } from "@/types/logistics";

interface MapPanelProps {
  currentRoute: string[];
  shadowRoute: string[] | null;
  analyses: HubRiskAnalysis[];
  cascadeWarnings: CascadeWarning[];
  compromisedHubs: string[];
  isLoading: boolean;
}

const LEAFLET_LOADED = { css: false, js: false };
let leafletLoader: Promise<void> | null = null;

const HUB_COORDS: Record<string, [number, number]> = {
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

function statusColor(status: string) {
  if (status === "critical") return "#ef4444";
  if (status === "warning") return "#f59e0b";
  return "#10b981";
}

function riskToRadius(risk: number) {
  return Math.max(8, Math.min(20, 8 + risk * 18));
}

export function MapPanel({ currentRoute, shadowRoute, analyses, cascadeWarnings, compromisedHubs, isLoading }: MapPanelProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const layersRef = useRef<unknown[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !mapRef.current) return;
    let isActive = true;

    // Dynamically load Leaflet
    const loadLeaflet = async () => {
      if (!(window as unknown as Record<string, unknown>).L) {
        if (!LEAFLET_LOADED.css) {
          LEAFLET_LOADED.css = true;
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
          document.head.appendChild(link);
        }
        if (!leafletLoader) {
          leafletLoader = new Promise<void>((resolve) => {
            if (LEAFLET_LOADED.js) {
              resolve();
              return;
            }
            LEAFLET_LOADED.js = true;
            const script = document.createElement("script");
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
            script.onload = () => resolve();
            document.head.appendChild(script);
          });
        }
        await leafletLoader;
      }
      if (!isActive) return;

      const L = (window as unknown as Record<string, unknown>).L as {
        map: (el: HTMLElement, opts: unknown) => unknown;
        tileLayer: (url: string, opts: unknown) => { addTo: (m: unknown) => unknown };
        polyline: (coords: [number, number][], opts: unknown) => { addTo: (m: unknown) => unknown; remove: () => void };
        circleMarker: (pos: [number, number], opts: unknown) => { addTo: (m: unknown) => unknown; remove: () => void; bindPopup: (html: string) => { addTo: (m: unknown) => unknown; remove: () => void; bindPopup: (s: string) => unknown } };
        divIcon: (opts: unknown) => unknown;
        marker: (pos: [number, number], opts: unknown) => { addTo: (m: unknown) => unknown; remove: () => void };
      };

      if (!mapInstanceRef.current && mapRef.current) {
        const map = L.map(mapRef.current, {
          center: [20, 60],
          zoom: 3,
          zoomControl: true,
          attributionControl: false,
        });

        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
          maxZoom: 8,
          minZoom: 2,
        }).addTo(map);

        mapInstanceRef.current = map;
      }

      // Clear previous layers
      for (const layer of layersRef.current) {
        (layer as { remove: () => void }).remove();
      }
      layersRef.current = [];

      const map = mapInstanceRef.current;
      const analysisMap = new Map(analyses.map((a) => [a.hubName, a]));
      const cascadeMap = new Map(cascadeWarnings.map((w) => [w.hubName, w]));

      // Draw current route (red dashed)
      const currentCoords = currentRoute.map((h) => HUB_COORDS[h]).filter(Boolean) as [number, number][];
      if (currentCoords.length >= 2) {
        const line = L.polyline(currentCoords, {
          color: "#ef4444",
          weight: 2,
          opacity: 0.6,
          dashArray: "8 6",
        }).addTo(map);
        layersRef.current.push(line);
      }

      // Draw shadow route (violet solid)
      if (shadowRoute && shadowRoute.length >= 2) {
        const shadowCoords = shadowRoute.map((h) => HUB_COORDS[h]).filter(Boolean) as [number, number][];
        if (shadowCoords.length >= 2) {
          const shadowLine = L.polyline(shadowCoords, {
            color: "#a855f7",
            weight: 3,
            opacity: 0.9,
          }).addTo(map);
          layersRef.current.push(shadowLine);

          // Arrow-like midpoint markers along shadow route
          for (let i = 0; i < shadowCoords.length - 1; i++) {
            const [y1, x1] = shadowCoords[i];
            const [y2, x2] = shadowCoords[i + 1];
            const midLat = (y1 + y2) / 2;
            const midLon = (x1 + x2) / 2;
            const angle = (Math.atan2(x2 - x1, y2 - y1) * 180) / Math.PI;
            const arrowIcon = L.divIcon({
              html: `<div style="transform:rotate(${angle}deg);color:#a855f7;font-size:14px;line-height:1;">▶</div>`,
              className: "",
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            });
            const arrowMarker = L.marker([midLat, midLon], { icon: arrowIcon }).addTo(map);
            layersRef.current.push(arrowMarker);
          }
        }
      }

      // Draw all hubs in route + shadow
      const allHubs = new Set([...currentRoute, ...(shadowRoute ?? [])]);
      for (const hubName of allHubs) {
        const coords = HUB_COORDS[hubName];
        if (!coords) continue;

        const analysis = analysisMap.get(hubName);
        const cascade = cascadeMap.get(hubName);
        const isCompromised = compromisedHubs.includes(hubName);
        const isCascade = !!cascade;

        const status = analysis?.status ?? "optimal";
        const risk = analysis?.riskScore ?? 0;
        const color = isCompromised ? "#ef4444" : isCascade ? "#f59e0b" : statusColor(status);
        const radius = riskToRadius(risk);
        const pulseClass = isCompromised || isCascade ? "animate-pulse" : "";

        // Outer pulse ring for critical/cascade hubs
        if (isCompromised || isCascade) {
          const pulseRing = L.circleMarker(coords, {
            radius: radius + 8,
            color,
            weight: 2,
            opacity: 0.35,
            fillOpacity: 0.08,
            fillColor: color,
            className: pulseClass,
          }).addTo(map);
          layersRef.current.push(pulseRing);
        }

        const marker = L.circleMarker(coords, {
          radius,
          color: "#0f172a",
          weight: 2,
          fillColor: color,
          fillOpacity: isCompromised ? 0.95 : 0.80,
        });
        marker.addTo(map);

        const cascadeNote = cascade
          ? `<div style="color:#f59e0b;font-size:11px;margin-top:6px">⚡ Cascade degree ${cascade.degree} from ${cascade.originDisruption}<br>Propagated risk: ${(cascade.propagatedRisk * 100).toFixed(0)}%</div>`
          : "";

        const popupHtml = `
          <div style="background:#1e293b;color:#f1f5f9;padding:10px 14px;border-radius:10px;min-width:180px;font-family:system-ui,sans-serif;border:1px solid ${color}40;">
            <div style="font-weight:700;font-size:14px;color:${color}">${hubName}</div>
            <div style="font-size:12px;margin-top:4px;color:#94a3b8">${analysis?.reasoningLog ?? "No analysis yet."}</div>
            ${analysis ? `<div style="margin-top:6px;font-size:11px;color:#64748b">Risk: <span style="color:${color};font-weight:600">${(risk * 100).toFixed(0)}%</span> · Status: <span style="color:${color}">${status.toUpperCase()}</span></div>` : ""}
            ${cascadeNote}
          </div>
        `;

        marker.bindPopup(popupHtml);
        layersRef.current.push(marker);

        // Hub label
        const labelIcon = L.divIcon({
          html: `<div style="color:#e2e8f0;font-size:11px;font-weight:600;white-space:nowrap;text-shadow:0 1px 3px #000;background:rgba(15,23,42,0.7);padding:2px 6px;border-radius:4px;border:1px solid ${color}50;">${hubName}</div>`,
          className: "",
          iconAnchor: [-radius - 2, 8],
        });
        const labelMarker = L.marker(coords, { icon: labelIcon, interactive: false }).addTo(map);
        layersRef.current.push(labelMarker);
      }
    };

    loadLeaflet();

    return () => {
      isActive = false;
      for (const layer of layersRef.current) {
        (layer as { remove: () => void }).remove();
      }
      layersRef.current = [];
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }
    };
  }, [currentRoute, shadowRoute, analyses, cascadeWarnings, compromisedHubs]);

  return (
    <section className="war-panel relative h-full overflow-hidden">
      {/* Map container */}
      <div ref={mapRef} className="absolute inset-0 z-0" style={{ background: "#0f172a" }} />

      {/* Legend overlay */}
      <div className="absolute bottom-4 left-4 z-[500] rounded-xl border border-white/10 bg-slate-950/85 px-3 py-2.5 text-xs backdrop-blur-sm">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Legend</div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className="h-px w-5 border-t-2 border-dashed border-red-500 opacity-60" />
            <span className="text-slate-400">Current route</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-px w-5 border-t-2 border-violet-500" />
            <span className="text-slate-400">Prescribed route</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-red-500" />
            <span className="text-slate-400">Compromised hub</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-amber-500" />
            <span className="text-slate-400">Cascade warning</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-emerald-500" />
            <span className="text-slate-400">Optimal hub</span>
          </div>
        </div>
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-[600] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
          <div className="text-center space-y-3">
            <div className="mx-auto h-10 w-10 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
            <p className="text-sm text-slate-300">Recalculating optimal corridor…</p>
          </div>
        </div>
      )}

      {/* Top-right status */}
      <div className="absolute right-3 top-3 z-[500] space-y-1">
        {cascadeWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200">
            ⚡ {cascadeWarnings.length} cascade warning{cascadeWarnings.length > 1 ? "s" : ""}
          </div>
        )}
        {compromisedHubs.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200">
            🔴 {compromisedHubs.length} compromised hub{compromisedHubs.length > 1 ? "s" : ""}
          </div>
        )}
        {shadowRoute && (
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-200">
            ✓ Shadow route active
          </div>
        )}
      </div>
    </section>
  );
}
