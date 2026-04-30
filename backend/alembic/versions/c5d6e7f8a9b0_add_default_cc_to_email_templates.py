"""Add default_cc_email to email_templates.

Adds an optional CC address per template. When set, the worker passes it as
the Postmark `Cc` field when sending notifications using that template. The
recipient's opt-out setting still gates the whole send: if the recipient is
opted out the row is suppressed and no email (and no CC) goes out.

Revision ID: c5d6e7f8a9b0
Revises: 17bdec1233ad
Create Date: 2026-04-29 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, None] = "17bdec1233ad"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "email_templates",
        sa.Column("default_cc_email", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("email_templates", "default_cc_email")
