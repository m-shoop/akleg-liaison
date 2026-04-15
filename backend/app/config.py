from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://postgres:password@localhost:5432/akleg_liaison"
    mistral_api_key: str = ""
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 240  # 4 hours

    postmark_server_token: str = ""
    frontend_base_url: str = "https://www.aklegup.com"
    cookie_secure: bool = True


settings = Settings()
