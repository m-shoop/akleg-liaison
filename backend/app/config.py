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

    # Worker that drains pending email_notifications rows. Disabled in tests so
    # tests assert directly against the queue.
    email_notification_worker_enabled: bool = True
    # Drain interval and per-iteration batch size for the notification worker.
    email_notification_worker_interval_seconds: int = 30
    email_notification_worker_batch_size: int = 25


settings = Settings()
