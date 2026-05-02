"""merge production fix d7e8f9a0b1c2 into feature

Revision ID: c2570ca09907
Revises: b4c5d6e7f8a9, d7e8f9a0b1c2
Create Date: 2026-04-23 12:51:46.501781

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2570ca09907'
down_revision: Union[str, None] = ('b4c5d6e7f8a9', 'd7e8f9a0b1c2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
