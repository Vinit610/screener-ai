"""
Cache helpers backed by Upstash Redis.
All operations are wrapped in try/except — the app works without Redis (just uncached).
"""
import json
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

_redis_client = None

try:
    import redis as redis_lib
    from config import settings

    url = settings.upstash_redis_rest_url
    token = settings.upstash_redis_rest_token

    # Upstash supports the standard Redis protocol via rediss:// in addition to
    # the HTTP REST API.  If the URL looks like an HTTP REST endpoint we skip
    # the redis client and fall back to no-cache mode rather than crashing.
    if url.startswith("redis://") or url.startswith("rediss://"):
        _redis_client = redis_lib.from_url(url, password=token, decode_responses=True)
        # Ping to verify connectivity at startup (optional — failures are non-fatal)
        try:
            _redis_client.ping()
        except Exception as ping_err:
            logger.warning("Redis ping failed — caching disabled: %s", ping_err)
            _redis_client = None
    else:
        logger.info("UPSTASH_REDIS_REST_URL is an HTTP REST URL; caching disabled in this environment.")
except Exception as exc:
    logger.warning("Could not initialise Redis client — caching disabled: %s", exc)


def get_cache(key: str) -> Optional[Any]:
    """Return cached value (deserialised from JSON) or None on miss/error."""
    if _redis_client is None:
        return None
    try:
        raw = _redis_client.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as exc:
        logger.warning("Cache GET failed for key %r: %s", key, exc)
        return None


def set_cache(key: str, value: Any, ex: int = 3600) -> bool:
    """Serialise value to JSON and store.  Returns False on error."""
    if _redis_client is None:
        return False
    try:
        _redis_client.set(key, json.dumps(value, default=str), ex=ex)
        return True
    except Exception as exc:
        logger.warning("Cache SET failed for key %r: %s", key, exc)
        return False