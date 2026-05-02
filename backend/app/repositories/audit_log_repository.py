from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.user import User


def _client_ip(request: Request | None) -> str | None:
    if request is None or request.client is None:
        return None
    return request.client.host


async def log_action(
    db: AsyncSession,
    user: User,
    action: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    details: dict | None = None,
    target_user_id: int | None = None,
    request: Request | None = None,
) -> None:
    entry = AuditLog(
        user_id=user.id,
        username=user.email,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        target_user_id=target_user_id,
        ip_address=_client_ip(request),
        details=details,
    )
    db.add(entry)


async def log_system_action(
    db: AsyncSession,
    action: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    details: dict | None = None,
    target_user_id: int | None = None,
    request: Request | None = None,
) -> None:
    """Audit entry with no authenticated actor — scheduler jobs and pre-auth
    routes (registration / password reset requests) where the request is
    anonymous but may target a known user."""
    entry = AuditLog(
        user_id=None,
        username="system",
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        target_user_id=target_user_id,
        ip_address=_client_ip(request),
        details=details,
    )
    db.add(entry)
