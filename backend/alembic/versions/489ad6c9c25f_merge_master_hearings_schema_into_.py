"""merge master hearings schema into feature/unique-logins

Revision ID: 489ad6c9c25f
Revises: 0f6deb8ccb8c, a2b3c4d5e6f7
Create Date: 2026-04-19 14:48:51.768575

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '489ad6c9c25f'
down_revision: Union[str, None] = ('0f6deb8ccb8c', 'a2b3c4d5e6f7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
