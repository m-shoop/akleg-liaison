"""Seed four system-level reports (Hearings This Week, Tracked Bills, My Open Assignments, Open Tracking Requests)

Revision ID: 8c9d0e1f2a3b
Revises: 7a8b9c0d1e2f
Create Date: 2026-04-28 00:00:00.000000

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "8c9d0e1f2a3b"
down_revision: Union[str, None] = "7a8b9c0d1e2f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Sentinel placeholders resolved on the frontend at load time
# (see frontend/src/utils/criteriaSentinels.js).  Storing sentinels rather than
# resolved values keeps "this week" / "my email" reports correct over time.
WEEK_START = "@week_start"
WEEK_END = "@week_end"
CURRENT_USER_EMAIL = "@current_user_email"

SYSTEM_REPORTS = [
    {
        "display_name": "Hearings This Week",
        "registry_name": "hearings",
        "report_criteria": {
            "criteria": [{
                "id": "A",
                "value": {
                    "hearingDateMode": "range",
                    "hearingDateOn": "",
                    "hearingDateFrom": WEEK_START,
                    "hearingDateTo": WEEK_END,
                    "chamber": [],
                    "legislature_session": [],
                    "showInactive": False,
                    "showHidden": False,
                    "advanced": {},
                },
            }],
            "expression": "",
            "nextLetterIndex": 1,
        },
    },
    {
        "display_name": "Tracked Bills",
        "registry_name": "bills",
        "report_criteria": {
            "criteria": [{
                "id": "A",
                "value": {
                    "tracked": "tracked",
                    "hearingDateMode": "any",
                    "hearingDateOn": "",
                    "hearingDateFrom": "",
                    "hearingDateTo": "",
                    "advanced": {},
                },
            }],
            "expression": "",
            "nextLetterIndex": 1,
        },
    },
    {
        "display_name": "My Open Assignments",
        "registry_name": "hearing_assignments",
        "report_criteria": {
            "criteria": [{
                "id": "A",
                "value": {
                    "latest_action_type": ["hearing_assigned", "reassignment_request"],
                    "assignee_email": CURRENT_USER_EMAIL,
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
        "display_name": "Open Tracking Requests",
        "registry_name": "requests",
        "report_criteria": {
            "criteria": [{
                "id": "A",
                "value": {
                    "workflow_status": ["open"],
                    "outcome": [],
                    "bill_number": "",
                    "requestor_email": "",
                    "bill_is_tracked": None,
                    "advanced": {
                        "created_at_from": "",
                        "created_at_to": "",
                        "updated_at_from": "",
                        "updated_at_to": "",
                        "bill_short_title": "",
                        "bill_session": [],
                        "bill_status": "",
                    },
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
                     NULL, '{}', TRUE, CAST(:report_criteria AS JSONB))
                ON CONFLICT DO NOTHING
            """).bindparams(
                display_name=r["display_name"],
                registry_name=r["registry_name"],
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
