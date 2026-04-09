from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://postgres:password@localhost:5432/akleg_liaison"
    mistral_api_key: str = ""
    secret_key: str
    registration_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 240  # 4 hours


settings = Settings()
