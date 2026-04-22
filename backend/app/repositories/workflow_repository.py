"""Data access layer for workflows, workflow actions, and bill tracking requests."""

from datetime import date, datetime, timezone

from sqlalchemy import and_, exists, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.bill import Bill
from app.models.hearing import AgendaItem, Hearing, HearingAgendaVersion
from app.models.workflow import (
    BillTrackingRequest,
    HearingAssignment,
    Workflow,
    WorkflowAction,
    WorkflowActionType,
    WorkflowStatus,
    WorkflowType,
)


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


async def get_workflow_by_id(db: AsyncSession, workflow_id: int) -> Workflow | None:
    result = await db.execute(
        select(Workflow)
        .where(Workflow.id == workflow_id)
        .options(
            selectinload(Workflow.actions).selectinload(WorkflowAction.actor),
            selectinload(Workflow.creator),
            selectinload(Workflow.bill_tracking_request).selectinload(
                BillTrackingRequest.bill
            ),
            selectinload(Workflow.hearing_assignment),
        )
    )
    return result.scalar_one_or_none()


async def list_workflows(
    db: AsyncSession,
    *,
    include_closed: bool = False,
    created_by_user_id: int | None = None,
) -> list[Workflow]:
    """
    Fetch workflows of type request_bill_tracking.

    - If created_by_user_id is provided, only return workflows created by that user.
    - By default only open workflows are returned; pass include_closed=True for both.
    """
    q = (
        select(Workflow)
        .where(Workflow.type == WorkflowType.REQUEST_BILL_TRACKING)
        .options(
            selectinload(Workflow.actions).selectinload(WorkflowAction.actor),
            selectinload(Workflow.creator),
            selectinload(Workflow.bill_tracking_request).selectinload(
                BillTrackingRequest.bill
            ),
        )
        .order_by(Workflow.created_at.desc())
    )

    if not include_closed:
        q = q.where(Workflow.status == WorkflowStatus.OPEN)

    if created_by_user_id is not None:
        q = q.where(Workflow.created_by == created_by_user_id)

    result = await db.execute(q)
    return list(result.scalars().all())


async def has_open_workflows(
    db: AsyncSession,
    *,
    created_by_user_id: int | None = None,
) -> bool:
    """
    Return True if there are open request_bill_tracking workflows.
    If created_by_user_id is provided, scope to that user's workflows.
    """
    q = select(
        exists().where(
            and_(
                Workflow.type == WorkflowType.REQUEST_BILL_TRACKING,
                Workflow.status == WorkflowStatus.OPEN,
            )
        )
    )
    if created_by_user_id is not None:
        q = select(
            exists().where(
                and_(
                    Workflow.type == WorkflowType.REQUEST_BILL_TRACKING,
                    Workflow.status == WorkflowStatus.OPEN,
                    Workflow.created_by == created_by_user_id,
                )
            )
        )
    result = await db.execute(q)
    return bool(result.scalar())


async def get_open_workflow_for_bill_by_user(
    db: AsyncSession, bill_id: int, user_id: int
) -> Workflow | None:
    """Return the user's open request_bill_tracking workflow for a specific bill, if any."""
    result = await db.execute(
        select(Workflow)
        .join(BillTrackingRequest, BillTrackingRequest.workflow_id == Workflow.id)
        .where(
            BillTrackingRequest.bill_id == bill_id,
            Workflow.created_by == user_id,
            Workflow.status == WorkflowStatus.OPEN,
            Workflow.type == WorkflowType.REQUEST_BILL_TRACKING,
        )
    )
    return result.scalar_one_or_none()


async def user_has_any_workflow_for_bill(
    db: AsyncSession, bill_id: int, user_id: int
) -> bool:
    """Return True if the user has ever created a request_bill_tracking workflow for this bill."""
    result = await db.execute(
        select(
            exists().where(
                and_(
                    Workflow.created_by == user_id,
                    Workflow.type == WorkflowType.REQUEST_BILL_TRACKING,
                    BillTrackingRequest.workflow_id == Workflow.id,
                    BillTrackingRequest.bill_id == bill_id,
                )
            )
        )
    )
    return bool(result.scalar())


async def has_open_hearing_assignments(
    db: AsyncSession,
    *,
    assignee_user_id: int | None = None,
) -> bool:
    """
    Return True if there are open hearing_assignment workflows.
    If assignee_user_id is provided, scope to assignments for that user.
    """
    if assignee_user_id is not None:
        q = select(
            exists().where(
                and_(
                    Workflow.type == WorkflowType.HEARING_ASSIGNMENT,
                    Workflow.status == WorkflowStatus.OPEN,
                    HearingAssignment.workflow_id == Workflow.id,
                    HearingAssignment.assignee_id == assignee_user_id,
                )
            )
        )
    else:
        q = select(
            exists().where(
                and_(
                    Workflow.type == WorkflowType.HEARING_ASSIGNMENT,
                    Workflow.status == WorkflowStatus.OPEN,
                )
            )
        )
    result = await db.execute(q)
    return bool(result.scalar())


