"""add_role_to_users

Revision ID: f2a3b4c5d6e7
Revises: e5f6a7b8c9d0
Create Date: 2026-03-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE TYPE user_role_enum AS ENUM ('admin', 'viewer')")
    op.add_column(
        'users',
        sa.Column(
            'role',
            sa.Enum('admin', 'viewer', name='user_role_enum'),
            nullable=False,
            server_default='admin',
        ),
    )


def downgrade() -> None:
    op.drop_column('users', 'role')
    op.execute("DROP TYPE user_role_enum")
