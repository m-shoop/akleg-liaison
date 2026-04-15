import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user, get_optional_current_user, require_permission
from app.models.workflow import WorkflowActionType, WorkflowType
from app.repositories.audit_log_repository import log_action
from app.repositories.bill_repository import get_bill_by_id, set_bill_tracked
from app.repositories.workflow_repository import (
    add_workflow_action,
    close_open_workflows_for_bill,
    create_bill_tracking_workflow,
    get_open_workflow_for_bill_by_user,
    get_workflow_by_id,
    has_open_workflows,
    list_workflows,
    user_has_any_workflow_for_bill,
)
from app.schemas.workflow import (
    AddActionRequest,
    CreateWorkflowRequest,
    HasOpenResponse,
    WorkflowRead,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workflows", tags=["workflows"])


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

    if current_user.can("workflow:view-all"):
        result = await has_open_workflows(db)
    else:
        result = await has_open_workflows(db, created_by_user_id=current_user.user.id)

    return HasOpenResponse(has_open=result)


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


@router.post("/{workflow_id}/actions", response_model=WorkflowRead, status_code=201)
async def add_action(
    workflow_id: int,
    body: AddActionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("workflow:approve-tracking")),
):
    """
    Add an action to an existing workflow.

    For approve_bill_tracking:
    - Marks the bill as tracked.
    - Adds approve action to all open request_bill_tracking workflows for that bill.
    - Closes all those workflows.

    For deny_bill_tracking:
    - Adds deny action to all open request_bill_tracking workflows for that bill.
    - Closes all those workflows.
    """
    workflow = await get_workflow_by_id(db, workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if workflow.status.value == "closed":
        raise HTTPException(status_code=409, detail="Workflow is already closed")

    allowed_action_types = {
        WorkflowActionType.APPROVE_BILL_TRACKING,
        WorkflowActionType.DENY_BILL_TRACKING,
    }
    if body.type not in allowed_action_types:
        raise HTTPException(
            status_code=422,
            detail=f"Action type must be one of: {', '.join(t.value for t in allowed_action_types)}",
        )

    # Determine the bill associated with this workflow
    btr = workflow.bill_tracking_request
    if btr is None:
        raise HTTPException(status_code=400, detail="Workflow has no associated bill")

    bill_id = btr.bill_id

    # For approve: mark bill as tracked first
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

    # Close all open workflows for this bill with the given action
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

    # Reload the original workflow for response
    refreshed = await get_workflow_by_id(db, workflow_id)
    return WorkflowRead.from_orm(refreshed)
