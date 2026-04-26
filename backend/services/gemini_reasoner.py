"""Gemini AI reasoner for supply chain analysis."""
import json
import logging
from typing import Optional
from datetime import datetime
from config import settings
from models.logistics import HubRiskAnalysis, RouteExplanation
from utils.mock_data import get_hub_coordinates, MOCK_EXPLANATIONS
import random

logger = logging.getLogger(__name__)


class GeminiReasoner:
    """Encapsulates Gemini API interactions for supply chain reasoning."""

    def __init__(self):
        """Initialize Gemini client or set up fallback mode."""
        self.client = None
        self.model = settings.GEMINI_MODEL
        self.use_fallback = True

        if settings.GEMINI_API_KEY:
            try:
                import google.generativeai as genai

                genai.configure(api_key=settings.GEMINI_API_KEY)
                self.client = genai
                self.use_fallback = False
                logger.info("Gemini client initialized successfully")
            except Exception as e:
                logger.warning(f"Gemini initialization failed: {e}. Using fallback mode.")
                self.use_fallback = True
        else:
            logger.info("Gemini API key not configured. Using fallback reasoning.")

    async def evaluate_hub_risk(
        self,
        hub_name: str,
        chaos_severity: float = 0.0,
        news_context: str = "",
        weather_friction: float = 1.0,
    ) -> HubRiskAnalysis:
        """Evaluate disruption risk for a hub using Gemini."""
        coords = get_hub_coordinates(hub_name)
        if not coords:
            return self._fallback_analysis(hub_name, 0.1, weather_friction)

        if self.use_fallback:
            return self._fallback_analysis(hub_name, chaos_severity, weather_friction, news_context)

        try:
            prompt = self._build_analysis_prompt(
                hub_name=hub_name,
                chaos_severity=chaos_severity,
                news_context=news_context,
                weather_friction=weather_friction,
            )

            response = self.client.GenerativeModel(self.model).generate_content(prompt)
            analysis = self._parse_gemini_response(response.text, hub_name, coords)
            return analysis
        except Exception as e:
            logger.error(f"Gemini analysis failed for {hub_name}: {e}. Using fallback.")
            return self._fallback_analysis(hub_name, chaos_severity, weather_friction, news_context)

    def _build_analysis_prompt(self, hub_name: str, chaos_severity: float, news_context: str, weather_friction: float) -> str:
        """Build prompt for Gemini hub risk analysis."""
        return f"""Analyze this supply chain hub disruption scenario as a JSON response:

Hub: {hub_name}
Chaos Severity: {chaos_severity * 100:.0f}%
Weather Impact (friction coefficient): {weather_friction}
News Context: {news_context}

Respond ONLY with a JSON object containing:
{{
  "risk_score": <0.0-1.0>,
  "confidence": <0.0-1.0>,
  "congestion_factor": <0.5-5.0>,
  "reasoning_log": "<short explanation>",
  "status": "optimal|warning|critical",
  "news_summary": "<sentiment>",
  "weather_summary": "<impact>"
}}

Be concise. No markdown."""

    def _parse_gemini_response(self, response_text: str, hub_name: str, coords: tuple[float, float]) -> HubRiskAnalysis:
        """Parse Gemini response into HubRiskAnalysis."""
        try:
            data = json.loads(response_text)
            return HubRiskAnalysis(
                hub_name=hub_name,
                lat=coords[0],
                lon=coords[1],
                risk_score=float(data.get("risk_score", 0.3)),
                friction_coefficient=float(data.get("friction_coefficient", 1.0)),
                confidence=float(data.get("confidence", 0.8)),
                congestion_factor=float(data.get("congestion_factor", 1.0)),
                reasoning_log=str(data.get("reasoning_log", "Analysis complete")),
                status=str(data.get("status", "optimal")),
                news_summary=str(data.get("news_summary", "Stable")),
                weather_summary=str(data.get("weather_summary", "Normal")),
                analyzed_at=datetime.utcnow(),
            )
        except Exception as e:
            logger.error(f"Failed to parse Gemini response: {e}")
            return self._fallback_analysis(hub_name, 0.2, 1.0)

    def _fallback_analysis(self, hub_name: str, chaos_severity: float, weather_friction: float, news_context: str = "") -> HubRiskAnalysis:
        """Generate fallback analysis without Gemini."""
        coords = get_hub_coordinates(hub_name)
        if not coords:
            coords = (0, 0)

        # Deterministic but realistic fallback
        base_risk = 0.2
        chaos_risk = chaos_severity * 0.6
        weather_risk = (weather_friction - 1.0) * 0.2
        total_risk = min(1.0, base_risk + chaos_risk + weather_risk)

        # Determine status
        if total_risk > 0.6:
            status = "critical"
        elif total_risk > 0.35:
            status = "warning"
        else:
            status = "optimal"

        return HubRiskAnalysis(
            hub_name=hub_name,
            lat=coords[0],
            lon=coords[1],
            risk_score=total_risk,
            friction_coefficient=weather_friction,
            confidence=0.75,
            congestion_factor=1.0 + (chaos_severity * 2.0),
            reasoning_log=f"Fallback analysis: {status} status · Risk={total_risk:.2f}",
            status=status,
            news_summary=news_context[:60] if news_context else "No recent events",
            weather_summary=f"Friction {weather_friction:.2f}x",
            analyzed_at=datetime.utcnow(),
            source_errors=["Gemini API unavailable"] if self.use_fallback else [],
        )

    async def explain_reroute(
        self,
        current_route: list[str],
        shadow_route: list[str],
        time_saved_hours: float,
        cost_avoided_usd: float,
        compromised_hubs: list[str],
    ) -> RouteExplanation:
        """Generate natural language explanation for reroute using Gemini."""
        if self.use_fallback:
            return self._fallback_explanation(time_saved_hours, cost_avoided_usd, compromised_hubs)

        try:
            prompt = f"""Explain this supply chain reroute as JSON:
Current route: {' → '.join(current_route)}
New route: {' → '.join(shadow_route)}
Time saved: {time_saved_hours:.1f}h
Cost avoided: ${cost_avoided_usd:,.0f}
Compromised hubs: {', '.join(compromised_hubs) or 'None'}

Respond ONLY with JSON:
{{
  "summary": "<one sentence>",
  "risk_avoided": "<how cascade avoided>",
  "time_saved_rationale": "<why faster>",
  "cost_logic": "<why cheaper>",
  "confidence_score": <0.0-1.0>,
  "alternatives_considered": ["<alt1>", "<alt2>"]
}}
"""
            response = self.client.GenerativeModel(self.model).generate_content(prompt)
            data = json.loads(response.text)
            return RouteExplanation(
                summary=data.get("summary", "Optimized route reduces risk and cost"),
                risk_avoided=data.get("risk_avoided", "Bypasses compromised hubs"),
                time_saved_rationale=data.get("time_saved_rationale", f"Shaves {time_saved_hours:.1f} hours"),
                cost_logic=data.get("cost_logic", f"Saves ${cost_avoided_usd:,.0f}"),
                confidence_score=float(data.get("confidence_score", 0.85)),
                alternatives_considered=data.get("alternatives_considered", ["Direct route", "Southern bypass"]),
            )
        except Exception as e:
            logger.error(f"Gemini explanation failed: {e}. Using fallback.")
            return self._fallback_explanation(time_saved_hours, cost_avoided_usd, compromised_hubs)

    def _fallback_explanation(self, time_saved_hours: float, cost_avoided_usd: float, compromised_hubs: list[str]) -> RouteExplanation:
        """Generate fallback explanation."""
        return RouteExplanation(
            summary=random.choice(MOCK_EXPLANATIONS),
            risk_avoided=f"Eliminates exposure to {len(compromised_hubs)} compromised hub(s)",
            time_saved_rationale=f"Removes {time_saved_hours:.1f}h of delay at high-risk segments",
            cost_logic=f"Penalty exposure drops by ${cost_avoided_usd:,.0f} by routing below risk threshold",
            confidence_score=0.82,
            alternatives_considered=["Cape of Good Hope bypass", "Dubai relay", "Current route with delay buffer"],
        )
