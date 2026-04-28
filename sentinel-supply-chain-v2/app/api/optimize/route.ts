import { NextResponse } from "next/server";

import type { HubRiskAnalysis, OptimizeRouteRequest, PrescriptivePathRequest } from "@/types/logistics";

const backendBaseUrl = (
  process.env.FASTAPI_BASE_URL ??
  process.env.NEXT_PUBLIC_FASTAPI_BASE_URL ??
  "http://127.0.0.1:8000"
).replace(/\/$/, "");

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as OptimizeRouteRequest;

    if (!payload.startNode || !payload.endNode) {
      return NextResponse.json(
        { error: "startNode and endNode are required." },
        { status: 400 },
      );
    }

    const route = payload.currentRoute && payload.currentRoute.length >= 2
      ? payload.currentRoute
      : [payload.startNode, payload.endNode];

    const riskByHub = new Map<string, { riskScore: number; weatherFriction: number; reason: string }>();
    for (const injection of payload.riskInjections ?? []) {
      riskByHub.set(injection.toNode, {
        riskScore: injection.riskScore ?? 0.1,
        weatherFriction: injection.weatherFriction ?? 1,
        reason: injection.reason,
      });
    }

    const hubAnalyses: HubRiskAnalysis[] = Array.from(new Set(route)).map((hubName) => {
      const injected = riskByHub.get(hubName);
      const riskScore = injected?.riskScore ?? 0.1;
      return {
        hubName,
        lat: 0,
        lon: 0,
        riskScore,
        frictionCoefficient: injected?.weatherFriction ?? 1,
        confidence: injected ? 0.75 : 0.6,
        congestionFactor: 1,
        isCascadeAffected: false,
        reasoningLog: injected?.reason ?? "No active risk injection.",
        status: riskScore > 0.7 ? "critical" : riskScore > 0.35 ? "warning" : "optimal",
        newsSummary: "",
        weatherSummary: "",
        analyzedAt: new Date().toISOString(),
        sourceErrors: [],
      };
    });

    const backendPayload: PrescriptivePathRequest = {
      currentRoute: route,
      hubAnalyses,
      fuelCost: payload.fuelCost,
      delayPenalty: payload.delayPenalty,
      carbonCost: payload.carbonCost,
      cargoType: payload.cargoType,
      origin: payload.startNode,
      destination: payload.endNode,
      containerCount: payload.containerCount,
    };

    const response = await fetch(`${backendBaseUrl}/get-prescriptive-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backendPayload),
    });
    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json({ error: detail || "FastAPI optimize failed." }, { status: response.status });
    }
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Route optimization failed.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
