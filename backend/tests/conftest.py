"""
Shared pytest fixtures for the test suite.

Database strategy: tests run against the dev database using regular sessions.
Each test uses a unique short ID (via the `uid` fixture) in usernames and other
identifiers so tests don't collide with each other across runs.

Set TEST_DATABASE_URL to point at a different database if desired:
  export TEST_DATABASE_URL="postgresql+asyncpg://user:pass@localhost:5432/akleg_liaison_test"
"""

import uuid

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.config import settings
from app.database import get_db
from app.main import app

# Use TEST_DATABASE_URL if set, otherwise fall back to the app's configured DB.
import os
TEST_DB_URL = os.getenv("TEST_DATABASE_URL", settings.database_url)


@pytest.fixture
async def client():
    """
    AsyncClient wired to the FastAPI app.

    A fresh engine is created for each test so that asyncpg connections are
    always bound to the current event loop. pytest-asyncio creates a new event
    loop per test function; reusing a module-level engine across loops causes
    asyncpg 'another operation is in progress' errors.

    Each request gets its own session (same as production behaviour).
    """
    engine = create_async_engine(TEST_DB_URL, echo=False)
    TestSession = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with TestSession() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


@pytest.fixture
async def db():
    """Direct DB session for seeding data or making assertions in test code."""
    engine = create_async_engine(TEST_DB_URL, echo=False)
    TestSession = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with TestSession() as session:
        yield session
    await engine.dispose()


@pytest.fixture
def uid():
    """Short unique ID so test-created usernames/labels never collide across runs."""
    return uuid.uuid4().hex[:8]


# ---------------------------------------------------------------------------
# Convenience helpers
# ---------------------------------------------------------------------------

REGISTRATION_KEY = os.getenv("REGISTRATION_KEY", settings.registration_key)


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
