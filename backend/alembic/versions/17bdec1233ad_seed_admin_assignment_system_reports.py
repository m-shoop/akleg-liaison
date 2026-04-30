"""Seed admin-only system reports: All Open Assignments, Needs Assignment

These were quick-preset buttons on the Tasks page; promoting them to system
reports puts them alongside other saved reports and gates them to users with
the workflow:view-all permission (i.e. admins).

Revision ID: 17bdec1233ad
Revises: f87d3a6d8cc3
Create Date: 2026-04-28 22:30:00.000000

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "17bdec1233ad"
down_revision: Union[str, None] = "f87d3a6d8cc3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Empty cells use empty strings/arrays to match the row schema produced by
# stackingHelpers.makeAssignmentNewRowValue / ASSIGNMENT_ROW_DEFAULTS.
SYSTEM_REPORTS = [
    {
        "display_name": "All Open Assignments",
        "registry_name": "hearing_assignments",
        "required_permissions": ["workflow:view-all"],
        "report_criteria": {
            "criteria": [{
                "id": "A",
                "value": {
                    "latest_action_type": [
                        "hearing_assigned",
                        "reassignment_request",
                        "auto_suggested_hearing_assignment",
                    ],
                    "assignee_email": "",
                    "bill_number": "",
                    "hearing_date_from": "",
                    "hearing_date_to": "",
                },
            }],
            "expression": "",
            "nextLetterIndex": 1,
        },
    },
    {
        "display_name": "Needs Assignment",
        "registry_name": "hearing_assignments",
        "required_permissions": ["workflow:view-all"],
        "report_criteria": {
            "criteria": [{
                "id": "A",
                "value": {
                    "latest_action_type": [
                        "auto_suggested_hearing_assignment",
                        "reassignment_request",
                    ],
                    "assignee_email": "",
                    "bill_number": "",
                    "hearing_date_from": "",
                    "hearing_date_to": "",
                },
            }],
            "expression": "",
            "nextLetterIndex": 1,
        },
    },
]


def upgrade() -> None:
    for r in SYSTEM_REPORTS:
        op.execute(
            sa.text("""
                INSERT INTO saved_reports
                    (display_name, registry_name, publication_level,
                     user_id, required_permissions, is_active, report_criteria)
                VALUES
                    (:display_name, :registry_name, 'system',
                     NULL, :required_permissions, TRUE, CAST(:report_criteria AS JSONB))
                ON CONFLICT DO NOTHING
            """).bindparams(
                display_name=r["display_name"],
                registry_name=r["registry_name"],
                required_permissions=r["required_permissions"],
                report_criteria=json.dumps(r["report_criteria"]),
            )
        )


def downgrade() -> None:
    names = [r["display_name"] for r in SYSTEM_REPORTS]
    op.execute(
        sa.text("""
            DELETE FROM saved_reports
            WHERE publication_level = 'system'
              AND display_name = ANY(:names)
        """).bindparams(names=names)
    )
