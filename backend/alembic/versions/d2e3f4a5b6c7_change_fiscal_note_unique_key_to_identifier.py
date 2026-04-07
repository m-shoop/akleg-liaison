"""change fiscal_note unique key from session_id to fn_identifier

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-04-07 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d2e3f4a5b6c7"
down_revision: Union[str, None] = "c1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Remove duplicate rows, keeping the highest id per (bill_id, fn_identifier).
    # This runs before creating the unique index so it doesn't fail on existing dupes.
    op.execute("""
        DELETE FROM fiscal_notes
        WHERE id NOT IN (
            SELECT MAX(id)
            FROM fiscal_notes
            WHERE fn_identifier IS NOT NULL
            GROUP BY bill_id, fn_identifier
        )
        AND fn_identifier IS NOT NULL
    """)

    op.drop_constraint("uq_fiscal_note_bill_session", "fiscal_notes", type_="unique")

    # Partial unique index: only enforce uniqueness where fn_identifier is known.
    # Rows with fn_identifier IS NULL are excluded (PDF parse failed; not yet identified).
    op.create_index(
        "uq_fiscal_note_bill_identifier",
        "fiscal_notes",
        ["bill_id", "fn_identifier"],
        unique=True,
        postgresql_where=sa.text("fn_identifier IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_fiscal_note_bill_identifier", table_name="fiscal_notes")
    op.create_unique_constraint(
        "uq_fiscal_note_bill_session", "fiscal_notes", ["bill_id", "session_id"]
    )
