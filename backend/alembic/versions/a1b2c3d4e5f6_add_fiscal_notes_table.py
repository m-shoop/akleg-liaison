"""add fiscal_notes table

Revision ID: fa11ca1n0te01
Revises: c4d5e6f7a8b9
Create Date: 2026-04-05 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "fa11ca1n0te01"
down_revision: Union[str, None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "fiscal_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "bill_id",
            sa.Integer(),
            sa.ForeignKey("bills.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("session_id", sa.String(100), nullable=False),
        sa.Column("fn_department", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("control_code", sa.String(50), nullable=True),
        sa.Column("fn_identifier", sa.String(100), nullable=True),
        sa.Column("last_synced", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "creation_timestamp",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("bill_id", "session_id", name="uq_fiscal_note_bill_session"),
    )
    op.create_index("ix_fiscal_notes_bill_id", "fiscal_notes", ["bill_id"])


def downgrade() -> None:
    op.drop_index("ix_fiscal_notes_bill_id", table_name="fiscal_notes")
    op.drop_table("fiscal_notes")
