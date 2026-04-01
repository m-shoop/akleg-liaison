"""add_meetings_tables

Revision ID: 3ef90762ed54
Revises: f1a2b3c4d5e6
Create Date: 2026-03-22 22:53:48.239188

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3ef90762ed54'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # meetings — base table (is_active, updated_at, hidden added by later migrations)
    op.create_table('meetings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('chamber', sa.String(length=1), nullable=False),
        sa.Column('committee_name', sa.String(length=200), nullable=False),
        sa.Column('committee_type', sa.String(length=100), nullable=False),
        sa.Column('committee_code', sa.String(length=20), nullable=True),
        sa.Column('committee_url', sa.String(length=500), nullable=True),
        sa.Column('meeting_date', sa.Date(), nullable=False),
        sa.Column('meeting_time', sa.Time(), nullable=True),
        sa.Column('location', sa.String(length=200), nullable=True),
        sa.Column('legislature_session', sa.Integer(), nullable=False),
        sa.Column('dps_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'chamber', 'committee_name', 'committee_type',
            'meeting_date', 'meeting_time', 'legislature_session',
            name='uq_meeting',
        ),
    )

    # bills_in_meeting — old junction table, dropped by 34cf033cebe8
    op.create_table('bills_in_meeting',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('meeting_id', sa.Integer(), nullable=False),
        sa.Column('bill_id', sa.Integer(), nullable=True),
        sa.Column('bill_number', sa.String(length=20), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_teleconferenced', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['bill_id'], ['bills.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('meeting_id', 'bill_number', name='uq_meeting_bill'),
    )
    op.create_index('ix_bills_in_meeting_bill_id', 'bills_in_meeting', ['bill_id'], unique=False)
    op.create_index('ix_bills_in_meeting_meeting_id', 'bills_in_meeting', ['meeting_id'], unique=False)

    # meeting_notes — old notes table, dropped by 34cf033cebe8
    op.create_table('meeting_notes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('meeting_id', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('url', sa.String(length=500), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_meeting_notes_meeting_id', 'meeting_notes', ['meeting_id'], unique=False)

    # agenda_items — replacement for bills_in_meeting + meeting_notes
    # (prefix column added by 869cd2b04f48)
    op.create_table('agenda_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('meeting_id', sa.Integer(), nullable=False),
        sa.Column('bill_id', sa.Integer(), nullable=True),
        sa.Column('bill_number', sa.String(length=20), nullable=True),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('url', sa.String(length=500), nullable=True),
        sa.Column('is_bill', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('is_teleconferenced', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['bill_id'], ['bills.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_agenda_items_meeting_id', 'agenda_items', ['meeting_id'], unique=False)
    op.create_index('ix_agenda_items_bill_id', 'agenda_items', ['bill_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_agenda_items_bill_id', table_name='agenda_items')
    op.drop_index('ix_agenda_items_meeting_id', table_name='agenda_items')
    op.drop_table('agenda_items')
    op.drop_index('ix_meeting_notes_meeting_id', table_name='meeting_notes')
    op.drop_table('meeting_notes')
    op.drop_index('ix_bills_in_meeting_meeting_id', table_name='bills_in_meeting')
    op.drop_index('ix_bills_in_meeting_bill_id', table_name='bills_in_meeting')
    op.drop_table('bills_in_meeting')
    op.drop_table('meetings')
