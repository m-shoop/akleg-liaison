import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PublicationLevel(str, enum.Enum):
    user = "user"
    system = "system"


class SavedReport(Base):
    __tablename__ = "saved_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    registry_name: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    publication_level: Mapped[PublicationLevel] = mapped_column(
        Enum(
            PublicationLevel,
            name="publication_level_enum",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    allowed_roles: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    report_criteria: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User | None"] = relationship("User", foreign_keys=[user_id])  # type: ignore[name-defined]


class DefaultUserReport(Base):
    __tablename__ = "default_user_reports"
    __table_args__ = (
        UniqueConstraint("user_id", "registry_name", name="uq_default_user_reports_user_registry"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    registry_name: Mapped[str] = mapped_column(Text, nullable=False)
    report_id: Mapped[int] = mapped_column(
        ForeignKey("saved_reports.id", ondelete="CASCADE"), nullable=False
    )

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])  # type: ignore[name-defined]
    report: Mapped[SavedReport] = relationship("SavedReport", foreign_keys=[report_id])


class UserReportOrder(Base):
    """Per-user fractional sort key for a saved report.  Missing rows mean
    "unranked" — those reports fall to the end of their section in display_name
    order until the user reorders them."""

    __tablename__ = "user_report_orders"
    __table_args__ = (
        UniqueConstraint("user_id", "report_id", name="uq_user_report_orders_user_report"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    report_id: Mapped[int] = mapped_column(
        ForeignKey("saved_reports.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_key: Mapped[float] = mapped_column(Float, nullable=False)

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])  # type: ignore[name-defined]
    report: Mapped[SavedReport] = relationship("SavedReport", foreign_keys=[report_id])
