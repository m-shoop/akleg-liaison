import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class Chamber(str, enum.Enum):
    HOUSE = "House"
    SENATE = "Senate"


class EventType(str, enum.Enum):
    FLOOR_ACTION = "floor_action"
    COMMITTEE_ACTION = "committee_action"


class OutcomeType(str, enum.Enum):
    # Committee outcomes
    HEARD_AND_HELD = "heard_and_held"
    MOVED_OUT_OF_COMMITTEE = "moved_out_of_committee"

    # Floor / introduction outcomes
    READ_ON_FLOOR = "read_on_floor"
    REFERRED_TO_COMMITTEE = "referred_to_committee"
    RULES_TO_CALENDAR = "rules_to_calendar"
    AMENDED = "amended"

    # Passage outcomes
    PASSED = "passed"
    FAILED = "failed"
    TRANSMITTED = "transmitted"

    # Final disposition
    SIGNED_INTO_LAW = "signed_into_law"
    VETOED = "vetoed"
    POCKET_VETOED = "pocket_vetoed"

    # Catch-all
    OTHER = "other"


# ---------------------------------------------------------------------------
# Bill
# ---------------------------------------------------------------------------

class Bill(Base):
    __tablename__ = "bills"
    __table_args__ = (
        UniqueConstraint("bill_number", "session", name="uq_bill_session"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # e.g. "HB 62", "SB 45"
    bill_number: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    # e.g. 34 for the 34th Alaska Legislature
    session: Mapped[int] = mapped_column(SmallInteger, nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(Text)
    short_title: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str | None] = mapped_column(String(100))
    introduced_date: Mapped[date | None] = mapped_column(Date)
    source_url: Mapped[str | None] = mapped_column(String(500))
    is_tracked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    last_sync: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    sponsors: Mapped[list["BillSponsor"]] = relationship(
        back_populates="bill", cascade="all, delete-orphan"
    )
    events: Mapped[list["BillEvent"]] = relationship(
        back_populates="bill",
        cascade="all, delete-orphan",
        order_by="BillEvent.event_date",
    )
    # Read-only view of tags via bill_tags junction table.
    # Mutations go through BillTag model directly.
    tags: Mapped[list["Tag"]] = relationship(  # type: ignore[name-defined]
        "Tag", secondary="bill_tags", viewonly=True
    )
    keywords: Mapped[list["BillKeyword"]] = relationship(
        back_populates="bill", cascade="all, delete-orphan", order_by="BillKeyword.keyword"
    )
    fiscal_notes: Mapped[list["FiscalNote"]] = relationship(  # type: ignore[name-defined]
        "FiscalNote", back_populates="bill", cascade="all, delete-orphan"
    )
    fiscal_notes_query_failed_record: Mapped["FiscalNoteQueryFailed | None"] = relationship(  # type: ignore[name-defined]
        "FiscalNoteQueryFailed", back_populates="bill", uselist=False, cascade="all, delete-orphan"
    )

    @property
    def fiscal_notes_query_failed(self) -> bool:
        return self.fiscal_notes_query_failed_record is not None


# ---------------------------------------------------------------------------
# Sponsors (unchanged)
# ---------------------------------------------------------------------------

class BillSponsor(Base):
    __tablename__ = "bill_sponsors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bill_id: Mapped[int] = mapped_column(
        ForeignKey("bills.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    chamber: Mapped[str | None] = mapped_column(String(10))
    # "primary" or "cosponsor"
    sponsor_type: Mapped[str] = mapped_column(String(20), nullable=False, default="primary")

    bill: Mapped["Bill"] = relationship(back_populates="sponsors")


# ---------------------------------------------------------------------------
# Events  (one row per unique date + source URL)
# ---------------------------------------------------------------------------

class BillEvent(Base):
    """
    A single date-based event on a bill's history.

    Uniqueness is enforced on (bill_id, event_date, source_url) so that
    repeated scrapes upsert rather than duplicate.

    raw_text contains the concatenated action text lines scraped from all
    table rows that share the same date + URL.
    """

    __tablename__ = "bill_events"
    __table_args__ = (
        UniqueConstraint("bill_id", "event_date", "source_url", name="uq_bill_event"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bill_id: Mapped[int] = mapped_column(
        ForeignKey("bills.id", ondelete="CASCADE"), nullable=False
    )
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Absolute URL to the Journal page or Committee meeting detail
    source_url: Mapped[str] = mapped_column(String(500), nullable=False)
    event_type: Mapped[EventType] = mapped_column(
        Enum(EventType, name="event_type_enum"), nullable=False
    )
    # "House" or "Senate" parsed from the (H)/(S) prefix
    chamber: Mapped[Chamber] = mapped_column(
        Enum(Chamber, name="chamber_enum"), nullable=False
    )
    # All text lines for this event joined by " | "
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    # True once the Mistral analysis job has run for this event
    analyzed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # False when the event no longer appears in the scraped bill page (e.g. a
    # scheduled hearing was cancelled before it took place).
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    bill: Mapped["Bill"] = relationship(back_populates="events")
    outcomes: Mapped[list["BillEventOutcome"]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Outcomes  (AI-identified results attached to an event)
# ---------------------------------------------------------------------------

class BillEventOutcome(Base):
    """
    A structured outcome extracted from the source document at event.source_url,
    typically identified by Mistral AI.
    """

    __tablename__ = "bill_event_outcomes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(
        ForeignKey("bill_events.id", ondelete="CASCADE"), nullable=False
    )
    # Required fields
    chamber: Mapped[Chamber] = mapped_column(
        Enum(Chamber, name="outcome_chamber_enum"), nullable=False
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    outcome_type: Mapped[OutcomeType] = mapped_column(
        Enum(OutcomeType, name="outcome_type_enum"), nullable=False
    )
    # Optional — populated for committee-level outcomes
    committee: Mapped[str | None] = mapped_column(String(200))
    # False = manually set; True = produced by Mistral
    ai_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    event: Mapped["BillEvent"] = relationship(back_populates="outcomes")


# ---------------------------------------------------------------------------
# Subjects  (official subject keywords from akleg.gov)
# ---------------------------------------------------------------------------

class BillKeyword(Base):
    __tablename__ = "bill_keywords"
    __table_args__ = (
        UniqueConstraint("bill_id", "keyword", name="uq_bill_keyword"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bill_id: Mapped[int] = mapped_column(
        ForeignKey("bills.id", ondelete="CASCADE"), nullable=False, index=True
    )
    keyword: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    bill: Mapped["Bill"] = relationship(back_populates="keywords")
