"""add assignment type to hearing assignments (LEG-140)

Differentiates awareness-only assignments from monitoring-reports assignments.
- Adds hearing_assignments.assignment_type (enum, default 'monitoring').
- Renames the existing 'hearing_assignment' email template to
  'hearing_assignment_monitoring' and rewrites its body for monitoring duties.
- Seeds a new 'hearing_assignment_awareness' template (body/subject copied
  from the original 'hearing_assignment' template).

Revision ID: f87d3a6d8cc3
Revises: 9d0e1f2a3b4c
Create Date: 2026-04-28 20:01:51.689644

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "f87d3a6d8cc3"
down_revision: Union[str, None] = "9d0e1f2a3b4c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


HEARING_ASSIGNMENT_SUBJECT = "({chamber}) {committee} {bill_number} // {short_title}"

# Body/subject for the new awareness template are intentionally identical to
# the original 'hearing_assignment' body — the design says the awareness
# template "body and subject will be copied from the existing
# hearing_assignment template". Downgrade relies on this equivalence.
HEARING_ASSIGNMENT_AWARENESS_BODY = """\
You have been assigned to a hearing.

- **Bill:** {bill_number} — {short_title}
- **Status:** {bill_status}
- **Committee:** ({chamber}) {committee}
- **Date:** {hearing_date}

Please review the bill and prepare any analysis you can share with the
director ahead of this hearing.
"""

HEARING_ASSIGNMENT_MONITORING_BODY = """\
You have been assigned to monitor a hearing.

- **Bill:** {bill_number} — {short_title}
- **Status:** {bill_status}
- **Committee:** ({chamber}) {committee}
- **Date:** {hearing_date}

Please take notes and send them to laurel.shoop@alaska.gov.

**Important Notes**

- **DPS-relevant actions or discussion**
    - *Committee member questions* — identify the legislator who asked, summarize the response, and flag any inaccuracies.
    - *Public comment* — note who testified (individual or advocacy group), their position (support / oppose / neutral), and summarize their concerns.
- **Amendments or committee substitute (CS) summary**
    - Amendment deadlines announced; amendments offered (conceptual or drafted); results of amendment votes; any impact to DPS.
    - *CS introduction* — record version/letter and note any changes in impact to DPS.
- **Other bill actions**
    - If the bill passes or fails, record who voted in favor and against.
    - If the bill is set aside for a later hearing, note the date if announced.
"""


email_templates = sa.table(
    "email_templates",
    sa.column("template_key", sa.Text),
    sa.column("body_markdown", sa.Text),
)


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Add assignment_type to hearing_assignments
    # ------------------------------------------------------------------
    op.execute(
        "CREATE TYPE assignment_type_enum AS ENUM ('awareness', 'monitoring')"
    )
    op.add_column(
        "hearing_assignments",
        sa.Column(
            "assignment_type",
            postgresql.ENUM(
                "awareness",
                "monitoring",
                name="assignment_type_enum",
                create_type=False,
            ),
            nullable=False,
            server_default="monitoring",
        ),
    )

    # ------------------------------------------------------------------
    # 2. Seed awareness template, rename + rewrite monitoring template
    # ------------------------------------------------------------------
    op.execute(
        sa.text(
            """
            INSERT INTO email_templates
                (template_key, name, description, subject_template, body_markdown)
            VALUES
                (:k, :n, :d, :s, :b)
            """
        ).bindparams(
            k="hearing_assignment_awareness",
            n="Hearing Assignment for Awareness",
            d="Sent when a department staff member is assigned to a hearing for awareness.",
            s=HEARING_ASSIGNMENT_SUBJECT,
            b=HEARING_ASSIGNMENT_AWARENESS_BODY,
        )
    )

    op.execute(
        email_templates.update()
        .where(email_templates.c.template_key == "hearing_assignment")
        .values(
            template_key="hearing_assignment_monitoring",
            body_markdown=HEARING_ASSIGNMENT_MONITORING_BODY,
        )
    )


def downgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Restore the renamed template, then drop the awareness template
    # ------------------------------------------------------------------
    # The original 'hearing_assignment' body was identical to the awareness
    # body (see comment on HEARING_ASSIGNMENT_AWARENESS_BODY).
    op.execute(
        email_templates.update()
        .where(email_templates.c.template_key == "hearing_assignment_monitoring")
        .values(
            template_key="hearing_assignment",
            body_markdown=HEARING_ASSIGNMENT_AWARENESS_BODY,
        )
    )

    op.execute(
        sa.text(
            "DELETE FROM email_templates WHERE template_key = :k"
        ).bindparams(k="hearing_assignment_awareness")
    )

    # ------------------------------------------------------------------
    # 2. Drop the column and the enum type
    # ------------------------------------------------------------------
    op.drop_column("hearing_assignments", "assignment_type")
    op.execute("DROP TYPE assignment_type_enum")
