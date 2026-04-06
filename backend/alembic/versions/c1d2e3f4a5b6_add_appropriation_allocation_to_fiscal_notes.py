"""add fn_appropriation and fn_allocation to fiscal_notes

Revision ID: c1d2e3f4a5b6
Revises: b1c2d3e4f5a6
Create Date: 2026-04-06 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("fiscal_notes", sa.Column("fn_appropriation", sa.String(500), nullable=True))
    op.add_column("fiscal_notes", sa.Column("fn_allocation", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("fiscal_notes", "fn_allocation")
    op.drop_column("fiscal_notes", "fn_appropriation")
