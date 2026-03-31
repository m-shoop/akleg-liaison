"""
Shared pytest fixtures for the test suite.

Database strategy: each test runs inside a single connection whose outer
transaction is rolled back at teardown. Route handlers get sessions that use
SAVEPOINT semantics (join_transaction_mode="create_savepoint") so their
session.commit() calls only release savepoints — the outer transaction is
never committed to disk, and the rollback at the end wipes everything clean.

Set TEST_DATABASE_URL to point at a different database if desired:
  export TEST_DATABASE_URL="postgresql+asyncpg://user:pass@localhost:5432/akleg_liaison_test"
"""

import os
import uuid

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.config import settings
from app.database import get_db
from app.main import app

TEST_DB_URL = os.getenv("TEST_DATABASE_URL", settings.database_url)

REGISTRATION_KEY = os.getenv("REGISTRATION_KEY", settings.registration_key)


@pytest.fixture
async def _conn():
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
