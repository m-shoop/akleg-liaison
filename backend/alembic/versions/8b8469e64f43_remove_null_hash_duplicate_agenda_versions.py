"""remove null-hash duplicate agenda versions

Revision ID: 8b8469e64f43
Revises: 5dc0ae18d47e
Create Date: 2026-04-17 00:00:00.000000

When meeting_agenda_versions was introduced, existing meetings were seeded
with a version 1 row that had no agenda_hash. The next scrape always created
a version 2 (even when content was identical) because NULL != any real hash.
This migration deletes those orphaned NULL-hash non-current rows. Their
agenda_items are removed automatically via the CASCADE foreign key.

Meetings that were never re-scraped after the migration (NULL-hash version
still is_current=True) are intentionally left untouched — they are the only
version for that meeting and are not duplicates.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '8b8469e64f43'
down_revision: Union[str, None] = '5dc0ae18d47e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            DELETE FROM meeting_agenda_versions
            WHERE agenda_hash IS NULL
              AND is_current = FALSE
            """
        )
    )


def downgrade() -> None:
    # The deleted rows (and their agenda_items) cannot be recovered.
    pass
