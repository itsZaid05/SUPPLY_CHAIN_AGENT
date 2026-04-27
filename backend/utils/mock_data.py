"""Mock data for development and fallback scenarios."""
from typing import TypedDict


class HubCoord(TypedDict):
    """Hub coordinate definition."""

    name: str
    lat: float
    lon: float


# Global shipping hubs with real coordinates
GLOBAL_HUBS: list[HubCoord] = [
    {"name": "Shanghai", "lat": 31.2304, "lon": 121.4737},
    {"name": "Singapore", "lat": 1.2644, "lon": 103.82},
    {"name": "Suez", "lat": 29.9668, "lon": 32.5498},
    {"name": "Rotterdam", "lat": 51.9244, "lon": 4.4777},
    {"name": "Cape Town", "lat": -33.9249, "lon": 18.4241},
    {"name": "Dubai", "lat": 25.2048, "lon": 55.2708},
    {"name": "Hamburg", "lat": 53.5511, "lon": 9.9937},
    {"name": "Mumbai", "lat": 18.9667, "lon": 72.8333},
    {"name": "Colombo", "lat": 6.9271, "lon": 79.8612},
]

MOCK_NEWS_EVENTS = {
    "Shanghai": "Typhoon season incoming; port operations at 85% capacity",
    "Singapore": "Routine maintenance scheduled; minor congestion expected",
    "Suez": "CRITICAL: Regional geopolitical tensions escalating; shipping fees +25%",
    "Rotterdam": "Normal operations; labor negotiations proceeding smoothly",
    "Cape Town": "Favorable weather window; optimal transit conditions",
    "Dubai": "High port traffic; average wait time 36 hours",
    "Hamburg": "Winter weather advisory; icebreakers on standby",
    "Mumbai": "Monsoon season effects; moderate delays expected",
    "Colombo": "Stable conditions; competitive pricing in effect",
}

MOCK_WEATHER_FRICTION = {
    "Shanghai": 1.3,
    "Singapore": 0.9,
    "Suez": 2.1,
    "Rotterdam": 1.4,
    "Cape Town": 1.8,
    "Dubai": 0.95,
    "Hamburg": 2.2,
    "Mumbai": 1.6,
    "Colombo": 1.1,
}

MOCK_EXPLANATIONS = [
    "Rerouting eliminates direct exposure to compromised hubs by switching to the lowest-weight Dijkstra path across the live risk graph.",
    "This corridor bypasses disrupted infrastructure and reduces cascade propagation by minimizing edges through high-risk zones.",
    "Alternative route prioritizes resilience: adding minimal delay while slashing physical risk exposure by 67%.",
    "Optimized for SLA compliance: prescribed path shaves 14 hours while maintaining cargo safety thresholds.",
    "Carbon-aware routing: new corridor reduces emissions by 23% through efficiency gains despite longer distance.",
]

def get_hub_coordinates(hub_name: str) -> tuple[float, float] | None:
    """Get coordinates for a hub by name."""
    for hub in GLOBAL_HUBS:
        if hub["name"].lower() == hub_name.lower():
            return (hub["lat"], hub["lon"])
    return None


def get_all_hub_names() -> list[str]:
    """Get all hub names."""
    return [hub["name"] for hub in GLOBAL_HUBS]
