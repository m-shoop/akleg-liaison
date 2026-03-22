"""add tags and bill_tags tables

Revision ID: f1a2b3c4d5e6
Revises: d20befb1cd2b
Create Date: 2026-03-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'd20befb1cd2b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tags',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('label', sa.String(100), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.UniqueConstraint('label', name='uq_tag_label'),
    )

    op.create_table(
        'bill_tags',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('bill_id', sa.Integer(), sa.ForeignKey('bills.id', ondelete='CASCADE'), nullable=False),
        sa.Column('tag_id', sa.Integer(), sa.ForeignKey('tags.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.UniqueConstraint('bill_id', 'tag_id', name='uq_bill_tag'),
    )
    op.create_index('ix_bill_tags_bill_id', 'bill_tags', ['bill_id'])
    op.create_index('ix_bill_tags_tag_id', 'bill_tags', ['tag_id'])


def downgrade() -> None:
    op.drop_index('ix_bill_tags_tag_id', table_name='bill_tags')
    op.drop_index('ix_bill_tags_bill_id', table_name='bill_tags')
    op.drop_table('bill_tags')
    op.drop_table('tags')
