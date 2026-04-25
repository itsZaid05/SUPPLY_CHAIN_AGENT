import type {
  AnalyzeRouteRequest,
  AnalyzeRouteResponse,
  ExplainRerouteRequest,
  ExplainRerouteResponse,
  PrescriptivePathRequest,
  PrescriptivePathResponse,
} from "@/types/logistics";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_FASTAPI_BASE_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

async function postJson<TResponse, TPayload>(path: string, payload: TPayload): Promise<TResponse> {
  const response = await fetch(`${backendBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let detail = "Backend request failed.";
    try {
      const e = (await response.json()) as { detail?: string; error?: string };
      detail = e.detail ?? e.error ?? detail;
    } catch {
      detail = response.statusText || detail;
    }
    throw new Error(detail);
  }
  return response.json() as Promise<TResponse>;
}

export function analyzeRoute(payload: AnalyzeRouteRequest) {
  return postJson<AnalyzeRouteResponse, AnalyzeRouteRequest>("/analyze-route", payload);
}

export function getPrescriptivePath(payload: PrescriptivePathRequest) {
  return postJson<PrescriptivePathResponse, PrescriptivePathRequest>("/get-prescriptive-path", payload);
}

export function explainReroute(payload: ExplainRerouteRequest) {
  return postJson<ExplainRerouteResponse, ExplainRerouteRequest>("/explain-reroute", payload);
}
