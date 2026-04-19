"""add prior-hearing-agendas:view permission

Revision ID: 5dc0ae18d47e
Revises: 4f7a1c9e2d85, e7f8a9b0c1d2
Create Date: 2026-04-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '5dc0ae18d47e'
down_revision: Union[str, tuple, None] = ('4f7a1c9e2d85', 'e7f8a9b0c1d2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PERMISSION_NAME = 'prior-hearing-agendas:view'


def upgrade() -> None:
    conn = op.get_bind()

    # Insert the new permission (skip if it already exists)
    conn.execute(
        sa.text(
            "INSERT INTO permissions (name) VALUES (:name) ON CONFLICT (name) DO NOTHING"
        ),
        {"name": PERMISSION_NAME},
    )

    # Grant it to every existing role
    conn.execute(
        sa.text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r
            CROSS JOIN permissions p
            WHERE p.name = :name
            ON CONFLICT DO NOTHING
            """
        ),
        {"name": PERMISSION_NAME},
    )


def downgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text(
            """
            DELETE FROM role_permissions
            WHERE permission_id = (
                SELECT id FROM permissions WHERE name = :name
            )
            """
        ),
        {"name": PERMISSION_NAME},
    )

    conn.execute(
        sa.text("DELETE FROM permissions WHERE name = :name"),
        {"name": PERMISSION_NAME},
    )
