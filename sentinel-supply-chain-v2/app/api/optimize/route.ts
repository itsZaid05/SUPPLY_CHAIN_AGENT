import { NextResponse } from "next/server";

import type { OptimizeRouteRequest } from "@/types/logistics";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_FASTAPI_BASE_URL ?? "http://127.0.0.1:8000"
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

    const response = await fetch(`${backendBaseUrl}/optimize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
