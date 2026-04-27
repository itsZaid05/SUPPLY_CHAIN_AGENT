"""Firestore database manager with fallback to in-memory storage."""
import json
import logging
import os
from typing import Optional, Any
from datetime import datetime
from config import settings
from models.logistics import WorldStateDocument

logger = logging.getLogger(__name__)

# In-memory fallback storage
_memory_store: dict[str, Any] = {}


class FirestoreManager:
    """Manages Firestore operations with graceful degradation."""

    def __init__(self):
        """Initialize Firestore client or memory fallback."""
        self.db = None
        self.use_memory = True
        self.live_document_path = self._normalize_document_path(settings.FIREBASE_WORLD_STATE_DOC_PATH)

        if settings.FIRESTORE_USE_EMULATOR and settings.FIRESTORE_EMULATOR_HOST:
            os.environ["FIRESTORE_EMULATOR_HOST"] = settings.FIRESTORE_EMULATOR_HOST

        if settings.FIREBASE_PROJECT_ID or settings.FIREBASE_CREDENTIALS_PATH or settings.FIREBASE_SERVICE_ACCOUNT_JSON:
            try:
                from google.cloud import firestore
                from google.oauth2 import service_account

                credentials = self._build_credentials(service_account)
                self.db = firestore.Client(
                    project=settings.FIREBASE_PROJECT_ID or None,
                    credentials=credentials,
                )
                self.use_memory = False
                logger.info("Firestore initialized successfully")
            except Exception as e:
                logger.warning(f"Firestore initialization failed: {e}. Using memory fallback.")
                self.use_memory = True
        else:
            logger.info("Firebase credentials not configured. Using in-memory storage.")

    async def write_world_state(
        self,
        analysis_run_id: str,
        world_state: WorldStateDocument,
    ) -> bool:
        """Write world state document."""
        try:
            data = json.loads(world_state.model_dump_json(by_alias=True))

            if self.use_memory:
                _memory_store[f"world_state_{analysis_run_id}"] = data
                logger.info(f"World state cached (analysis_run_id={analysis_run_id})")
                return True
            else:
                self.db.document(self.live_document_path).set(data)
                history_ref = self.db.collection("supply_chain").document(f"world_state_{analysis_run_id}")
                history_ref.set(data)
                logger.info(f"World state written to Firestore (analysis_run_id={analysis_run_id})")
                return True
        except Exception as e:
            logger.error(f"Failed to write world state: {e}")
            return False

    async def read_world_state(self, analysis_run_id: str) -> Optional[WorldStateDocument]:
        """Read world state document."""
        try:
            if self.use_memory:
                data = _memory_store.get(f"world_state_{analysis_run_id}")
                if data:
                    return WorldStateDocument(**data)
                return None
            else:
                doc = self.db.collection("supply_chain").document(f"world_state_{analysis_run_id}").get()
                if doc.exists:
                    return WorldStateDocument(**doc.to_dict())
                return None
        except Exception as e:
            logger.error(f"Failed to read world state: {e}")
            return None

    async def stream_world_state(self, analysis_run_id: str):
        """Stream world state changes (real-time listener)."""
        if self.use_memory:
            logger.warning("Real-time streaming not available in memory mode")
            return None

        try:
            doc_ref = self.db.collection("supply_chain").document(f"world_state_{analysis_run_id}")

            def on_snapshot(doc_snapshot, changes, read_time):
                for doc in doc_snapshot:
                    logger.info(f"World state updated: {doc.id}")

            listener = doc_ref.on_snapshot(on_snapshot)
            return listener
        except Exception as e:
            logger.error(f"Failed to set up stream: {e}")
            return None

    async def list_recent_analysis_runs(self, limit: int = 10) -> list[str]:
        """List recent analysis run IDs."""
        if self.use_memory:
            return [key.replace("world_state_", "") for key in _memory_store.keys() if key.startswith("world_state_")][:limit]

        try:
            docs = self.db.collection("supply_chain").limit(limit).stream()
            return [doc.id.replace("world_state_", "") for doc in docs]
        except Exception as e:
            logger.error(f"Failed to list runs: {e}")
            return []

    @staticmethod
    def _normalize_document_path(path: str) -> str:
        """Return a valid Firestore document path, falling back to the live UI doc."""
        clean_path = (path or "worldState/live").strip("/")
        if len(clean_path.split("/")) % 2 == 0:
            return clean_path
        logger.warning("Invalid FIREBASE_WORLD_STATE_DOC_PATH=%s. Using worldState/live.", path)
        return "worldState/live"

    @staticmethod
    def _build_credentials(service_account_module):
        """Build optional explicit service-account credentials.

        Cloud Run should normally use Application Default Credentials through
        the service identity, so this returns None unless an explicit local
        path or JSON payload is configured.
        """
        service_account_value = settings.FIREBASE_SERVICE_ACCOUNT_JSON.strip()
        if service_account_value:
            if os.path.exists(service_account_value):
                return service_account_module.Credentials.from_service_account_file(service_account_value)
            return service_account_module.Credentials.from_service_account_info(json.loads(service_account_value))

        if settings.FIREBASE_CREDENTIALS_PATH:
            return service_account_module.Credentials.from_service_account_file(settings.FIREBASE_CREDENTIALS_PATH)

        return None


# Singleton instance
_firestore_manager: Optional[FirestoreManager] = None


def get_firestore_manager() -> FirestoreManager:
    """Get or create Firestore manager singleton."""
    global _firestore_manager
    if _firestore_manager is None:
        _firestore_manager = FirestoreManager()
    return _firestore_manager
