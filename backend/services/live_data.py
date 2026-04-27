"""Live data fetcher: NewsAPI (news sentiment) + StormGlass (weather friction).

Both services degrade gracefully — if keys are absent or the API call fails,
returns clearly-labelled fallback values so Gemini still gets valid context.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from config import settings
from utils.mock_data import get_hub_coordinates, MOCK_NEWS_EVENTS, MOCK_WEATHER_FRICTION

logger = logging.getLogger(__name__)

# ─── StormGlass parameter mappings ───────────────────────────────────────────
# These are the parameters we request from StormGlass per hub coordinate.
STORMGLASS_PARAMS = "waveHeight,windSpeed,precipitation,visibility"

# Wind speed (m/s) → friction multiplier. Shipping lanes slow down non-linearly
# with sea-state, so we apply a simple piecewise mapping.
def _wind_to_friction(wind_speed_ms: float) -> float:
    if wind_speed_ms < 5:
        return 0.9
    elif wind_speed_ms < 10:
        return 1.0
    elif wind_speed_ms < 15:
        return 1.2
    elif wind_speed_ms < 20:
        return 1.5
    elif wind_speed_ms < 25:
        return 1.8
    else:
        return 2.2


# ─── NewsAPI ──────────────────────────────────────────────────────────────────

async def fetch_news_context(hub_name: str, client: httpx.AsyncClient) -> tuple[str, bool]:
    """Fetch recent news headlines for a hub via NewsAPI.

    Returns:
        (context_string, is_live) — is_live=False means we fell back to mock data.
    """
    if not settings.NEWSAPI_KEY:
        return MOCK_NEWS_EVENTS.get(hub_name, "No recent events"), False

    coords = get_hub_coordinates(hub_name)
    query = f"{hub_name} port shipping supply chain disruption"
    url = "https://newsapi.org/v2/everything"
    params = {
        "q": query,
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": 3,
        "apiKey": settings.NEWSAPI_KEY,
    }

    try:
        response = await client.get(url, params=params, timeout=6.0)
        response.raise_for_status()
        data = response.json()
        articles = data.get("articles", [])

        if not articles:
            return f"No recent news for {hub_name}", True

        # Build a compact context string from up to 3 headlines
        headlines = [
            a.get("title", "").strip()
            for a in articles[:3]
            if a.get("title")
        ]
        context = " | ".join(headlines)
        logger.info(f"[NewsAPI] {hub_name}: {len(headlines)} headline(s) fetched")
        return context, True

    except httpx.TimeoutException:
        logger.warning(f"[NewsAPI] Timeout for {hub_name}. Using fallback.")
        return MOCK_NEWS_EVENTS.get(hub_name, "No recent events") + " [FALLBACK:timeout]", False
    except Exception as e:
        logger.warning(f"[NewsAPI] Error for {hub_name}: {e}. Using fallback.")
        return MOCK_NEWS_EVENTS.get(hub_name, "No recent events") + " [FALLBACK]", False


# ─── StormGlass ───────────────────────────────────────────────────────────────

async def fetch_weather_friction(hub_name: str, client: httpx.AsyncClient) -> tuple[float, str, bool]:
    """Fetch current weather data for a hub via StormGlass and convert to friction.

    Returns:
        (friction_coefficient, weather_summary, is_live)
    """
    if not settings.STORMGLASS_KEY:
        friction = MOCK_WEATHER_FRICTION.get(hub_name, 1.0)
        return friction, f"Friction {friction:.2f}x [mock]", False

    coords = get_hub_coordinates(hub_name)
    if not coords:
        return 1.0, "Unknown hub coordinates", False

    lat, lon = coords
    url = "https://api.stormglass.io/v2/weather/point"
    params = {
        "lat": lat,
        "lng": lon,
        "params": STORMGLASS_PARAMS,
        # Request only 1 hour window (now) to minimise quota usage
        "start": int(datetime.now(timezone.utc).timestamp()),
        "end": int(datetime.now(timezone.utc).timestamp()) + 3600,
    }
    headers = {"Authorization": settings.STORMGLASS_KEY}

    try:
        response = await client.get(url, params=params, headers=headers, timeout=8.0)
        response.raise_for_status()
        data = response.json()
        hours = data.get("hours", [])

        if not hours:
            friction = MOCK_WEATHER_FRICTION.get(hub_name, 1.0)
            return friction, "No weather data returned [FALLBACK]", False

        # Use first available hour
        hour = hours[0]

        def pick(field: str) -> Optional[float]:
            sources = hour.get(field, {})
            # StormGlass returns multiple source values; prefer sg (their model)
            for src in ("sg", "noaa", "meto", "icon"):
                if src in sources:
                    return float(sources[src])
            vals = list(sources.values())
            return float(vals[0]) if vals else None

        wind_speed = pick("windSpeed") or 5.0
        wave_height = pick("waveHeight") or 1.0
        precip = pick("precipitation") or 0.0

        # Friction from wind + wave height bonus
        friction = _wind_to_friction(wind_speed)
        if wave_height > 3.0:
            friction = min(friction + 0.3, 3.0)

        summary = (
            f"Wind {wind_speed:.1f}m/s · Waves {wave_height:.1f}m · "
            f"Precip {precip:.1f}mm/h → friction {friction:.2f}x [LIVE]"
        )
        logger.info(f"[StormGlass] {hub_name} @ ({lat:.2f},{lon:.2f}): {summary}")
        return friction, summary, True

    except httpx.TimeoutException:
        logger.warning(f"[StormGlass] Timeout for {hub_name}. Using fallback.")
        friction = MOCK_WEATHER_FRICTION.get(hub_name, 1.0)
        return friction, f"Friction {friction:.2f}x [FALLBACK:timeout]", False
    except Exception as e:
        logger.warning(f"[StormGlass] Error for {hub_name}: {e}. Using fallback.")
        friction = MOCK_WEATHER_FRICTION.get(hub_name, 1.0)
        return friction, f"Friction {friction:.2f}x [FALLBACK]", False


# ─── Batch fetcher ────────────────────────────────────────────────────────────

async def fetch_hub_context(hub_name: str) -> dict:
    """Fetch both news and weather for a hub concurrently.

    Returns a dict with keys: news_context, weather_friction, weather_summary,
    news_is_live, weather_is_live.
    """
    async with httpx.AsyncClient() as client:
        news_task = fetch_news_context(hub_name, client)
        weather_task = fetch_weather_friction(hub_name, client)
        (news_context, news_live), (friction, weather_summary, weather_live) = await asyncio.gather(
            news_task, weather_task
        )

    return {
        "news_context": news_context,
        "weather_friction": friction,
        "weather_summary": weather_summary,
        "news_is_live": news_live,
        "weather_is_live": weather_live,
    }
