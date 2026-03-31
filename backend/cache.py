import redis
from config import settings

redis_client = redis.from_url(settings.upstash_redis_rest_url, password=settings.upstash_redis_rest_token)

def get_cache(key: str) -> str | None:
    return redis_client.get(key)

def set_cache(key: str, value: str, ex: int = 3600):
    redis_client.set(key, value, ex=ex)