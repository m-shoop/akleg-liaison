"""add meeting_agenda_versions and migrate agenda_items FK

Implements LEG-114: agenda item versioning. Creates the meeting_agenda_versions
table, seeds a version-1 row for every meeting that already has agenda items,
migrates agenda_items.meeting_id to agenda_items.agenda_version_id, and drops
the old meeting_id column.

Historical agenda items are never deleted; replace_agenda_items now creates a
new version row on each distinct scrape rather than overwriting in place.

Revision ID: 4f7a1c9e2d85
Revises: b9c0d1e2f3a4
Create Date: 2026-04-17 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '4f7a1c9e2d85'
down_revision: Union[str, None] = 'b9c0d1e2f3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create meeting_agenda_versions table
    op.create_table(
        'meeting_agenda_versions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('meeting_id', sa.Integer(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('is_current', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('agenda_hash', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_meeting_agenda_versions_meeting_id',
        'meeting_agenda_versions',
        ['meeting_id'],
        unique=False,
    )
    # Enforce at most one current version per meeting
    op.create_index(
        'uq_meeting_agenda_current',
        'meeting_agenda_versions',
        ['meeting_id'],
        unique=True,
        postgresql_where=sa.text('is_current = TRUE'),
    )

    # 2. Seed version 1 for every meeting that already has agenda items.
    #    agenda_hash is NULL for these rows — the hash was not computed at
    #    original insert time. The next scrape will compute a fresh hash and
    #    either leave this version in place (if content unchanged) or bump to
    #    version 2.
    op.execute("""
        INSERT INTO meeting_agenda_versions (meeting_id, version, is_current, agenda_hash, created_at)
        SELECT DISTINCT meeting_id, 1, TRUE, NULL, NOW()
        FROM agenda_items
    """)

    # 3. Add agenda_version_id to agenda_items (nullable for the data migration)
    op.add_column(
        'agenda_items',
        sa.Column('agenda_version_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_agenda_items_agenda_version_id',
        'agenda_items', 'meeting_agenda_versions',
        ['agenda_version_id'], ['id'],
        ondelete='CASCADE',
    )

    # 4. Populate agenda_version_id from the seeded version rows
    op.execute("""
        UPDATE agenda_items ai
        SET agenda_version_id = mav.id
        FROM meeting_agenda_versions mav
        WHERE ai.meeting_id = mav.meeting_id
    """)

    # 5. Make agenda_version_id non-nullable now that all rows are populated
    op.alter_column('agenda_items', 'agenda_version_id', nullable=False)
    op.create_index(
        'ix_agenda_items_agenda_version_id',
        'agenda_items',
        ['agenda_version_id'],
        unique=False,
    )

    # 6. Drop the old meeting_id FK, index, and column from agenda_items
    op.drop_index('ix_agenda_items_meeting_id', table_name='agenda_items')
    op.drop_constraint('agenda_items_meeting_id_fkey', 'agenda_items', type_='foreignkey')
    op.drop_column('agenda_items', 'meeting_id')


def downgrade() -> None:
    # Re-add meeting_id to agenda_items
    op.add_column(
        'agenda_items',
        sa.Column('meeting_id', sa.Integer(), nullable=True),
    )
    op.execute("""
        UPDATE agenda_items ai
        SET meeting_id = mav.meeting_id
        FROM meeting_agenda_versions mav
        WHERE ai.agenda_version_id = mav.id
    """)
    op.alter_column('agenda_items', 'meeting_id', nullable=False)
    op.create_foreign_key(
        'agenda_items_meeting_id_fkey',
        'agenda_items', 'meetings',
        ['meeting_id'], ['id'],
        ondelete='CASCADE',
    )
    op.create_index('ix_agenda_items_meeting_id', 'agenda_items', ['meeting_id'], unique=False)

    # Drop agenda_version_id from agenda_items
    op.drop_index('ix_agenda_items_agenda_version_id', table_name='agenda_items')
    op.drop_constraint('fk_agenda_items_agenda_version_id', 'agenda_items', type_='foreignkey')
    op.drop_column('agenda_items', 'agenda_version_id')

    # Drop meeting_agenda_versions (indexes are dropped with the table)
    op.drop_index('uq_meeting_agenda_current', table_name='meeting_agenda_versions')
    op.drop_index('ix_meeting_agenda_versions_meeting_id', table_name='meeting_agenda_versions')
    op.drop_table('meeting_agenda_versions')
