import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user, require_permission
from app.models.saved_report import PublicationLevel, SavedReport
from app.reporting.registry import REPORTS
from app.repositories.audit_log_repository import log_action
from app.repositories.saved_report_repository import (
    ADMIN_ROLE,
    clear_default_report,
    create_saved_report,
    get_default_report,
    get_existing_role_names,
    get_report_by_id,
    is_report_visible_to,
    list_roles,
    list_visible_reports,
    reorder_report,
    set_default_report,
    sort_reports_alphabetically,
    update_saved_report,
)
from app.repositories.user_repository import get_user_roles
from app.schemas.saved_report import (
    DefaultUserReportSet,
    ReorderReportRequest,
    RoleRead,
    SavedReportCreate,
    SavedReportListResponse,
    SavedReportRead,
    SavedReportUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["saved-reports"])


def _validate_registry_name(registry_name: str) -> None:
    if registry_name not in REPORTS:
        raise HTTPException(status_code=422, detail=f"Unknown report registry: '{registry_name}'")


async def _validate_role_names(db: AsyncSession, names: list[str]) -> None:
    if ADMIN_ROLE in names:
        # Admins satisfy any role gate by bypass; allowing "admin" in
        # allowed_roles would let an admin lock themselves out of a system
        # report (the picker hides admin for the same reason).
        raise HTTPException(
            status_code=422,
            detail=f"'{ADMIN_ROLE}' cannot appear in allowed_roles",
        )
    existing = await get_existing_role_names(db, names)
    missing = sorted(set(names) - existing)
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown roles: {', '.join(missing)}",
        )


async def _caller_roles(db: AsyncSession, user_id: int) -> frozenset[str]:
    return frozenset(await get_user_roles(db, user_id))


# ---------------------------------------------------------------------------
# List + create
# ---------------------------------------------------------------------------

