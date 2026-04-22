from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.workflow import WorkflowActionType, WorkflowStatus, WorkflowType


class WorkflowActionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: WorkflowActionType
    user_id: int
    username: str
    action_timestamp: datetime

    @classmethod
    def from_orm_action(cls, action: object) -> "WorkflowActionRead":
        return cls(
            id=action.id,  # type: ignore[attr-defined]
            type=action.type,  # type: ignore[attr-defined]
            user_id=action.user_id,  # type: ignore[attr-defined]
            username=action.actor.email,  # type: ignore[attr-defined]
            action_timestamp=action.action_timestamp,  # type: ignore[attr-defined]
        )


class BillSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    bill_number: str
    short_title: str | None
    is_tracked: bool


class WorkflowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: WorkflowType
    status: WorkflowStatus
    created_by: int
    created_by_username: str
    created_at: datetime
    updated_at: datetime
    actions: list[WorkflowActionRead]
    bill: BillSummary | None

    @classmethod
    def from_orm(cls, workflow: object) -> "WorkflowRead":
        btr = workflow.bill_tracking_request  # type: ignore[attr-defined]
        bill = (
            BillSummary(
                id=btr.bill.id,
                bill_number=btr.bill.bill_number,
                short_title=btr.bill.short_title,
                is_tracked=btr.bill.is_tracked,
            )
            if btr and btr.bill
            else None
        )
        return cls(
            id=workflow.id,  # type: ignore[attr-defined]
            type=workflow.type,  # type: ignore[attr-defined]
            status=workflow.status,  # type: ignore[attr-defined]
            created_by=workflow.created_by,  # type: ignore[attr-defined]
            created_by_username=workflow.creator.email,  # type: ignore[attr-defined]
            created_at=workflow.created_at,  # type: ignore[attr-defined]
            updated_at=workflow.updated_at,  # type: ignore[attr-defined]
            actions=[WorkflowActionRead.from_orm_action(a) for a in workflow.actions],  # type: ignore[attr-defined]
            bill=bill,
        )


class HasOpenResponse(BaseModel):
    has_open: bool


class CreateWorkflowRequest(BaseModel):
    bill_id: int


class AddActionRequest(BaseModel):
    type: WorkflowActionType
    new_assignee_email: str | None = None


class BillTrackingStateRequest(BaseModel):
    bill_ids: list[int]


class BillTrackingStateItem(BaseModel):
    bill_id: int
    tracking_requested: bool
    user_tracking_request_denied: bool


class CreateHearingAssignmentRequest(BaseModel):
    hearing_id: int
    assignee_email: str
    bill_number: str | None = None


class HearingAssignmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workflow_id: int
    assignee_id: int
    hearing_id: int
    bill_id: int | None
