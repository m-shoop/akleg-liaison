"""hearings schema: split meetings into hearings + committee_hearings, add floor hearings

Implements LEG-112.

- Renames meetings → hearings (with hearing_type enum, length, committee_code retained
  for uniqueness).
- Extracts committee-specific columns into a new committee_hearings child table.
- Renames meeting_agenda_versions → hearing_agenda_versions; renames the meeting_id FK
  column to hearing_id and re-targets it to hearings.
- Creates partial unique indexes for floor hearings and committee hearings.
- Drops the old meetings table.

All existing rows are migrated as hearing_type='Committee' with length=60 minutes.

Revision ID: a2b3c4d5e6f7
Revises: 8b8469e64f43
Create Date: 2026-04-17 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a2b3c4d5e6f7"
down_revision: Union[str, None] = "8b8469e64f43"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Create hearingtype enum ──────────────────────────────────────────
    op.execute("CREATE TYPE hearingtype AS ENUM ('Floor', 'Committee')")

    # ── 2. Create hearings table ────────────────────────────────────────────
    op.create_table(
        "hearings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("chamber", sa.String(length=1), nullable=False),
        sa.Column(
            "hearing_type",
            postgresql.ENUM("Floor", "Committee", name="hearingtype", create_type=False),
            nullable=False,
        ),
        sa.Column("length", sa.Integer(), nullable=False),
        sa.Column("hearing_date", sa.Date(), nullable=False),
        sa.Column("hearing_time", sa.Time(), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("committee_code", sa.String(length=20), nullable=True),
        sa.Column("legislature_session", sa.Integer(), nullable=False),
        sa.Column("dps_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "hidden",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("last_sync", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── 3. Migrate meetings → hearings ──────────────────────────────────────
    op.execute(
        """
        INSERT INTO hearings (
            id, chamber, hearing_type, length,
            hearing_date, hearing_time, location, committee_code,
            legislature_session, dps_notes,
            created_at, is_active, updated_at, hidden, last_sync
        )
        SELECT
            id, chamber, 'Committee'::hearingtype, 60,
            meeting_date, meeting_time, location, committee_code,
            legislature_session, dps_notes,
            created_at, is_active, updated_at, hidden, last_sync
        FROM meetings
        """
    )

    # Sync the sequence so future inserts don't collide with migrated IDs.
    op.execute(
        "SELECT setval('hearings_id_seq', COALESCE((SELECT MAX(id) FROM hearings), 1))"
    )

    # ── 4. Create committee_hearings table ──────────────────────────────────
    op.create_table(
        "committee_hearings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("hearing_id", sa.Integer(), nullable=False),
        sa.Column("committee_name", sa.String(length=200), nullable=False),
        sa.Column("committee_type", sa.String(length=100), nullable=False),
        sa.Column("committee_url", sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(
            ["hearing_id"], ["hearings.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_committee_hearings_hearing_id",
        "committee_hearings",
        ["hearing_id"],
        unique=False,
    )
    # 1:1 uniqueness — each hearing has at most one committee_hearings row.
    op.create_index(
        "uq_committee_hearings_hearing_id",
        "committee_hearings",
        ["hearing_id"],
        unique=True,
    )

    # ── 5. Migrate meetings → committee_hearings ────────────────────────────
    op.execute(
        """
        INSERT INTO committee_hearings (hearing_id, committee_name, committee_type, committee_url)
        SELECT id, committee_name, committee_type, committee_url
        FROM meetings
        """
    )

    # ── 6. Rename meeting_agenda_versions → hearing_agenda_versions ─────────
    op.rename_table("meeting_agenda_versions", "hearing_agenda_versions")

    # Drop old indexes / FK before renaming the column.
    op.drop_index(
        "ix_meeting_agenda_versions_meeting_id",
        table_name="hearing_agenda_versions",
    )
    op.drop_index(
        "uq_meeting_agenda_current",
        table_name="hearing_agenda_versions",
    )
    op.drop_constraint(
        "meeting_agenda_versions_meeting_id_fkey",
        "hearing_agenda_versions",
        type_="foreignkey",
    )

    op.alter_column(
        "hearing_agenda_versions", "meeting_id", new_column_name="hearing_id"
    )

    op.create_foreign_key(
        "hearing_agenda_versions_hearing_id_fkey",
        "hearing_agenda_versions",
        "hearings",
        ["hearing_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_hearing_agenda_versions_hearing_id",
        "hearing_agenda_versions",
        ["hearing_id"],
        unique=False,
    )
    op.create_index(
        "uq_hearing_agenda_current",
        "hearing_agenda_versions",
        ["hearing_id"],
        unique=True,
        postgresql_where=sa.text("is_current = TRUE"),
    )

    # ── 7. Drop meetings table ───────────────────────────────────────────────
    # The uq_meeting_active partial index must be dropped explicitly first.
    op.execute("DROP INDEX IF EXISTS uq_meeting_active")
    op.drop_table("meetings")

    # ── 8. Deduplicate before creating unique indexes ────────────────────────
    # The old meetings table had no uniqueness constraint, so scrape runs could
    # accumulate duplicate active rows for the same committee+date. Keep the
    # highest-ID row (most recently inserted) per group and deactivate the rest.
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

    # ── 9. Unique indexes on hearings ────────────────────────────────────────
    op.execute(
        """
        CREATE UNIQUE INDEX uq_floor_hearing_active
        ON hearings (chamber, hearing_date, legislature_session)
        WHERE hearing_type = 'Floor' AND is_active = TRUE
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


