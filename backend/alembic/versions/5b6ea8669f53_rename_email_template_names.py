"""Rename email template display names (and merge two heads).

Renames the four seeded email_templates rows to clearer, more uniform names:

    hearing_assignment_monitoring  "Hearing Assignment"              -> "Monitoring Assignment"
    hearing_assignment_awareness   "Hearing Assignment for Awareness" -> "Awareness Assignment"
    assignment_type_change         "Hearing Assignment Type Changed" -> "Assignment Type Change"
    hearing_assignment_canceled    "Hearing Assignment Canceled"     -> "Assignment Cancellation"

Only the `name` column is updated; `template_key` values are unchanged so all
backend dispatch and frontend references continue to work.

Also merges two outstanding alembic heads that existed before this migration:
`d4e5f6a7b8c9` (add_jobs_table) and `a8b9c0d1e2f3`
(add_assignment_type_change_email_template).

Revision ID: 5b6ea8669f53
Revises: d4e5f6a7b8c9, a8b9c0d1e2f3
Create Date: 2026-05-05 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "5b6ea8669f53"
down_revision: Union[str, Sequence[str], None] = ("d4e5f6a7b8c9", "a8b9c0d1e2f3")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_RENAMES = [
    ("hearing_assignment_monitoring", "Hearing Assignment",              "Monitoring Assignment"),
    ("hearing_assignment_awareness",  "Hearing Assignment for Awareness", "Awareness Assignment"),
    ("assignment_type_change",        "Hearing Assignment Type Changed", "Assignment Type Change"),
    ("hearing_assignment_canceled",   "Hearing Assignment Canceled",     "Assignment Cancellation"),
]


def _rename(old_to_new: list[tuple[str, str, str]]) -> None:
    stmt = sa.text(
        "UPDATE email_templates SET name = :new WHERE template_key = :k"
    )
    for key, _old, new in old_to_new:
        op.execute(stmt.bindparams(k=key, new=new))


def upgrade() -> None:
    _rename(_RENAMES)


def downgrade() -> None:
    reverted = [(k, new, old) for (k, old, new) in _RENAMES]
    _rename(reverted)
