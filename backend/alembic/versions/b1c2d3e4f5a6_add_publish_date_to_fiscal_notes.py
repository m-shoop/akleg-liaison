"""add publish_date to fiscal_notes

Revision ID: b1c2d3e4f5a6
Revises: fa11ca1n0te01
Create Date: 2026-04-05 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "fa11ca1n0te01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("fiscal_notes", sa.Column("publish_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("fiscal_notes", "publish_date")
