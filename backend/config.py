from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    upstash_redis_rest_url: str
    upstash_redis_rest_token: str
    gemini_api_key: str
    allowed_origins: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()