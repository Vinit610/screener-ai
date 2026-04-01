import os
from typing import Optional

class Config:
    def __init__(self):
        # Supabase
        self.supabase_url: str = self._get_required_env("PIPELINE_SUPABASE_URL")
        self.supabase_service_role_key: str = self._get_required_env("PIPELINE_SUPABASE_SERVICE_ROLE_KEY")
        
        # Gemini AI
        self.gemini_api_key: str = self._get_required_env("GEMINI_API_KEY")
        
        # Upstash Redis
        self.redis_rest_url: str = self._get_required_env("UPSTASH_REDIS_REST_URL")
        self.redis_rest_token: str = self._get_required_env("UPSTASH_REDIS_REST_TOKEN")

    def _get_required_env(self, key: str) -> str:
        value = os.environ.get(key)
        if not value:
            raise ValueError(f"Required environment variable '{key}' is not set. Please check your .env file.")
        return value

# Global config instance
config = Config()