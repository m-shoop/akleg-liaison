from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class FiscalNote(Base):
    __tablename__ = "fiscal_notes"
    __table_args__ = (
        # Partial unique index: enforces one row per (bill_id, fn_identifier) only
        # where fn_identifier is known. Rows still awaiting PDF parse are excluded.
        Index(
            "uq_fiscal_note_bill_identifier",
            "bill_id",
            "fn_identifier",
            unique=True,
            postgresql_where=text("fn_identifier IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bill_id: Mapped[int] = mapped_column(
        ForeignKey("bills.id", ondelete="CASCADE"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    # sid from the fiscalNote.php URL — stable server-side identifier
    session_id: Mapped[str] = mapped_column(String(100), nullable=False)
    fn_department: Mapped[str | None] = mapped_column(String(500))
    fn_appropriation: Mapped[str | None] = mapped_column(String(500))
    fn_allocation: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    control_code: Mapped[str | None] = mapped_column(String(50))
    fn_identifier: Mapped[str | None] = mapped_column(String(100))
    publish_date: Mapped[date | None] = mapped_column(Date)
    last_synced: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    creation_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    bill: Mapped["Bill"] = relationship(back_populates="fiscal_notes")  # type: ignore[name-defined]
