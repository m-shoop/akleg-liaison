from datetime import date, datetime, time
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    pass


class Hearing(Base):
    __tablename__ = "hearings"
    __table_args__ = ()

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chamber: Mapped[str] = mapped_column(String(1), nullable=False)  # "H" or "S"
    hearing_type: Mapped[str] = mapped_column(
        Enum("Floor", "Committee", name="hearingtype"), nullable=False
    )
    length: Mapped[int] = mapped_column(Integer, nullable=False)  # minutes
    hearing_date: Mapped[date] = mapped_column(Date, nullable=False)
    hearing_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Retained in hearings for partial unique index on committee hearings.
    committee_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    legislature_session: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    hidden: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    dps_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_sync: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    committee_hearing: Mapped["CommitteeHearing | None"] = relationship(
        back_populates="hearing",
        cascade="all, delete-orphan",
        uselist=False,
    )
    agenda_versions: Mapped[list["HearingAgendaVersion"]] = relationship(
        back_populates="hearing",
        cascade="all, delete-orphan",
        order_by="HearingAgendaVersion.version",
    )

    # ── Convenience properties so the flat API schema still works ───────────

    @property
    def committee_name(self) -> str | None:
        return self.committee_hearing.committee_name if self.committee_hearing else None

    @property
    def committee_type(self) -> str | None:
        return self.committee_hearing.committee_type if self.committee_hearing else None

    @property
    def committee_url(self) -> str | None:
        return self.committee_hearing.committee_url if self.committee_hearing else None

    @property
    def has_prior_agendas(self) -> bool:
        return any(not v.is_current for v in self.agenda_versions)

    @property
    def current_agenda_created_at(self) -> "datetime | None":
        for v in self.agenda_versions:
            if v.is_current:
                return v.created_at
        if self.agenda_versions:
            return max(self.agenda_versions, key=lambda v: v.version).created_at
        return None

    @property
    def agenda_items(self) -> list["AgendaItem"]:
        for v in self.agenda_versions:
            if v.is_current:
                return v.agenda_items
        if self.agenda_versions:
            return max(self.agenda_versions, key=lambda v: v.version).agenda_items
        return []


class CommitteeHearing(Base):
    """Committee-specific data for a hearing of type 'Committee'.

    Each CommitteeHearing row corresponds 1:1 with a Hearing row.
    Floor hearings have no CommitteeHearing row.
    """
    __tablename__ = "committee_hearings"
    __table_args__ = ()

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hearing_id: Mapped[int] = mapped_column(
        ForeignKey("hearings.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    committee_name: Mapped[str] = mapped_column(String(200), nullable=False)
    committee_type: Mapped[str] = mapped_column(String(100), nullable=False)
    committee_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    hearing: Mapped["Hearing"] = relationship(back_populates="committee_hearing")


class HearingAgendaVersion(Base):
    """Tracks each distinct version of a hearing's agenda.

    A new row is created whenever the scraped agenda differs from the previous
    scrape (detected via SHA-256 hash). Historical versions are never deleted.

    The partial unique index uq_hearing_agenda_current (WHERE is_current = TRUE)
    enforces that at most one version per hearing is current at any time.
    """
    __tablename__ = "hearing_agenda_versions"
    __table_args__ = ()

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hearing_id: Mapped[int] = mapped_column(
        ForeignKey("hearings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    is_current: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    agenda_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    hearing: Mapped["Hearing"] = relationship(back_populates="agenda_versions")
    agenda_items: Mapped[list["AgendaItem"]] = relationship(
        back_populates="agenda_version",
        cascade="all, delete-orphan",
        order_by="AgendaItem.sort_order",
    )


class AgendaItem(Base):
    """A single item on a hearing agenda.

    Bill items have bill_number set; note/annotation items do not.
    Notes contextually tied to a specific bill have bill_number set even
    though is_bill=False.

    Each AgendaItem belongs to a HearingAgendaVersion, not directly to a Hearing.
    """
    __tablename__ = "agenda_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agenda_version_id: Mapped[int] = mapped_column(
        ForeignKey("hearing_agenda_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    bill_id: Mapped[int | None] = mapped_column(
        ForeignKey("bills.id", ondelete="SET NULL"), nullable=True, index=True
    )
    bill_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
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

    agenda_version: Mapped["HearingAgendaVersion"] = relationship(
        back_populates="agenda_items"
    )
