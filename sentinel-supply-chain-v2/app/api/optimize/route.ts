import { NextResponse } from "next/server";

import { optimizeRoute } from "@/lib/routing-engine";
import type { OptimizeRouteRequest } from "@/types/logistics";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as OptimizeRouteRequest;

    if (!payload.startNode || !payload.endNode) {
      return NextResponse.json(
        { error: "startNode and endNode are required." },
        { status: 400 },
      );
    }

    const response = optimizeRoute(payload);
    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Route optimization failed.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
