import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class WorkflowActionType(str, enum.Enum):
    REQUEST_BILL_TRACKING = "request_bill_tracking"
    DENY_BILL_TRACKING = "deny_bill_tracking"
    APPROVE_BILL_TRACKING = "approve_bill_tracking"


class WorkflowType(str, enum.Enum):
    REQUEST_BILL_TRACKING = "request_bill_tracking"


class WorkflowStatus(str, enum.Enum):
    OPEN = "open"
    CLOSED = "closed"


class Workflow(Base):
    __tablename__ = "workflows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[WorkflowType] = mapped_column(
        Enum(WorkflowType, name="workflow_type_enum", create_type=False, values_callable=lambda x: [e.value for e in x]), nullable=False
    )
    status: Mapped[WorkflowStatus] = mapped_column(
        Enum(WorkflowStatus, name="workflow_status_enum", create_type=False, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=WorkflowStatus.OPEN,
        server_default="open",
    )
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])  # type: ignore[name-defined]
    actions: Mapped[list["WorkflowAction"]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        order_by="WorkflowAction.action_timestamp",
    )
    bill_tracking_request: Mapped["BillTrackingRequest | None"] = relationship(
        back_populates="workflow",
        uselist=False,
        cascade="all, delete-orphan",
    )


class WorkflowAction(Base):
    __tablename__ = "workflow_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workflow_id: Mapped[int] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[WorkflowActionType] = mapped_column(
        Enum(WorkflowActionType, name="workflow_action_type_enum", create_type=False, values_callable=lambda x: [e.value for e in x]), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    action_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    workflow: Mapped["Workflow"] = relationship(back_populates="actions")
    actor: Mapped["User"] = relationship("User", foreign_keys=[user_id])  # type: ignore[name-defined]


class BillTrackingRequest(Base):
    __tablename__ = "bill_tracking_requests"
    __table_args__ = (
        UniqueConstraint("workflow_id", name="uq_bill_tracking_request_workflow"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bill_id: Mapped[int] = mapped_column(
        ForeignKey("bills.id", ondelete="CASCADE"), nullable=False
    )
    workflow_id: Mapped[int] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False
    )

    workflow: Mapped["Workflow"] = relationship(back_populates="bill_tracking_request")
    bill: Mapped["Bill"] = relationship("Bill")  # type: ignore[name-defined]
