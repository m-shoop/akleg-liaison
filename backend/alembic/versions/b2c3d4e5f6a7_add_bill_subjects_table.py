"""add_bill_subjects_table

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-24 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bill_subjects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bill_id", sa.Integer(), sa.ForeignKey("bills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("url", sa.String(500), nullable=True),
        sa.UniqueConstraint("bill_id", "subject", name="uq_bill_subject"),
    )
    op.create_index("ix_bill_subjects_bill_id", "bill_subjects", ["bill_id"])


def downgrade() -> None:
    op.drop_index("ix_bill_subjects_bill_id", table_name="bill_subjects")
    op.drop_table("bill_subjects")
