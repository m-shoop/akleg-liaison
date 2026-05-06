import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user, require_permission
from app.models.email import EmailEventType
from app.models.workflow import WorkflowActionType, WorkflowType
from app.repositories.audit_log_repository import log_action
from app.repositories.bill_repository import get_bill_by_id, set_bill_tracked
from app.repositories.comm_prefs_repository import get_email_enabled
from app.repositories.email_repository import upsert_workflow_action_message
from app.repositories.hearing_repository import get_hearing_by_id
from app.repositories.user_repository import get_user_by_email, search_users
from app.repositories.bill_repository import get_bill_by_number
from app.repositories.workflow_repository import (
    add_workflow_action,
    close_open_workflows_for_bill,
    close_workflows,
    create_bill_tracking_workflow,
    create_hearing_assignment_workflow,
    get_bill_tracking_state,
    get_hearing_assignment_with_workflow,
    get_open_workflow_for_bill_by_user,
    get_workflow_by_id,
    list_workflows,
    update_hearing_assignment_assignee,
    update_hearing_assignment_call_in,
    update_hearing_assignment_type,
    user_has_any_workflow_for_bill,
)
from app.services.email_notification_dispatcher import queue_assignment_notification
from app.schemas.workflow import (
    AddActionRequest,
    BillTrackingStateItem,
    BillTrackingStateRequest,
    CreateHearingAssignmentRequest,
    CreateWorkflowRequest,
    HearingAssignmentRead,
    UpdateHearingAssignmentCallInRequest,
    UpdateHearingAssignmentTypeRequest,
    WorkflowRead,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workflows", tags=["workflows"])


# ---------------------------------------------------------------------------
# GET /workflows/assignees
# ---------------------------------------------------------------------------


@router.get("/assignees", dependencies=[Depends(require_permission("workflow:view-all"))])
async def search_assignees(
    q: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    """Return active users matching the query (by email or name).

    Empty q returns the full active-user list so callers can populate a
    dropdown without paging.
    """
    users = await search_users(db, q, limit=500)
    return [{"email": u.email, "name": u.name} for u in users]


# ---------------------------------------------------------------------------
# GET /workflows/assignee-comm-prefs
# ---------------------------------------------------------------------------


@router.get(
    "/assignee-comm-prefs",
    dependencies=[Depends(require_permission("workflow:view-all"))],
)
async def get_assignee_comm_prefs(
    email: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    """Return whether the prospective assignee will receive email notifications.

    Returns 404 if the email doesn't match a user. Liaisons hit this from the
    assignment dialogs to show a heads-up when the target has opted out.
    """
    user = await get_user_by_email(db, email)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return {"email": user.email, "email_enabled": await get_email_enabled(db, user.id)}


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
    request: Request,
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
        assignment_type=body.assignment_type,
    )
    await db.refresh(workflow, ["hearing_assignment", "actions"])
    initial_action = workflow.actions[0]
    await queue_assignment_notification(
        db,
        hearing_assignment_id=workflow.hearing_assignment.id,
        workflow_action_id=initial_action.id,
        event_type=EmailEventType.ASSIGNMENT_CREATED,
        recipient_user_id=assignee.id,
        hearing_id=body.hearing_id,
        bill_id=bill.id if bill else None,
    )
    await log_action(
        db,
        current_user.user,
        "hearing_assignment_created",
        entity_type="workflow",
        entity_id=workflow.id,
        target_user_id=assignee.id,
        details={
            "hearing_id": body.hearing_id,
            "assignee_id": assignee.id,
            "bill_id": bill.id if bill else None,
            "assignment_type": body.assignment_type.value,
        },
        request=request,
    )
    await db.commit()

    await db.refresh(workflow, ["hearing_assignment"])
    return workflow.hearing_assignment


# ---------------------------------------------------------------------------
# PATCH /workflows/hearing-assignments/{assignment_id}
# ---------------------------------------------------------------------------


_TYPE_CHANGE_ACTIVE_ACTIONS = {
    WorkflowActionType.HEARING_ASSIGNED,
    WorkflowActionType.HEARING_REASSIGNED,
    WorkflowActionType.REASSIGNMENT_REQUEST,
    WorkflowActionType.HEARING_ASSIGNMENT_TYPE_CHANGED,
}


@router.patch(
    "/hearing-assignments/{assignment_id}",
    response_model=HearingAssignmentRead,
)
async def update_hearing_assignment_type_route(
    assignment_id: int,
    body: UpdateHearingAssignmentTypeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("workflow:view-all")),
):
    """
    Change the assignment_type on a hearing assignment.

    Two paths, gated on the assignment's current workflow state:

    - **Auto-suggested** (latest action is auto_suggested_hearing_assignment):
      no workflow_action recorded, no email queued — the suggestion hasn't
      been promoted yet, so this is just an admin tweak.

    - **Active** (latest action is hearing_assigned, hearing_reassigned,
      reassignment_request, or a prior type-change): a
      `hearing_assignment_type_changed` workflow_action is recorded and an
      `assignment_type_change` email is queued for the current assignee, with
      both the old and new type available as template variables.

    Terminal states (canceled/discarded/complete) are rejected — the
    assignment is no longer actionable.
    """
    ha = await get_hearing_assignment_with_workflow(db, assignment_id)
    if ha is None:
        raise HTTPException(status_code=404, detail="Hearing assignment not found")

    actions = ha.workflow.actions  # ordered ASC by action_timestamp
    latest = actions[-1] if actions else None
    if latest is None:
        raise HTTPException(status_code=409, detail="Assignment has no workflow actions")

    is_suggestion = latest.type == WorkflowActionType.AUTO_SUGGESTED_HEARING_ASSIGNMENT
    is_active = latest.type in _TYPE_CHANGE_ACTIVE_ACTIONS
    if not (is_suggestion or is_active):
        raise HTTPException(
            status_code=409,
            detail="Assignment type cannot be changed in its current state.",
        )

    if ha.assignment_type == body.assignment_type:
        return ha  # No-op; return current state.

    previous_type = ha.assignment_type
    await update_hearing_assignment_type(db, assignment_id, body.assignment_type)

    if is_active:
        # Record the change as a workflow_action so we have a real FK target
        # for the email_notifications row (and an entry in the workflow's
        # timeline). The reporting layer filters this action type out of
        # `latest_action_type` so the UI's status gating isn't disrupted.
        action = await add_workflow_action(
            db,
            ha.workflow,
            WorkflowActionType.HEARING_ASSIGNMENT_TYPE_CHANGED,
            current_user.user.id,
        )
        await queue_assignment_notification(
            db,
            hearing_assignment_id=ha.id,
            workflow_action_id=action.id,
            event_type=EmailEventType.ASSIGNMENT_TYPE_CHANGED,
            recipient_user_id=ha.assignee_id,
            hearing_id=ha.hearing_id,
            bill_id=ha.bill_id,
            previous_assignment_type=previous_type,
        )

    await log_action(
        db,
        current_user.user,
        "hearing_assignment_type_updated",
        entity_type="hearing_assignment",
        entity_id=assignment_id,
        target_user_id=ha.assignee_id,
        details={
            "from": previous_type.value,
            "to": body.assignment_type.value,
            "active": is_active,
        },
        request=request,
    )
    await db.commit()
    await db.refresh(ha)
    return ha


@router.patch(
    "/hearing-assignments/{assignment_id}/call-in",
    response_model=HearingAssignmentRead,
)
async def update_hearing_assignment_call_in_route(
    assignment_id: int,
    body: UpdateHearingAssignmentCallInRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("workflow:view-all")),
):
    """Set the call_in flag on a hearing assignment (admin-only)."""
    ha = await get_hearing_assignment_with_workflow(db, assignment_id)
    if ha is None:
        raise HTTPException(status_code=404, detail="Hearing assignment not found")

    if ha.call_in == body.call_in:
        return ha

    previous = ha.call_in
    await update_hearing_assignment_call_in(db, assignment_id, body.call_in)
    await log_action(
        db,
        current_user.user,
        "hearing_assignment_call_in_updated",
        entity_type="hearing_assignment",
        entity_id=assignment_id,
        target_user_id=ha.assignee_id,
        details={"from": previous, "to": body.call_in},
        request=request,
    )
    await db.commit()
    await db.refresh(ha)
    return ha


