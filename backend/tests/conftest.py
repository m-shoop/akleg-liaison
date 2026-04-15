"""
Shared pytest fixtures for the test suite.

Database strategy:
  1. Before any tests run, a fresh 'akleg_liaison_test' database is created on
     the same server as the application database (dropping any pre-existing DB
     with that name first), and Alembic migrations are applied to it.
  2. Each test runs inside a single connection whose outer transaction is rolled
     back at teardown — no test data ever reaches disk.  Route handlers get
     sessions that use SAVEPOINT semantics (join_transaction_mode="create_savepoint")
     so their session.commit() calls only release savepoints within that transaction.
  3. After all tests complete the test database is dropped.

Prerequisite: the application DB user must have CREATEDB privilege.
  ALTER USER fibonacci CREATEDB;
"""

import asyncio
import os
import uuid

import asyncpg
import pytest
from alembic import command
from alembic.config import Config
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.config import settings
from app.database import get_db
from app.main import app
from app.models.user import TokenType, UserStatus
from app.repositories.user_repository import (
    create_user,
    get_user_by_email,
    upsert_user_token,
)
from app.services.auth_service import hash_password, generate_token, hash_token

# ---------------------------------------------------------------------------
# Test database URLs
# ---------------------------------------------------------------------------

TEST_DB_NAME = "akleg_liaison_test"


def _derive_urls(app_url: str) -> tuple[str, str]:
    asyncpg_base = app_url.replace("postgresql+asyncpg://", "postgresql://").rsplit("/", 1)[0]
    maintenance_url = f"{asyncpg_base}/postgres"
    sqlalchemy_base = app_url.rsplit("/", 1)[0]
    test_db_url = f"{sqlalchemy_base}/{TEST_DB_NAME}"
    return maintenance_url, test_db_url


MAINTENANCE_URL, TEST_DB_URL = _derive_urls(settings.database_url)


# ---------------------------------------------------------------------------
# Session-scoped DB lifecycle
# ---------------------------------------------------------------------------

async def _create_db() -> None:
    conn = await asyncpg.connect(MAINTENANCE_URL)
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB_NAME}"')
        await conn.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')
    finally:
        await conn.close()


async def _drop_db() -> None:
    conn = await asyncpg.connect(MAINTENANCE_URL)
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB_NAME}"')
    finally:
        await conn.close()


def _run_migrations() -> None:
    ini_path = os.path.join(os.path.dirname(__file__), "..", "alembic.ini")
    alembic_cfg = Config(ini_path)
    alembic_cfg.set_main_option("sqlalchemy.url", TEST_DB_URL)
    command.upgrade(alembic_cfg, "head")


@pytest.fixture(scope="session", autouse=True)
def test_database():
    """Create the test DB, apply all migrations, yield, then drop the DB."""
    asyncio.run(_create_db())
    _run_migrations()
    yield
    asyncio.run(_drop_db())


# ---------------------------------------------------------------------------
# Per-test transaction isolation
# ---------------------------------------------------------------------------

@pytest.fixture
async def _conn(test_database):
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.connect() as conn:
        await conn.begin()
        yield conn
        await conn.rollback()
    await engine.dispose()


@pytest.fixture
async def db(_conn):
    session = AsyncSession(_conn, expire_on_commit=False, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        await session.close()


@pytest.fixture
async def client(_conn):
    async def override_get_db():
        session = AsyncSession(_conn, expire_on_commit=False, join_transaction_mode="create_savepoint")
        try:
            yield session
        finally:
            await session.close()

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def uid():
    """Short unique ID so test-created emails never collide within a run."""
    return uuid.uuid4().hex[:8]


# ---------------------------------------------------------------------------
# Convenience helpers
# ---------------------------------------------------------------------------

async def seed_inactive_user(
    db: AsyncSession,
    email: str,
    role: str = "viewer",
) -> None:
    """Insert a user directly into the DB with Inactive status and no password."""
    await create_user(db, email=email, role_name=role)
    await db.commit()


async def seed_active_user(
    db: AsyncSession,
    email: str,
    password: str,
    role: str = "viewer",
) -> None:
    """Insert a fully active user with a hashed password."""
    hashed = hash_password(password)
    await create_user(
        db,
        email=email,
        role_name=role,
        hashed_password=hashed,
        user_status=UserStatus.active,
    )
    await db.commit()


async def seed_user_token(
    db: AsyncSession,
    email: str,
    token_type: TokenType,
) -> str:
    """
    Insert a registration or password-reset token for an existing user.
    Returns the raw (unhashed) token so tests can submit it.
    """
    from datetime import datetime, timedelta, timezone

    user = await get_user_by_email(db, email)
    assert user is not None, f"User {email} not found — seed the user first"

    raw = generate_token()
    hashed = hash_token(raw)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
    await upsert_user_token(db, user.id, token_type, hashed, expires_at)
    await db.commit()
    return raw


async def login_user(client: AsyncClient, email: str, password: str) -> str:
    """Log in and return the access token."""
    resp = await client.post(
        "/auth/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]
