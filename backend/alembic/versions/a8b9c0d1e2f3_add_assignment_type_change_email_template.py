"""add assignment_type_change email template + workflow action enum value

Adds the ``hearing_assignment_type_changed`` value to
``workflow_action_type_enum`` and seeds the ``assignment_type_change`` email
template, which is sent to the assignee whenever an admin changes the type of
an active hearing assignment (without canceling and recreating it).

Revision ID: a8b9c0d1e2f3
Revises: 6d7e8f9a0b1c
Create Date: 2026-05-05 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a8b9c0d1e2f3"
down_revision: Union[str, None] = "6d7e8f9a0b1c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ASSIGNMENT_TYPE_CHANGE_SUBJECT = (
    "Re: ({chamber}) {committee} {bill_number} // {short_title} [TYPE CHANGED]"
)

ASSIGNMENT_TYPE_CHANGE_BODY = """\
The type of your hearing assignment has been changed.

- **Bill:** {bill_number} — {short_title}
- **Committee:** ({chamber}) {committee}
- **Date:** {hearing_date}
- **Previous type:** {previous_assignment_type}
- **New type:** {assignment_type}
"""


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Extend workflow_action_type_enum.
    #    ALTER TYPE ADD VALUE cannot run inside a transaction on PG < 12.
    #    The IF NOT EXISTS guard makes it safe to re-run.
    # ------------------------------------------------------------------
    op.execute(
        "ALTER TYPE workflow_action_type_enum "
        "ADD VALUE IF NOT EXISTS 'hearing_assignment_type_changed'"
    )

    # ------------------------------------------------------------------
    # 2. Seed the assignment_type_change email template.
    # ------------------------------------------------------------------
    op.execute(
        sa.text(
            """
            INSERT INTO email_templates
                (template_key, name, description, subject_template, body_markdown)
            VALUES
                (:k, :n, :d, :s, :b)
            ON CONFLICT (template_key) DO NOTHING
            """
        ).bindparams(
            k="assignment_type_change",
            n="Hearing Assignment Type Changed",
            d=(
                "Sent when an admin changes the type of an active hearing "
                "assignment (e.g. monitoring -> awareness) without canceling it."
            ),
            s=ASSIGNMENT_TYPE_CHANGE_SUBJECT,
            b=ASSIGNMENT_TYPE_CHANGE_BODY,
        )
    )


def downgrade() -> None:
    # Drop the seeded template. The enum value stays — Postgres can't remove a
    # value once any column references it, and dropping the type would force
    # recreating every workflow_actions row.
    op.execute(
        sa.text(
            "DELETE FROM email_templates WHERE template_key = :k"
        ).bindparams(k="assignment_type_change")
    )