# ---------------------------------------------------------------------------
# POST /workflows
# ---------------------------------------------------------------------------


@router.post("", response_model=WorkflowRead, status_code=201)
async def create_workflow(
    body: CreateWorkflowRequest,
    request: Request,
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
        "bill_tracking_requested",
        entity_type="workflow",
        entity_id=workflow.id,
        details={"bill_id": body.bill_id, "bill_number": bill.bill_number},
        request=request,
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

# Actions only an admin (workflow:view-all) can take. hearing_reassigned is
# emitted internally by the server when an admin submits hearing_assigned with
# a new_assignee_email, so it isn't part of the inbound allow-set.
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

# Audit action name per recorded WorkflowActionType for the HA branch. The
# generic 'workflow_action_added' was hard to query; named actions let us grep
# audit_logs.action directly without parsing the JSON details column.
_HA_AUDIT_ACTION_NAMES = {
    WorkflowActionType.HEARING_ASSIGNED: "hearing_assignment_confirmed",
    WorkflowActionType.HEARING_REASSIGNED: "hearing_reassigned",
    WorkflowActionType.HEARING_ASSIGNMENT_COMPLETE: "hearing_assignment_completed",
    WorkflowActionType.HEARING_ASSIGNMENT_CANCELED: "hearing_assignment_canceled",
    WorkflowActionType.HEARING_ASSIGNMENT_DISCARDED: "hearing_assignment_discarded",
    WorkflowActionType.REASSIGNMENT_REQUEST: "hearing_reassignment_requested",
}


@router.post("/{workflow_id}/actions", response_model=WorkflowRead, status_code=201)
async def add_action(
    workflow_id: int,
    body: AddActionRequest,
    request: Request,
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

        # ── Action type promotion: hearing_assigned + new_assignee_email is
        # a reassignment, recorded as the dedicated hearing_reassigned type.
        is_reassignment = (
            body.type == WorkflowActionType.HEARING_ASSIGNED and bool(body.new_assignee_email)
        )
        recorded_type = (
            WorkflowActionType.HEARING_REASSIGNED if is_reassignment else body.type
        )

        new_assignee_id: int | None = None
        old_assignee_id = ha.assignee_id
        if is_reassignment:
            new_assignee = await get_user_by_email(db, body.new_assignee_email)
            if new_assignee is None:
                raise HTTPException(status_code=404, detail=f"User '{body.new_assignee_email}' not found")
            new_assignee_id = new_assignee.id
            await update_hearing_assignment_assignee(db, ha.id, new_assignee_id)

        action = await add_workflow_action(db, workflow, recorded_type, current_user.user.id)

        # ── Workflow-action messages (e.g. cancellation/reassignment reason) ─
        if body.type == WorkflowActionType.HEARING_ASSIGNMENT_CANCELED and body.cancellation_reason:
            await upsert_workflow_action_message(
                db,
                workflow_action_id=action.id,
                message_type="cancellation_reason",
                action_message=body.cancellation_reason.strip(),
            )
        if body.type == WorkflowActionType.REASSIGNMENT_REQUEST and body.reassignment_reason:
            await upsert_workflow_action_message(
                db,
                workflow_action_id=action.id,
                message_type="reassignment_reason",
                action_message=body.reassignment_reason.strip(),
            )

        # ── Email notifications (queued in this same transaction) ───────────
        if body.type == WorkflowActionType.HEARING_ASSIGNED and not is_reassignment:
            # "Confirm Assign" from a suggestion or first-time assigned action:
            # tell the assignee.
            await queue_assignment_notification(
                db,
                hearing_assignment_id=ha.id,
                workflow_action_id=action.id,
                event_type=EmailEventType.ASSIGNMENT_CREATED,
                recipient_user_id=ha.assignee_id,
                hearing_id=ha.hearing_id,
                bill_id=ha.bill_id,
            )
        elif is_reassignment:
            # Cancel the old assignee's notification (suppress if same user).
            same_user = old_assignee_id == new_assignee_id
            await queue_assignment_notification(
                db,
                hearing_assignment_id=ha.id,
                workflow_action_id=action.id,
                event_type=EmailEventType.ASSIGNMENT_CANCELED,
                recipient_user_id=old_assignee_id,
                hearing_id=ha.hearing_id,
                bill_id=ha.bill_id,
                cancellation_reason="Hearing has been reassigned",
                suppressed_reason_override="identical_reassignment" if same_user else None,
            )
            # Tell the new assignee they now own this hearing.
            await queue_assignment_notification(
                db,
                hearing_assignment_id=ha.id,
                workflow_action_id=action.id,
                event_type=EmailEventType.ASSIGNMENT_CREATED,
                recipient_user_id=new_assignee_id,
                hearing_id=ha.hearing_id,
                bill_id=ha.bill_id,
            )
        elif body.type == WorkflowActionType.HEARING_ASSIGNMENT_CANCELED:
            await queue_assignment_notification(
                db,
                hearing_assignment_id=ha.id,
                workflow_action_id=action.id,
                event_type=EmailEventType.ASSIGNMENT_CANCELED,
                recipient_user_id=ha.assignee_id,
                hearing_id=ha.hearing_id,
                bill_id=ha.bill_id,
                cancellation_reason=(body.cancellation_reason or "").strip() or None,
            )

        if body.type in _HEARING_ASSIGNMENT_TERMINAL_ACTIONS:
            await close_workflows(db, [workflow.id])

        # target_user_id: the user materially affected by the action.
        # - reassignment: the new owner
        # - discarded: no one (the assignment never landed on the assignee in a
        #   meaningful way; admins discard auto-suggested rows)
        # - reassignment_request: no clear single target (admins are notified)
        # - everything else: the (current) assignee
        if recorded_type == WorkflowActionType.HEARING_REASSIGNED:
            target_user_id = new_assignee_id
        elif recorded_type in (
            WorkflowActionType.HEARING_ASSIGNMENT_DISCARDED,
            WorkflowActionType.REASSIGNMENT_REQUEST,
        ):
            target_user_id = None
        else:
            target_user_id = old_assignee_id

        audit_details: dict = {
            "hearing_assignment_id": ha.id,
            "hearing_id": ha.hearing_id,
            "bill_id": ha.bill_id,
        }
        if recorded_type == WorkflowActionType.HEARING_REASSIGNED:
            audit_details["from_assignee_id"] = old_assignee_id
            audit_details["to_assignee_id"] = new_assignee_id
        if body.type == WorkflowActionType.HEARING_ASSIGNMENT_CANCELED and body.cancellation_reason:
            audit_details["cancellation_reason"] = body.cancellation_reason.strip()
        if body.type == WorkflowActionType.REASSIGNMENT_REQUEST and body.reassignment_reason:
            audit_details["reassignment_reason"] = body.reassignment_reason.strip()

        await log_action(
            db,
            current_user.user,
            _HA_AUDIT_ACTION_NAMES[recorded_type],
            entity_type="workflow",
            entity_id=workflow_id,
            target_user_id=target_user_id,
            details=audit_details,
            request=request,
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

    requester_user_id = workflow.created_by

    if body.type == WorkflowActionType.APPROVE_BILL_TRACKING:
        await set_bill_tracked(db, bill_id, True)
        await log_action(
            db,
            current_user.user,
            "bill_tracked",
            entity_type="bill",
            entity_id=bill_id,
            target_user_id=requester_user_id,
            details={"source": "workflow_approval", "workflow_id": workflow_id},
            request=request,
        )

    affected_workflows = await close_open_workflows_for_bill(
        db,
        bill_id=bill_id,
        action_type=body.type,
        acting_user_id=current_user.user.id,
    )

    decision_action = (
        "bill_tracking_approved"
        if body.type == WorkflowActionType.APPROVE_BILL_TRACKING
        else "bill_tracking_denied"
    )
    await log_action(
        db,
        current_user.user,
        decision_action,
        entity_type="workflow",
        entity_id=workflow_id,
        target_user_id=requester_user_id,
        details={
            "bill_id": bill_id,
            "affected_workflow_ids": [wf.id for wf in affected_workflows],
        },
        request=request,
    )
    await db.commit()

    refreshed = await get_workflow_by_id(db, workflow_id)
    return WorkflowRead.from_orm(refreshed)
