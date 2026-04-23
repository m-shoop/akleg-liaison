"""Add hearing_time to committee hearing unique index

A committee can be scheduled twice in a single day at different times (e.g.
House Finance at 9 AM and again at 1:30 PM). The old partial index on
(chamber, committee_code, hearing_date, legislature_session) treated both as
the same hearing and only allowed one to be active at a time. Including
hearing_time makes each distinct time slot its own unique hearing.

Rows with a NULL hearing_time are excluded from the index (same as rows with
a NULL committee_code) because NULL values cannot participate in this
equality-based uniqueness guarantee.

Revision ID: d7e8f9a0b1c2
Revises: a2b3c4d5e6f7
Create Date: 2026-04-22 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d7e8f9a0b1c2"
down_revision: Union[str, None] = "a2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_committee_hearing_active")
    op.execute(
        """
        CREATE UNIQUE INDEX uq_committee_hearing_active
        ON hearings (chamber, committee_code, hearing_date, hearing_time, legislature_session)
        WHERE hearing_type = 'Committee' AND is_active = TRUE
          AND committee_code IS NOT NULL AND hearing_time IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_committee_hearing_active")

    # Multiple active rows for the same (chamber, code, date, session) may now
    # exist at different times. Keep only the highest-id row per group so the
    # narrow index can be re-created without conflicts.
    op.execute(
        """
        UPDATE hearings
        SET is_active = FALSE
        WHERE hearing_type = 'Committee'
          AND is_active = TRUE
          AND committee_code IS NOT NULL
          AND id NOT IN (
              SELECT MAX(id)
              FROM hearings
              WHERE hearing_type = 'Committee'
                AND is_active = TRUE
                AND committee_code IS NOT NULL
              GROUP BY chamber, committee_code, hearing_date, legislature_session
          )
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX uq_committee_hearing_active
        ON hearings (chamber, committee_code, hearing_date, legislature_session)
        WHERE hearing_type = 'Committee' AND is_active = TRUE
          AND committee_code IS NOT NULL
        """
    )
