from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Meeting(Base):
    __tablename__ = "meetings"
    # Uniqueness is enforced by a partial index (WHERE is_active = TRUE) defined
    # in the Alembic migration — see uq_meeting_active.
    __table_args__ = ()

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chamber: Mapped[str] = mapped_column(String(1), nullable=False)  # "H" or "S"
    committee_name: Mapped[str] = mapped_column(String(200), nullable=False)
    committee_type: Mapped[str] = mapped_column(String(100), nullable=False)
    committee_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    committee_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    meeting_date: Mapped[date] = mapped_column(Date, nullable=False)
    meeting_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    legislature_session: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    dps_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    agenda_items: Mapped[list["AgendaItem"]] = relationship(
        back_populates="meeting",
        cascade="all, delete-orphan",
        order_by="AgendaItem.sort_order",
    )


class AgendaItem(Base):
    """
    A single item on a meeting agenda.

    Bill items have bill_number set; note/annotation items do not.
    Notes that are contextually tied to a specific bill on the agenda
    have bill_number set even though they are not themselves bill rows
    (is_bill=False).
    """
    __tablename__ = "agenda_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    meeting_id: Mapped[int] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Set when this item is (or is contextually tied to) a bill
    bill_id: Mapped[int | None] = mapped_column(
        ForeignKey("bills.id", ondelete="SET NULL"), nullable=True, index=True
    )
    bill_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Display text: bill title for bill rows, note text for annotation rows
    content: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    prefix: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_bill: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    is_teleconferenced: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    meeting: Mapped["Meeting"] = relationship(back_populates="agenda_items")
