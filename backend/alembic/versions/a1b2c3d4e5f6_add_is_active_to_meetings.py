"""add_is_active_to_meetings

Revision ID: a1b2c3d4e5f6
Revises: 869cd2b04f48
Create Date: 2026-03-23 00:00:00.000000

Replaces the full unique constraint on meetings with a partial unique index
scoped to active meetings only (WHERE is_active = TRUE). This allows multiple
historical records for the same meeting slot when a meeting is rescheduled.
"""

from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "869cd2b04f48"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add is_active column; all existing rows default to active
    op.add_column(
        "meetings",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )

    # Drop the old full unique constraint
    op.drop_constraint("uq_meeting", "meetings", type_="unique")

    # Create a partial unique index covering only active meetings
    op.execute(
        """
        CREATE UNIQUE INDEX uq_meeting_active
        ON meetings (chamber, committee_name, committee_type, meeting_date, meeting_time, legislature_session)
        WHERE is_active = TRUE
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_meeting_active")

    op.create_unique_constraint(
        "uq_meeting",
        "meetings",
        ["chamber", "committee_name", "committee_type", "meeting_date", "meeting_time", "legislature_session"],
    )

    op.drop_column("meetings", "is_active")
