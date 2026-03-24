"""rename_bill_subjects_to_keywords

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-24 00:00:00.000000
"""

from alembic import op

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_bill_subjects_bill_id", table_name="bill_subjects")
    op.drop_constraint("uq_bill_subject", "bill_subjects", type_="unique")

    op.alter_column("bill_subjects", "subject", new_column_name="keyword")
    op.rename_table("bill_subjects", "bill_keywords")

    op.create_unique_constraint("uq_bill_keyword", "bill_keywords", ["bill_id", "keyword"])
    op.create_index("ix_bill_keywords_bill_id", "bill_keywords", ["bill_id"])


def downgrade() -> None:
    op.drop_index("ix_bill_keywords_bill_id", table_name="bill_keywords")
    op.drop_constraint("uq_bill_keyword", "bill_keywords", type_="unique")

    op.alter_column("bill_keywords", "keyword", new_column_name="subject")
    op.rename_table("bill_keywords", "bill_subjects")

    op.create_unique_constraint("uq_bill_subject", "bill_subjects", ["bill_id", "subject"])
    op.create_index("ix_bill_subjects_bill_id", "bill_subjects", ["bill_id"])
