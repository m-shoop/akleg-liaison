"""add call_in to hearing assignments

Adds a boolean `call_in` flag on hearing_assignments. Admins toggle it
to instruct an assignee that they should call into the hearing; the
frontend renders a phone emoji (with a red slash overlay when off).
All existing rows default to false.

Revision ID: 64df21438ffe
Revises: 028b806a62bd
Create Date: 2026-05-06

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "64df21438ffe"
down_revision: Union[str, None] = "028b806a62bd"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "hearing_assignments",
        sa.Column(
            "call_in",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("hearing_assignments", "call_in")
