"""
Persists background jobs to PostgreSQL.
"""

import uuid

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job, JobStatus


async def create_job(session: AsyncSession, job_type: str) -> uuid.UUID:
    """Insert a new PENDING job and return its UUID."""
    stmt = (
        insert(Job)
        .values(job_type=job_type, status=JobStatus.PENDING)
        .returning(Job.id)
    )
    result = await session.execute(stmt)
    return result.scalar_one()


async def get_job(session: AsyncSession, job_id: uuid.UUID) -> Job | None:
    """Fetch a job by ID."""
    stmt = select(Job).where(Job.id == job_id)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def set_job_running(session: AsyncSession, job_id: uuid.UUID) -> None:
    """Mark a job as running."""
    stmt = update(Job).where(Job.id == job_id).values(status=JobStatus.RUNNING)
    await session.execute(stmt)


async def set_job_complete(
    session: AsyncSession, job_id: uuid.UUID, result: dict
) -> None:
    """Mark a job as complete and store its result payload."""
    stmt = (
        update(Job)
        .where(Job.id == job_id)
        .values(status=JobStatus.COMPLETE, result=result)
    )
    await session.execute(stmt)


async def set_job_failed(
    session: AsyncSession, job_id: uuid.UUID, error: str
) -> None:
    """Mark a job as failed and store the error message."""
    stmt = (
        update(Job)
        .where(Job.id == job_id)
        .values(status=JobStatus.FAILED, error=error)
    )
    await session.execute(stmt)