def downgrade() -> None:
    # ── Restore meetings table ───────────────────────────────────────────────
    op.create_table(
        "meetings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("chamber", sa.String(length=1), nullable=False),
        sa.Column("committee_name", sa.String(length=200), nullable=False),
        sa.Column("committee_type", sa.String(length=100), nullable=False),
        sa.Column("committee_code", sa.String(length=20), nullable=True),
        sa.Column("committee_url", sa.String(length=500), nullable=True),
        sa.Column("meeting_date", sa.Date(), nullable=False),
        sa.Column("meeting_time", sa.Time(), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("legislature_session", sa.Integer(), nullable=False),
        sa.Column("dps_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "hidden",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("last_sync", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    # Restore data from hearings + committee_hearings back into meetings.
    op.execute(
        """
        INSERT INTO meetings (
            id, chamber, committee_name, committee_type, committee_code, committee_url,
            meeting_date, meeting_time, location, legislature_session, dps_notes,
            created_at, is_active, updated_at, hidden, last_sync
        )
        SELECT
            h.id, h.chamber, ch.committee_name, ch.committee_type, h.committee_code, ch.committee_url,
            h.hearing_date, h.hearing_time, h.location, h.legislature_session, h.dps_notes,
            h.created_at, h.is_active, h.updated_at, h.hidden, h.last_sync
        FROM hearings h
        JOIN committee_hearings ch ON ch.hearing_id = h.id
        WHERE h.hearing_type = 'Committee'
        """
    )
    op.execute(
        "SELECT setval('meetings_id_seq', COALESCE((SELECT MAX(id) FROM meetings), 1))"
    )

    op.execute(
        """
        CREATE UNIQUE INDEX uq_meeting_active
        ON meetings (chamber, committee_name, committee_type, meeting_date, meeting_time, legislature_session)
        WHERE is_active = TRUE
        """
    )

    # Restore hearing_agenda_versions → meeting_agenda_versions
    op.execute("DROP INDEX IF EXISTS uq_floor_hearing_active")
    op.execute("DROP INDEX IF EXISTS uq_committee_hearing_active")

    op.drop_index("uq_hearing_agenda_current", table_name="hearing_agenda_versions")
    op.drop_index(
        "ix_hearing_agenda_versions_hearing_id", table_name="hearing_agenda_versions"
    )
    op.drop_constraint(
        "hearing_agenda_versions_hearing_id_fkey",
        "hearing_agenda_versions",
        type_="foreignkey",
    )

    op.alter_column(
        "hearing_agenda_versions", "hearing_id", new_column_name="meeting_id"
    )

    op.create_foreign_key(
        "meeting_agenda_versions_meeting_id_fkey",
        "hearing_agenda_versions",
        "meetings",
        ["meeting_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_meeting_agenda_versions_meeting_id",
        "hearing_agenda_versions",
        ["meeting_id"],
        unique=False,
    )
    op.create_index(
        "uq_meeting_agenda_current",
        "hearing_agenda_versions",
        ["meeting_id"],
        unique=True,
        postgresql_where=sa.text("is_current = TRUE"),
    )

    op.rename_table("hearing_agenda_versions", "meeting_agenda_versions")

    op.drop_index("uq_committee_hearings_hearing_id", table_name="committee_hearings")
    op.drop_index("ix_committee_hearings_hearing_id", table_name="committee_hearings")
    op.drop_table("committee_hearings")
    op.drop_table("hearings")
    op.execute("DROP TYPE hearingtype")