@router.get("/user-reports/{registry_name}", response_model=SavedReportListResponse)
async def list_user_reports(
    registry_name: str,
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SavedReportListResponse:
    """List the caller's user-level reports plus visible system-level reports
    for the given registry. The default_report_id field reflects this user's
    personal default for this registry, if any."""
    _validate_registry_name(registry_name)

    user_roles = await _caller_roles(db, current_user.user.id)
    rows = await list_visible_reports(
        db,
        user_id=current_user.user.id,
        user_roles=user_roles,
        registry_name=registry_name,
        include_inactive=include_inactive,
    )
    default = await get_default_report(db, current_user.user.id, registry_name)
    reports = [
        SavedReportRead.model_validate(r).model_copy(update={"sort_key": sort_key})
        for (r, sort_key) in rows
    ]
    return SavedReportListResponse(
        reports=reports,
        default_report_id=default.report_id if default else None,
    )


@router.post("/user-report", response_model=SavedReportRead, status_code=201)
async def create_report(
    body: SavedReportCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SavedReportRead:
    _validate_registry_name(body.registry_name)

    # Authorization branches on publication_level: each level needs its own permission.
    if body.publication_level == PublicationLevel.user:
        if not current_user.can("user-report:edit"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        user_id = current_user.user.id
        # allowed_roles is a system-level concept; ignore on user-level rows.
        allowed_roles: list[str] = []
    else:  # system
        if not current_user.can("system-report:edit"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if body.allowed_roles:
            await _validate_role_names(db, body.allowed_roles)
        user_id = None
        allowed_roles = body.allowed_roles

    try:
        report = await create_saved_report(
            db,
            display_name=body.display_name,
            registry_name=body.registry_name,
            publication_level=body.publication_level,
            user_id=user_id,
            allowed_roles=allowed_roles,
            report_criteria=body.report_criteria,
        )
        await db.flush()
        await log_action(
            db,
            current_user.user,
            "saved_report_created",
            entity_type="saved_report",
            entity_id=report.id,
            details={
                "registry_name": body.registry_name,
                "publication_level": body.publication_level.value,
                "display_name": body.display_name,
                "allowed_roles": allowed_roles,
            },
            request=request,
        )
        await db.commit()
    except Exception as exc:
        await db.rollback()
        if "uq_saved_reports" in str(exc):
            raise HTTPException(status_code=409, detail="A report with that name already exists")
        raise

    await db.refresh(report)
    return SavedReportRead.model_validate(report)


# ---------------------------------------------------------------------------
# Update (partial)
# ---------------------------------------------------------------------------

@router.put("/user-reports/{report_id}", response_model=SavedReportRead)
async def update_report(
    report_id: int,
    body: SavedReportUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SavedReportRead:
    report = await get_report_by_id(db, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")

    # Authorization: user-level rows are owner-edited; system-level needs system-report:edit.
    if report.publication_level == PublicationLevel.user:
        if report.user_id != current_user.user.id or not current_user.can("user-report:edit"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        # user-level rows never carry allowed_roles; reject changes to it.
        if body.allowed_roles is not None:
            raise HTTPException(
                status_code=422,
                detail="allowed_roles is only valid for system-level reports",
            )
    else:  # system
        if not current_user.can("system-report:edit"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if body.allowed_roles:
            await _validate_role_names(db, body.allowed_roles)

    # Inactive rows can only be reactivated — no content edits while inactive.
    if not report.is_active:
        non_status_fields_set = any(
            v is not None
            for v in (body.display_name, body.report_criteria, body.allowed_roles)
        )
        if non_status_fields_set:
            raise HTTPException(
                status_code=409,
                detail="Inactive reports cannot be edited; reactivate first",
            )

    changed_fields = sorted(body.model_dump(exclude_unset=True).keys())
    try:
        await update_saved_report(
            db,
            report,
            display_name=body.display_name,
            report_criteria=body.report_criteria,
            is_active=body.is_active,
            allowed_roles=body.allowed_roles,
        )
        await log_action(
            db,
            current_user.user,
            "saved_report_updated",
            entity_type="saved_report",
            entity_id=report.id,
            details={
                "publication_level": report.publication_level.value,
                "registry_name": report.registry_name,
                "changed_fields": changed_fields,
            },
            request=request,
        )
        await db.commit()
    except Exception as exc:
        await db.rollback()
        if "uq_saved_reports" in str(exc):
            raise HTTPException(status_code=409, detail="A report with that name already exists")
        raise

    await db.refresh(report)
    return SavedReportRead.model_validate(report)


# ---------------------------------------------------------------------------
# Default report
# ---------------------------------------------------------------------------

@router.put("/default-user-reports/{registry_name}", status_code=204)
async def set_default_user_report(
    registry_name: str,
    body: DefaultUserReportSet,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Upsert the caller's default report for a registry. Body {report_id: null}
    clears the default."""
    _validate_registry_name(registry_name)

    if body.report_id is None:
        await clear_default_report(db, current_user.user.id, registry_name)
        await log_action(
            db,
            current_user.user,
            "default_report_cleared",
            entity_type="saved_report",
            details={"registry_name": registry_name},
            request=request,
        )
        await db.commit()
        return

    report = await get_report_by_id(db, body.report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.registry_name != registry_name:
        raise HTTPException(
            status_code=422,
            detail="Report's registry_name does not match the path",
        )
    user_roles = await _caller_roles(db, current_user.user.id)
    visible = await is_report_visible_to(
        db, report, user_id=current_user.user.id, user_roles=user_roles
    )
    if not visible:
        raise HTTPException(status_code=403, detail="Report not accessible")
    if not report.is_active:
        raise HTTPException(
            status_code=409,
            detail="Inactive reports cannot be set as default; reactivate first",
        )

    await set_default_report(db, current_user.user.id, registry_name, body.report_id)
    await log_action(
        db,
        current_user.user,
        "default_report_set",
        entity_type="saved_report",
        entity_id=body.report_id,
        details={"registry_name": registry_name},
        request=request,
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Role picker source (admin-only)
# ---------------------------------------------------------------------------

@router.get("/roles", response_model=list[RoleRead])
async def list_all_roles(
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_permission("system-report:edit")),
) -> list[RoleRead]:
    roles = await list_roles(db)
    return [RoleRead.model_validate(r) for r in roles if r.name != ADMIN_ROLE]


# ---------------------------------------------------------------------------
# Per-user ordering
# ---------------------------------------------------------------------------

async def _require_section_neighbour(
    db: AsyncSession,
    *,
    moved: SavedReport,
    neighbour_id: int | None,
    user_id: int,
    user_roles: frozenset[str],
    label: str,
) -> None:
    """Validate that a before/after neighbour exists, is in the same registry
    and section as the moved report, and is visible to the caller."""
    if neighbour_id is None:
        return
    if neighbour_id == moved.id:
        raise HTTPException(
            status_code=422, detail=f"{label} cannot be the moved report itself"
        )
    neighbour = await get_report_by_id(db, neighbour_id)
    if neighbour is None:
        raise HTTPException(status_code=404, detail=f"{label} report not found")
    if neighbour.registry_name != moved.registry_name:
        raise HTTPException(
            status_code=422, detail=f"{label} report is in a different registry"
        )
    if neighbour.publication_level != moved.publication_level:
        raise HTTPException(
            status_code=422,
            detail="Cannot reorder across System and User sections",
        )
    if not await is_report_visible_to(
        db, neighbour, user_id=user_id, user_roles=user_roles
    ):
        raise HTTPException(status_code=403, detail=f"{label} report not accessible")


@router.put("/user-reports/{registry_name}/order", status_code=204)
async def reorder_user_report(
    registry_name: str,
    body: ReorderReportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("user-report:edit")),
):
    """Move a report inside its section.  `after_id`/`before_id` are the
    neighbours bracketing the new position; either may be null to mean the
    edge of the section."""
    _validate_registry_name(registry_name)

    moved = await get_report_by_id(db, body.report_id)
    if moved is None:
        raise HTTPException(status_code=404, detail="Report not found")
    if moved.registry_name != registry_name:
        raise HTTPException(
            status_code=422,
            detail="Report's registry_name does not match the path",
        )

    user_roles = await _caller_roles(db, current_user.user.id)
    if not await is_report_visible_to(
        db, moved, user_id=current_user.user.id, user_roles=user_roles
    ):
        raise HTTPException(status_code=403, detail="Report not accessible")

    await _require_section_neighbour(
        db,
        moved=moved,
        neighbour_id=body.after_id,
        user_id=current_user.user.id,
        user_roles=user_roles,
        label="after_id",
    )
    await _require_section_neighbour(
        db,
        moved=moved,
        neighbour_id=body.before_id,
        user_id=current_user.user.id,
        user_roles=user_roles,
        label="before_id",
    )

    await reorder_report(
        db,
        user_id=current_user.user.id,
        user_roles=user_roles,
        report=moved,
        after_id=body.after_id,
        before_id=body.before_id,
    )
    await log_action(
        db,
        current_user.user,
        "saved_report_reordered",
        entity_type="saved_report",
        entity_id=moved.id,
        details={
            "registry_name": registry_name,
            "publication_level": moved.publication_level.value,
            "after_id": body.after_id,
            "before_id": body.before_id,
        },
        request=request,
    )
    await db.commit()


@router.post("/user-reports/{registry_name}/order/sort-alphabetical", status_code=204)
async def sort_user_reports_alphabetical(
    registry_name: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("user-report:edit")),
):
    """Reset both sections to alphabetical order by display_name (case
    insensitive).  Sections remain independent — system reports stay above
    user reports."""
    _validate_registry_name(registry_name)

    user_roles = await _caller_roles(db, current_user.user.id)
    await sort_reports_alphabetically(
        db,
        user_id=current_user.user.id,
        user_roles=user_roles,
        registry_name=registry_name,
    )
    await log_action(
        db,
        current_user.user,
        "saved_reports_sorted_alphabetically",
        entity_type="saved_report",
        details={"registry_name": registry_name},
        request=request,
    )
    await db.commit()