async def get_open_workflows_for_bill(
    db: AsyncSession, bill_id: int
) -> list[Workflow]:
    """Return all open request_bill_tracking workflows for a specific bill."""
    result = await db.execute(
        select(Workflow)
        .join(BillTrackingRequest, BillTrackingRequest.workflow_id == Workflow.id)
        .where(
            BillTrackingRequest.bill_id == bill_id,
            Workflow.status == WorkflowStatus.OPEN,
            Workflow.type == WorkflowType.REQUEST_BILL_TRACKING,
        )
        .options(
            selectinload(Workflow.actions),
            selectinload(Workflow.bill_tracking_request),
        )
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Bill tracking state helpers for GET /bills enrichment
# ---------------------------------------------------------------------------


async def get_bill_tracking_state(
    db: AsyncSession,
    bill_ids: list[int],
    user_id: int | None,
) -> dict[int, dict]:
    """
    For a list of bill IDs, return a dict mapping bill_id →
    {tracking_requested: bool, user_tracking_request_denied: bool}.

    tracking_requested: at least one open request_bill_tracking workflow exists for this bill.
    user_tracking_request_denied: user has previously requested AND has no open request now.
    """
    state: dict[int, dict] = {
        bid: {"tracking_requested": False, "user_tracking_request_denied": False}
        for bid in bill_ids
    }

    if not bill_ids:
        return state

    # Query open workflows per bill
    result = await db.execute(
        select(BillTrackingRequest.bill_id)
        .join(Workflow, Workflow.id == BillTrackingRequest.workflow_id)
        .where(
            BillTrackingRequest.bill_id.in_(bill_ids),
            Workflow.status == WorkflowStatus.OPEN,
            Workflow.type == WorkflowType.REQUEST_BILL_TRACKING,
        )
        .distinct()
    )
    bills_with_open_requests = set(result.scalars().all())
    for bid in bills_with_open_requests:
        state[bid]["tracking_requested"] = True

    if user_id is not None:
        # Bills where this user has any workflow (open or closed)
        result = await db.execute(
            select(BillTrackingRequest.bill_id)
            .join(Workflow, Workflow.id == BillTrackingRequest.workflow_id)
            .where(
                BillTrackingRequest.bill_id.in_(bill_ids),
                Workflow.created_by == user_id,
                Workflow.type == WorkflowType.REQUEST_BILL_TRACKING,
            )
            .distinct()
        )
        bills_user_has_requested = set(result.scalars().all())

        # Bills where this user has an open workflow
        result = await db.execute(
            select(BillTrackingRequest.bill_id)
            .join(Workflow, Workflow.id == BillTrackingRequest.workflow_id)
            .where(
                BillTrackingRequest.bill_id.in_(bill_ids),
                Workflow.created_by == user_id,
                Workflow.status == WorkflowStatus.OPEN,
                Workflow.type == WorkflowType.REQUEST_BILL_TRACKING,
            )
            .distinct()
        )
        bills_user_has_open = set(result.scalars().all())

        # denied = previously requested AND no open request now
        bills_user_denied = bills_user_has_requested - bills_user_has_open
        for bid in bills_user_denied:
            state[bid]["user_tracking_request_denied"] = True

    return state


# ---------------------------------------------------------------------------
# Auto-suggestion helpers
# ---------------------------------------------------------------------------


async def get_hearing_bill_combos_needing_suggestion(
    db: AsyncSession,
    reference_date: date,
) -> list[tuple[int, int]]:
    """
    Return (hearing_id, bill_id) pairs for hearings on or after reference_date where:
    - the bill is tracked
    - the bill appears on the current agenda version
    - no hearing_assignment already exists for this exact (hearing_id, bill_id) pair

    reference_date must be supplied by the caller using the Juneau-local date so that
    the boundary is consistent with the scheduler timezone.
    """
    existing_assignment = (
        select(HearingAssignment.id)
        .where(
            HearingAssignment.hearing_id == Hearing.id,
            HearingAssignment.bill_id == AgendaItem.bill_id,
        )
        .correlate(Hearing, AgendaItem)
    )

    result = await db.execute(
        select(Hearing.id, AgendaItem.bill_id)
        .join(
            HearingAgendaVersion,
            and_(
                HearingAgendaVersion.hearing_id == Hearing.id,
                HearingAgendaVersion.is_current.is_(True),
            ),
        )
        .join(AgendaItem, AgendaItem.agenda_version_id == HearingAgendaVersion.id)
        .join(Bill, Bill.id == AgendaItem.bill_id)
        .where(
            Hearing.hearing_date >= reference_date,
            AgendaItem.bill_id.isnot(None),
            AgendaItem.is_bill.is_(True),
            Bill.is_tracked.is_(True),
            ~exists(existing_assignment),
        )
        .distinct()
    )
    return list(result.all())


async def get_most_recent_assignee_for_bill(
    db: AsyncSession, bill_id: int
) -> int | None:
    """Return the assignee_id from the most recently created hearing_assignment for this bill."""
    result = await db.execute(
        select(HearingAssignment.assignee_id)
        .join(Workflow, Workflow.id == HearingAssignment.workflow_id)
        .where(HearingAssignment.bill_id == bill_id)
        .order_by(Workflow.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------


async def create_bill_tracking_workflow(
    db: AsyncSession,
    bill_id: int,
    created_by_user_id: int,
) -> Workflow:
    """Create a new request_bill_tracking workflow and its initial action."""
    workflow = Workflow(
        type=WorkflowType.REQUEST_BILL_TRACKING,
        status=WorkflowStatus.OPEN,
        created_by=created_by_user_id,
    )
    db.add(workflow)
    await db.flush()  # get workflow.id

    btr = BillTrackingRequest(bill_id=bill_id, workflow_id=workflow.id)
    db.add(btr)

    action = WorkflowAction(
        workflow_id=workflow.id,
        type=WorkflowActionType.REQUEST_BILL_TRACKING,
        user_id=created_by_user_id,
    )
    db.add(action)
    await db.flush()

    return workflow


async def create_hearing_assignment_workflow(
    db: AsyncSession,
    *,
    hearing_id: int,
    assignee_id: int,
    bill_id: int | None,
    created_by_user_id: int,
    initial_action_type: WorkflowActionType = WorkflowActionType.HEARING_ASSIGNED,
    action_actor_user_id: int | None = None,
) -> Workflow:
    """
    Create a new hearing_assignment workflow with its HearingAssignment record and initial action.

    For auto-suggestions pass initial_action_type=AUTO_SUGGESTED_HEARING_ASSIGNMENT and
    action_actor_user_id=assignee_id so the action is recorded as the assignee's action.
    """
    workflow = Workflow(
        type=WorkflowType.HEARING_ASSIGNMENT,
        status=WorkflowStatus.OPEN,
        created_by=created_by_user_id,
    )
    db.add(workflow)
    await db.flush()

    ha = HearingAssignment(
        assignee_id=assignee_id,
        hearing_id=hearing_id,
        bill_id=bill_id,
        workflow_id=workflow.id,
    )
    db.add(ha)

    action = WorkflowAction(
        workflow_id=workflow.id,
        type=initial_action_type,
        user_id=action_actor_user_id if action_actor_user_id is not None else created_by_user_id,
    )
    db.add(action)
    await db.flush()

    return workflow


async def add_workflow_action(
    db: AsyncSession,
    workflow: Workflow,
    action_type: WorkflowActionType,
    acting_user_id: int,
) -> WorkflowAction:
    action = WorkflowAction(
        workflow_id=workflow.id,
        type=action_type,
        user_id=acting_user_id,
    )
    db.add(action)
    await db.flush()
    return action


async def update_hearing_assignment_assignee(
    db: AsyncSession, hearing_assignment_id: int, new_assignee_id: int
) -> None:
    await db.execute(
        update(HearingAssignment)
        .where(HearingAssignment.id == hearing_assignment_id)
        .values(assignee_id=new_assignee_id)
    )


async def close_workflows(db: AsyncSession, workflow_ids: list[int]) -> None:
    """Set workflows to CLOSED status and update their updated_at timestamp."""
    if not workflow_ids:
        return
    await db.execute(
        update(Workflow)
        .where(Workflow.id.in_(workflow_ids))
        .values(status=WorkflowStatus.CLOSED, updated_at=datetime.now(timezone.utc))
    )


async def close_open_workflows_for_bill(
    db: AsyncSession,
    bill_id: int,
    action_type: WorkflowActionType,
    acting_user_id: int,
) -> list[Workflow]:
    """
    Find all open request_bill_tracking workflows for a bill,
    add the given action to each, then close them all.
    Returns the list of affected workflows.
    """
    open_workflows = await get_open_workflows_for_bill(db, bill_id)
    for wf in open_workflows:
        action = WorkflowAction(
            workflow_id=wf.id,
            type=action_type,
            user_id=acting_user_id,
        )
        db.add(action)

    if open_workflows:
        await close_workflows(db, [wf.id for wf in open_workflows])

    return open_workflows
