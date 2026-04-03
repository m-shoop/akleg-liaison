"""remove_tabled_and_died_in_committee_outcomes

Revision ID: c4d5e6f7a8b9
Revises: a7b8c9d0e1f2
Create Date: 2026-04-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_VALUES = (
    'HEARD_AND_HELD',
    'MOVED_OUT_OF_COMMITTEE',
    'READ_ON_FLOOR',
    'REFERRED_TO_COMMITTEE',
    'RULES_TO_CALENDAR',
    'AMENDED',
    'PASSED',
    'FAILED',
    'TRANSMITTED',
    'SIGNED_INTO_LAW',
    'VETOED',
    'POCKET_VETOED',
    'OTHER',
)

_OLD_VALUES = _NEW_VALUES[:2] + ('TABLED', 'DIED_IN_COMMITTEE') + _NEW_VALUES[2:]


def _recreate_enum(values: tuple[str, ...], *, tmp_name: str = 'outcome_type_enum_old') -> None:
    """Replace outcome_type_enum in-place with a new set of labels."""
    new_labels = ', '.join(f"'{v}'" for v in values)
    op.execute(f"ALTER TYPE outcome_type_enum RENAME TO {tmp_name}")
    op.execute(f"CREATE TYPE outcome_type_enum AS ENUM ({new_labels})")
    op.execute(
        "ALTER TABLE bill_event_outcomes "
        "ALTER COLUMN outcome_type TYPE outcome_type_enum "
        f"USING outcome_type::text::outcome_type_enum"
    )
    op.execute(f"DROP TYPE {tmp_name}")


def upgrade() -> None:
    # Remove the hallucinated/unused 'tabled' outcome row and any audit log
    # entries that reference it, then shrink the enum type.
    op.execute(
        "DELETE FROM audit_logs "
        "WHERE entity_type = 'bill_event_outcome' "
        "  AND entity_id IN ("
        "      SELECT id FROM bill_event_outcomes "
        "      WHERE outcome_type IN ('TABLED', 'DIED_IN_COMMITTEE')"
        "  )"
    )
    op.execute(
        "DELETE FROM bill_event_outcomes "
        "WHERE outcome_type IN ('TABLED', 'DIED_IN_COMMITTEE')"
    )
    _recreate_enum(_NEW_VALUES)


def downgrade() -> None:
    # Re-add the removed labels so the column type matches the old schema.
    # No data is restored.
    _recreate_enum(_OLD_VALUES)
