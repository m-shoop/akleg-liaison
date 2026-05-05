"""Rename comm-prefs:admin permission to user:manage.

The permission now gates the full set of admin-of-user actions surfaced on
the new Manage Users page (create/edit-name/delete/revive accounts and
edit other users' comm prefs), so a name scoped to "comm-prefs" no longer
fits. Renaming the row in place preserves the existing role_permissions
mappings (those join by permission_id, not name).

Revision ID: 028b806a62bd
Revises: 5b6ea8669f53
Create Date: 2026-05-05 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "028b806a62bd"
down_revision: Union[str, None] = "5b6ea8669f53"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text("UPDATE permissions SET name = 'user:manage' WHERE name = 'comm-prefs:admin'")
    )


def downgrade() -> None:
    op.execute(
        sa.text("UPDATE permissions SET name = 'comm-prefs:admin' WHERE name = 'user:manage'")
    )
