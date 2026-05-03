"""add user_report_orders for per-user saved-report ordering

Adds a single table that stores a per-user fractional sort key for each saved
report.  Ordering is per (user_id, report_id); the section a report belongs
to (system vs. user) is derived at query time from saved_reports.publication_level,
so reorder operations are scoped within a section by validation in the router.

A NULL sort_key (i.e. no row) is treated as "unranked"; the list query orders
NULLS LAST, falling back to display_name — so existing reports continue to
sort alphabetically until the user touches them.

Revision ID: 6d7e8f9a0b1c
Revises: 5c4b3a2918fe
Create Date: 2026-05-03 13:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "6d7e8f9a0b1c"
down_revision: Union[str, None] = "5c4b3a2918fe"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS user_report_orders (
            id        SERIAL  PRIMARY KEY,
            user_id   INTEGER NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
            report_id INTEGER NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
            sort_key  DOUBLE PRECISION NOT NULL,
            CONSTRAINT uq_user_report_orders_user_report UNIQUE (user_id, report_id)
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_user_report_orders_user_id"
        " ON user_report_orders (user_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_user_report_orders_report_id"
        " ON user_report_orders (report_id)"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS user_report_orders"))
