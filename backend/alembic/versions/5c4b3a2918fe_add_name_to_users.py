"""add name to users

Adds a nullable `name` column to the users table so admins can label users
with a human-readable full name. Email remains the unique identifier.

Revision ID: 5c4b3a2918fe
Revises: a4b5c6d7e8f9
Create Date: 2026-05-03 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "5c4b3a2918fe"
down_revision: Union[str, None] = "a4b5c6d7e8f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("name", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "name")
