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

# ---------------------------------------------------------------------------
# Test database URLs — derived from the application DB URL, no env var fallback.
# If the application URL is misconfigured this will fail loudly at collection time.
# ---------------------------------------------------------------------------

TEST_DB_NAME = "akleg_liaison_test"

REGISTRATION_KEY = settings.registration_key


def _derive_urls(app_url: str) -> tuple[str, str]:
    """
    Derive the maintenance URL (raw asyncpg) and test DB URL (SQLAlchemy) from
    the application database URL.

    app_url example:  postgresql+asyncpg://fibonacci:pass@localhost:5432/akleg_liaison
    Returns:
      maintenance_url  postgresql://fibonacci:pass@localhost:5432/postgres
      test_db_url      postgresql+asyncpg://fibonacci:pass@localhost:5432/akleg_liaison_test
    """
    # asyncpg.connect does not accept the SQLAlchemy driver specifier
    asyncpg_base = app_url.replace("postgresql+asyncpg://", "postgresql://").rsplit("/", 1)[0]
    maintenance_url = f"{asyncpg_base}/postgres"

    sqlalchemy_base = app_url.rsplit("/", 1)[0]
    test_db_url = f"{sqlalchemy_base}/{TEST_DB_NAME}"

    return maintenance_url, test_db_url


MAINTENANCE_URL, TEST_DB_URL = _derive_urls(settings.database_url)


# ---------------------------------------------------------------------------
# Session-scoped DB lifecycle  (synchronous — uses asyncio.run internally)
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
    """
    A single DB connection per test with an open transaction.
    Rolled back at teardown — no test data ever reaches disk.
    """
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.connect() as conn:
        await conn.begin()
        yield conn
        await conn.rollback()
    await engine.dispose()


@pytest.fixture
async def db(_conn):
    """Session for seeding data in tests; shares the outer test transaction."""
    session = AsyncSession(_conn, expire_on_commit=False, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        await session.close()


@pytest.fixture
async def client(_conn):
    """
    AsyncClient wired to the FastAPI app.
    Each request gets its own session bound to the same connection as `db`,
    so route handler commits only release savepoints within the outer transaction.
    """
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
    """Short unique ID so test-created usernames/labels never collide within a run."""
    return uuid.uuid4().hex[:8]


# ---------------------------------------------------------------------------
# Convenience helpers
# ---------------------------------------------------------------------------

async def register_user(client: AsyncClient, username: str, password: str, role: str = "viewer") -> dict:
    resp = await client.post("/auth/register", json={
        "username": username,
        "password": password,
        "registration_key": REGISTRATION_KEY,
        "role": role,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def login_user(client: AsyncClient, username: str, password: str) -> str:
    """Returns the access token."""
    resp = await client.post(
        "/auth/login",
        data={"username": username, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]
