import type {
  AnalyzeRouteRequest,
  AnalyzeRouteResponse,
  ExplainRerouteRequest,
  ExplainRerouteResponse,
  HubRiskAnalysis,
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

// ─── SSE streaming client ────────────────────────────────────────────────────

export type StreamEventType = "log" | "analysis" | "cascade" | "complete" | "error";

export interface StreamLogPayload {
  source: string;
  tone: string;
  message: string;
}

export interface StreamEvent {
  type: StreamEventType;
  run_id: string;
  data: StreamLogPayload | HubRiskAnalysis | Record<string, unknown>;
}

export interface AnalyzeRouteStreamCallbacks {
  /** Called for every terminal log event */
  onLog: (payload: StreamLogPayload, runId: string) => void;
  /** Called when a single hub analysis arrives (allows incremental map updates) */
  onAnalysis: (analysis: HubRiskAnalysis, runId: string) => void;
  /** Called once the full analysis is complete */
  onComplete: (payload: Record<string, unknown>, runId: string) => void;
  /** Called on stream error */
  onError: (message: string) => void;
}

/**
 * Opens a Server-Sent Events connection to /analyze-route-stream.
 * Calls the relevant callback as each event arrives — no polling needed.
 *
 * Returns an AbortController so the caller can cancel early.
 */
export function analyzeRouteStream(
  payload: AnalyzeRouteRequest,
  callbacks: AnalyzeRouteStreamCallbacks,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch(`${backendBaseUrl}/analyze-route-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        callbacks.onError(`Stream failed: ${response.statusText}`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const chunk of lines) {
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;

          try {
            const event: StreamEvent = JSON.parse(dataLine.slice(6));
            switch (event.type) {
              case "log":
                callbacks.onLog(event.data as StreamLogPayload, event.run_id);
                break;
              case "analysis":
                callbacks.onAnalysis(event.data as HubRiskAnalysis, event.run_id);
                break;
              case "complete":
                callbacks.onComplete(event.data as Record<string, unknown>, event.run_id);
                break;
              case "error":
                callbacks.onError((event.data as { message: string }).message);
                break;
            }
          } catch {
            // malformed SSE frame — skip
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        callbacks.onError(err instanceof Error ? err.message : "Stream connection failed");
      }
    }
  })();

  return controller;
}
