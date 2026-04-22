import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user, get_optional_current_user, require_permission
from app.models.workflow import WorkflowActionType, WorkflowType
from app.repositories.audit_log_repository import log_action
from app.repositories.bill_repository import get_bill_by_id, set_bill_tracked
from app.repositories.hearing_repository import get_hearing_by_id
from app.repositories.user_repository import get_user_by_email, search_users_by_email
from app.repositories.bill_repository import get_bill_by_number
from app.repositories.workflow_repository import (
    add_workflow_action,
    close_open_workflows_for_bill,
    close_workflows,
    create_bill_tracking_workflow,
    create_hearing_assignment_workflow,
    get_bill_tracking_state,
    get_open_workflow_for_bill_by_user,
    get_workflow_by_id,
    has_open_hearing_assignments,
    has_open_workflows,
    list_workflows,
    update_hearing_assignment_assignee,
    user_has_any_workflow_for_bill,
)
from app.schemas.workflow import (
    AddActionRequest,
    BillTrackingStateItem,
    BillTrackingStateRequest,
    CreateHearingAssignmentRequest,
    CreateWorkflowRequest,
    HasOpenResponse,
    HearingAssignmentRead,
    WorkflowRead,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workflows", tags=["workflows"])


# ---------------------------------------------------------------------------
# GET /workflows/assignees
# ---------------------------------------------------------------------------


@router.get("/assignees", response_model=list[str], dependencies=[Depends(require_permission("workflow:view-all"))])
async def search_assignees(
    q: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    """Return emails of active users matching the search query (for assignment comboboxes)."""
    users = await search_users_by_email(db, q)
    return [u.email for u in users]


# ---------------------------------------------------------------------------
# GET /workflows/has-open
# ---------------------------------------------------------------------------


@router.get("/has-open", response_model=HasOpenResponse)
async def get_has_open(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser | None = Depends(get_optional_current_user),
):
    """
    Returns whether there are open requests relevant to the current user.
    - Unauthenticated: always false.
    - workflow:view-all: true if any open request_bill_tracking workflow exists.
    - Otherwise: true if the user has any open workflows they created.
    """
    if current_user is None:
        return HasOpenResponse(has_open=False)

    is_admin = current_user.can("workflow:view-all")

    has_requests = await has_open_workflows(
        db, created_by_user_id=None if is_admin else current_user.user.id
    )
    has_assignments = await has_open_hearing_assignments(
        db, assignee_user_id=None if is_admin else current_user.user.id
    )

    return HasOpenResponse(has_open=has_requests or has_assignments)


# ---------------------------------------------------------------------------
# GET /workflows
# ---------------------------------------------------------------------------


@router.get("", response_model=list[WorkflowRead])
async def list_workflows_route(
    include_closed: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Fetch workflows of type request_bill_tracking.
    - workflow:view-all: see all workflows.
    - Otherwise: only see workflows the user created.
    """
    if current_user.can("workflow:view-all"):
        workflows = await list_workflows(db, include_closed=include_closed)
    else:
        workflows = await list_workflows(
            db,
            include_closed=include_closed,
            created_by_user_id=current_user.user.id,
        )

    return [WorkflowRead.from_orm(wf) for wf in workflows]


# ---------------------------------------------------------------------------
# POST /workflows/bill-tracking-state
# ---------------------------------------------------------------------------


@router.post("/bill-tracking-state", response_model=list[BillTrackingStateItem])
async def get_bill_tracking_state_route(
    body: BillTrackingStateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[BillTrackingStateItem]:
    """Return tracking request state for a list of bill IDs for the current user."""
    state = await get_bill_tracking_state(db, body.bill_ids, current_user.user.id)
    return [
        BillTrackingStateItem(
            bill_id=bid,
            tracking_requested=s["tracking_requested"],
            user_tracking_request_denied=s["user_tracking_request_denied"],
        )
        for bid, s in state.items()
    ]


# ---------------------------------------------------------------------------
# POST /workflows/hearing-assignment
# ---------------------------------------------------------------------------


@router.post("/hearing-assignment", response_model=HearingAssignmentRead, status_code=201)
async def create_hearing_assignment(
    body: CreateHearingAssignmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("workflow:view-all")),
):
    """
    Create a manual hearing_assignment workflow.

    Resolves assignee by email and (optionally) bill by number.
    Creates the workflow, HearingAssignment record, and initial hearing_assigned action.
    """
    hearing = await get_hearing_by_id(db, body.hearing_id)
    if hearing is None:
        raise HTTPException(status_code=404, detail="Hearing not found")

    assignee = await get_user_by_email(db, body.assignee_email)
    if assignee is None:
        raise HTTPException(status_code=404, detail=f"User '{body.assignee_email}' not found")

    bill = None
    if body.bill_number:
        bill = await get_bill_by_number(db, body.bill_number, hearing.legislature_session)
        if bill is None:
            raise HTTPException(status_code=404, detail=f"Bill '{body.bill_number}' not found")

    workflow = await create_hearing_assignment_workflow(
        db,
        hearing_id=body.hearing_id,
        assignee_id=assignee.id,
        bill_id=bill.id if bill else None,
        created_by_user_id=current_user.user.id,
    )
    await log_action(
        db,
        current_user.user,
        "hearing_assignment_created",
        entity_type="workflow",
        entity_id=workflow.id,
        details={
            "hearing_id": body.hearing_id,
            "assignee_id": assignee.id,
            "bill_id": bill.id if bill else None,
        },
    )
    await db.commit()

    await db.refresh(workflow, ["hearing_assignment"])
    return workflow.hearing_assignment


# ---------------------------------------------------------------------------
# POST /workflows
# ---------------------------------------------------------------------------


@router.post("", response_model=WorkflowRead, status_code=201)
async def create_workflow(
    body: CreateWorkflowRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("bill:request-tracking")),
):
    """
    Create a new request_bill_tracking workflow for a bill.

    Fails if:
    - The bill does not exist.
    - The user already has an open request for this bill.
    - The user has a previous (closed/denied) request for this bill.
    """
    bill = await get_bill_by_id(db, body.bill_id)
    if bill is None:
        raise HTTPException(status_code=404, detail="Bill not found")

    # Check for existing open workflow by this user for this bill
    existing_open = await get_open_workflow_for_bill_by_user(
        db, body.bill_id, current_user.user.id
    )
    if existing_open is not None:
        raise HTTPException(
            status_code=409,
            detail="bill tracking already requested",
        )

    # Check for any previous workflow (open or closed) for this bill by this user
    has_previous = await user_has_any_workflow_for_bill(
        db, body.bill_id, current_user.user.id
    )
    # If they have previous AND no open, it means it was denied
    if has_previous:
        raise HTTPException(
            status_code=409,
            detail="previous bill tracking request has been denied",
        )

    workflow = await create_bill_tracking_workflow(
        db, bill_id=body.bill_id, created_by_user_id=current_user.user.id
    )
    await log_action(
        db,
        current_user.user,
        "workflow_created",
        entity_type="workflow",
        entity_id=workflow.id,
        details={"workflow_type": WorkflowType.REQUEST_BILL_TRACKING, "bill_id": body.bill_id, "bill_number": bill.bill_number},
    )
    await db.commit()

    # Reload with relations for the response
    refreshed = await get_workflow_by_id(db, workflow.id)
    return WorkflowRead.from_orm(refreshed)


# ---------------------------------------------------------------------------
# POST /workflows/{id}/actions
# ---------------------------------------------------------------------------


_HEARING_ASSIGNMENT_ACTIONS = {
    WorkflowActionType.HEARING_ASSIGNED,
    WorkflowActionType.HEARING_ASSIGNMENT_COMPLETE,
    WorkflowActionType.HEARING_ASSIGNMENT_CANCELED,
    WorkflowActionType.REASSIGNMENT_REQUEST,
    WorkflowActionType.HEARING_ASSIGNMENT_DISCARDED,
}

_HEARING_ASSIGNMENT_ADMIN_ACTIONS = {
    WorkflowActionType.HEARING_ASSIGNED,
    WorkflowActionType.HEARING_ASSIGNMENT_CANCELED,
    WorkflowActionType.HEARING_ASSIGNMENT_DISCARDED,
}

_HEARING_ASSIGNMENT_TERMINAL_ACTIONS = {
    WorkflowActionType.HEARING_ASSIGNMENT_COMPLETE,
    WorkflowActionType.HEARING_ASSIGNMENT_CANCELED,
    WorkflowActionType.HEARING_ASSIGNMENT_DISCARDED,
}


@router.post("/{workflow_id}/actions", response_model=WorkflowRead, status_code=201)
async def add_action(
    workflow_id: int,
    body: AddActionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Add an action to an existing workflow.

    For request_bill_tracking workflows (requires workflow:approve-tracking):
    - approve_bill_tracking: marks the bill tracked, closes all open workflows for that bill.
    - deny_bill_tracking: closes all open workflows for that bill.

    For hearing_assignment workflows:
    - Admin actions (workflow:view-all): hearing_assigned, hearing_assignment_canceled,
      hearing_assignment_discarded.
    - Assignee or admin actions: hearing_assignment_complete, reassignment_request.
    - Terminal actions (complete, canceled, discarded) close the workflow.
    """
    workflow = await get_workflow_by_id(db, workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if workflow.status.value == "closed":
        raise HTTPException(status_code=409, detail="Workflow is already closed")

    # ── Hearing assignment branch ────────────────────────────────────────────
    if workflow.type == WorkflowType.HEARING_ASSIGNMENT:
        if body.type not in _HEARING_ASSIGNMENT_ACTIONS:
            raise HTTPException(
                status_code=422,
                detail=f"Action type must be one of: {', '.join(t.value for t in _HEARING_ASSIGNMENT_ACTIONS)}",
            )

        ha = workflow.hearing_assignment
        if ha is None:
            raise HTTPException(status_code=400, detail="Workflow has no hearing assignment record")

        is_admin = current_user.can("workflow:view-all")
        is_assignee = ha.assignee_id == current_user.user.id

        if body.type in _HEARING_ASSIGNMENT_ADMIN_ACTIONS and not is_admin:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if body.type not in _HEARING_ASSIGNMENT_ADMIN_ACTIONS and not is_assignee and not is_admin:
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # For hearing_assigned, optionally re-assign to a different user
        new_assignee_id = None
        if body.type == WorkflowActionType.HEARING_ASSIGNED and body.new_assignee_email:
            new_assignee = await get_user_by_email(db, body.new_assignee_email)
            if new_assignee is None:
                raise HTTPException(status_code=404, detail=f"User '{body.new_assignee_email}' not found")
            new_assignee_id = new_assignee.id
            await update_hearing_assignment_assignee(db, ha.id, new_assignee_id)

        await add_workflow_action(db, workflow, body.type, current_user.user.id)

        if body.type in _HEARING_ASSIGNMENT_TERMINAL_ACTIONS:
            await close_workflows(db, [workflow.id])

        await log_action(
            db,
            current_user.user,
            "workflow_action_added",
            entity_type="workflow",
            entity_id=workflow_id,
            details={
                "action_type": body.type.value,
                "hearing_assignment_id": ha.id,
                **({"new_assignee_id": new_assignee_id} if new_assignee_id else {}),
            },
        )
        await db.commit()

        refreshed = await get_workflow_by_id(db, workflow_id)
        return WorkflowRead.from_orm(refreshed)

    # ── Bill tracking branch ─────────────────────────────────────────────────
    if not current_user.can("workflow:approve-tracking"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    allowed_action_types = {
        WorkflowActionType.APPROVE_BILL_TRACKING,
        WorkflowActionType.DENY_BILL_TRACKING,
    }
    if body.type not in allowed_action_types:
        raise HTTPException(
            status_code=422,
            detail=f"Action type must be one of: {', '.join(t.value for t in allowed_action_types)}",
        )

    btr = workflow.bill_tracking_request
    if btr is None:
        raise HTTPException(status_code=400, detail="Workflow has no associated bill")

    bill_id = btr.bill_id

    if body.type == WorkflowActionType.APPROVE_BILL_TRACKING:
        await set_bill_tracked(db, bill_id, True)
        await log_action(
            db,
            current_user.user,
            "bill_tracked",
            entity_type="bill",
            entity_id=bill_id,
            details={"source": "workflow_approval", "workflow_id": workflow_id},
        )

    affected_workflows = await close_open_workflows_for_bill(
        db,
        bill_id=bill_id,
        action_type=body.type,
        acting_user_id=current_user.user.id,
    )

    await log_action(
        db,
        current_user.user,
        "workflow_action_added",
        entity_type="workflow",
        entity_id=workflow_id,
        details={
            "action_type": body.type.value,
            "bill_id": bill_id,
            "affected_workflow_ids": [wf.id for wf in affected_workflows],
        },
    )
    await db.commit()

    refreshed = await get_workflow_by_id(db, workflow_id)
    return WorkflowRead.from_orm(refreshed)
