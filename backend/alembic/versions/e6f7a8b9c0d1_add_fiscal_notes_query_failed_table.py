"""add fiscal_notes_query_failed table

Revision ID: e6f7a8b9c0d1
Revises: d2e3f4a5b6c7
Create Date: 2026-04-07 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e6f7a8b9c0d1"
down_revision: Union[str, None] = "d2e3f4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "fiscal_notes_query_failed",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("bill_id", sa.Integer(), nullable=False),
        sa.Column(
            "failed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["bill_id"], ["bills.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("bill_id", name="uq_fiscal_notes_query_failed_bill"),
    )
    op.create_index(
        "ix_fiscal_notes_query_failed_bill_id",
        "fiscal_notes_query_failed",
        ["bill_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_fiscal_notes_query_failed_bill_id", table_name="fiscal_notes_query_failed")
    op.drop_table("fiscal_notes_query_failed")
