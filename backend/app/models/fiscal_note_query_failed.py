from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class FiscalNoteQueryFailed(Base):
    __tablename__ = "fiscal_notes_query_failed"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bill_id: Mapped[int] = mapped_column(
        ForeignKey("bills.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    failed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    bill: Mapped["Bill"] = relationship(back_populates="fiscal_notes_query_failed_record")  # type: ignore[name-defined]
