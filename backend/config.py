"""Configuration management for backend services."""
import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # FastAPI
    APP_NAME: str = "Sentinel Supply Chain Agent"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = False
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:3001"]

    # Backend Server
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000

    # Gemini API
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-1.5-pro"

    # Firebase
    FIREBASE_PROJECT_ID: str = ""
    FIREBASE_CREDENTIALS_PATH: str = ""
    FIRESTORE_USE_EMULATOR: bool = False
    FIRESTORE_EMULATOR_HOST: str = "localhost:8080"

    # External APIs (optional)
    NEWSAPI_KEY: str = ""
    STORMGLASS_KEY: str = ""

    # Optimization Engine
    WEIGHT_FREIGHT_COST: float = 0.25
    WEIGHT_PENALTY_SLA: float = 0.25
    WEIGHT_RISK_PHYSICAL: float = 0.35
    WEIGHT_IMPACT_CARBON: float = 0.15

    # Node Capacity
    CAPACITY_THRESHOLD: float = 0.80
    EXPONENTIAL_PENALTY_FACTOR: float = 2.5

    # Cost parameters
    FUEL_COST_PER_NM: float = 0.82
    DELAY_PENALTY_PER_HOUR: float = 14_000
    CARBON_COST_PER_TONNE: float = 5_000

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


settings = Settings()
