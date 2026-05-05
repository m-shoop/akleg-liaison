import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EmailEventType(str, enum.Enum):
    """Event types stored in email_notifications.event_type. Stored as TEXT,
    not a Postgres enum, per the design (start simple)."""
    ASSIGNMENT_CREATED = "assignment_created"
    ASSIGNMENT_CANCELED = "assignment_canceled"
    ASSIGNMENT_TYPE_CHANGED = "assignment_type_changed"


class EmailTemplate(Base):
    __tablename__ = "email_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    subject_template: Mapped[str] = mapped_column(Text, nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    default_cc_email: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )


class EmailNotification(Base):
    __tablename__ = "email_notifications"
    __table_args__ = (
        CheckConstraint(
            "(sent_at IS NULL OR suppressed_reason IS NULL) "
            "AND (sent_at IS NULL OR error IS NULL) "
            "AND (suppressed_reason IS NULL OR error IS NULL)",
            name="chk_status_exclusivity",
        ),
        Index(
            "idx_email_notifications_assignment_event",
            "hearing_assignment_id",
            "event_type",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hearing_assignment_id: Mapped[int] = mapped_column(
        ForeignKey("hearing_assignments.id", ondelete="CASCADE"), nullable=False
    )
    workflow_action_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_actions.id", ondelete="CASCADE"), nullable=False
    )
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("email_templates.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    recipient_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    recipient_email: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    suppressed_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    @property
    def state(self) -> str:
        """Derived state per the design: pending | sent | failed | suppressed."""
        if self.sent_at is not None:
            return "sent"
        if self.suppressed_reason is not None:
            return "suppressed"
        if self.error is not None:
            return "failed"
        return "pending"


class UserCommPrefs(Base):
    __tablename__ = "user_comm_prefs"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    email_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )


class UserCommPrefsHistory(Base):
    __tablename__ = "user_comm_prefs_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    field: Mapped[str] = mapped_column(Text, nullable=False)
    old_value: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    new_value: Mapped[bool] = mapped_column(Boolean, nullable=False)
    changed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    source: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class WorkflowActionMessage(Base):
    __tablename__ = "workflow_action_messages"
    __table_args__ = (
        UniqueConstraint(
            "workflow_action_id",
            "message_type",
            name="uq_workflow_action_message_type",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workflow_action_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_actions.id", ondelete="CASCADE"), nullable=False
    )
    message_type: Mapped[str] = mapped_column(Text, nullable=False)
    action_message: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
