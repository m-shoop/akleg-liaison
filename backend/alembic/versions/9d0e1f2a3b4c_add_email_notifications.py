"""Email notifications for hearing assignments (LEG-138).

Adds:
- email_templates, email_notifications, user_comm_prefs, user_comm_prefs_history,
  workflow_action_messages tables.
- 'hearing_reassigned' value on workflow_action_type_enum.
- Permissions: 'email-template:edit', 'email-notification:view',
  'comm-prefs:admin' (admin only).
- Seed rows for the two initial templates: hearing_assignment, hearing_assignment_canceled.

Revision ID: 9d0e1f2a3b4c
Revises: 8c9d0e1f2a3b
Create Date: 2026-04-28 14:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "9d0e1f2a3b4c"
down_revision: Union[str, None] = "8c9d0e1f2a3b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


NEW_PERMISSIONS = [
    "email-template:edit",
    "email-notification:view",
    "comm-prefs:admin",
]


HEARING_ASSIGNMENT_SUBJECT = "({chamber}) {committee} {bill_number} // {short_title}"

HEARING_ASSIGNMENT_BODY = """\
You have been assigned to a hearing.

- **Bill:** {bill_number} — {short_title}
- **Status:** {bill_status}
- **Committee:** ({chamber}) {committee}
- **Date:** {hearing_date}

Please review the bill and prepare any analysis you can share with the
director ahead of this hearing.
"""

HEARING_ASSIGNMENT_CANCELED_SUBJECT = "Re: ({chamber}) {committee} {bill_number} // {short_title} [CANCELED]"

HEARING_ASSIGNMENT_CANCELED_BODY = """\
The following hearing assignment has been canceled.

- **Bill:** {bill_number} — {short_title}
- **Committee:** ({chamber}) {committee}
- **Date:** {hearing_date}

**Reason:** {cancellation_reason}
"""


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Broaden workflow_action_type_enum with 'hearing_reassigned'
    # ------------------------------------------------------------------
    op.execute("ALTER TYPE workflow_action_type_enum ADD VALUE IF NOT EXISTS 'hearing_reassigned'")

    # ------------------------------------------------------------------
    # 2. email_templates
    # ------------------------------------------------------------------
    op.create_table(
        "email_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("template_key", sa.Text(), nullable=False, unique=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("subject_template", sa.Text(), nullable=False),
        sa.Column("body_markdown", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_by",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )

    # ------------------------------------------------------------------
    # 3. email_notifications
    # ------------------------------------------------------------------
    op.create_table(
        "email_notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "hearing_assignment_id",
            sa.Integer(),
            sa.ForeignKey("hearing_assignments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workflow_action_id",
            sa.Integer(),
            sa.ForeignKey("workflow_actions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "template_id",
            sa.Integer(),
            sa.ForeignKey("email_templates.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column(
            "recipient_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("recipient_email", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("suppressed_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.CheckConstraint(
            "(sent_at IS NULL OR suppressed_reason IS NULL) "
            "AND (sent_at IS NULL OR error IS NULL) "
            "AND (suppressed_reason IS NULL OR error IS NULL)",
            name="chk_status_exclusivity",
        ),
    )
    op.create_index(
        "idx_email_notifications_assignment_event",
        "email_notifications",
        ["hearing_assignment_id", "event_type"],
    )

    # ------------------------------------------------------------------
    # 4. user_comm_prefs
    # ------------------------------------------------------------------
    op.create_table(
        "user_comm_prefs",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "email_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("TRUE"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_by",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )

    # ------------------------------------------------------------------
    # 5. user_comm_prefs_history
    # ------------------------------------------------------------------
    op.create_table(
        "user_comm_prefs_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("field", sa.Text(), nullable=False),
        sa.Column("old_value", sa.Boolean(), nullable=True),
        sa.Column("new_value", sa.Boolean(), nullable=False),
        sa.Column(
            "changed_by",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("source", sa.Text(), nullable=True),
        sa.Column(
            "changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index(
        "idx_user_comm_prefs_history_user_time",
        "user_comm_prefs_history",
        ["user_id", sa.text("changed_at DESC")],
    )

    # ------------------------------------------------------------------
    # 6. workflow_action_messages
    # ------------------------------------------------------------------
    op.create_table(
        "workflow_action_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "workflow_action_id",
            sa.Integer(),
            sa.ForeignKey("workflow_actions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("message_type", sa.Text(), nullable=False),
        sa.Column("action_message", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.UniqueConstraint(
            "workflow_action_id",
            "message_type",
            name="uq_workflow_action_message_type",
        ),
    )

    # ------------------------------------------------------------------
    # 7. Seed initial templates
    # ------------------------------------------------------------------
    op.execute(
        sa.text("""
            INSERT INTO email_templates
                (template_key, name, description, subject_template, body_markdown)
            VALUES
                (:k, :n, :d, :s, :b)
        """).bindparams(
            k="hearing_assignment",
            n="Hearing Assignment",
            d="Sent when a department staff member is assigned to a hearing.",
            s=HEARING_ASSIGNMENT_SUBJECT,
            b=HEARING_ASSIGNMENT_BODY,
        )
    )
    op.execute(
        sa.text("""
            INSERT INTO email_templates
                (template_key, name, description, subject_template, body_markdown)
            VALUES
                (:k, :n, :d, :s, :b)
        """).bindparams(
            k="hearing_assignment_canceled",
            n="Hearing Assignment Canceled",
            d="Sent when a previously notified hearing assignment is canceled.",
            s=HEARING_ASSIGNMENT_CANCELED_SUBJECT,
            b=HEARING_ASSIGNMENT_CANCELED_BODY,
        )
    )

    # ------------------------------------------------------------------
    # 8. Seed permissions and grant to admin role
    # ------------------------------------------------------------------
    for perm in NEW_PERMISSIONS:
        op.execute(
            sa.text("INSERT INTO permissions (name) VALUES (:name) ON CONFLICT DO NOTHING")
            .bindparams(name=perm)
        )
        op.execute(
            sa.text("""
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id FROM roles r, permissions p
                WHERE r.name = 'admin' AND p.name = :perm
                ON CONFLICT DO NOTHING
            """).bindparams(perm=perm)
        )


def downgrade() -> None:
    # Remove the new permissions (role_permissions cascade clears the join rows).
    for perm in NEW_PERMISSIONS:
        op.execute(
            sa.text("DELETE FROM permissions WHERE name = :name").bindparams(name=perm)
        )

    op.drop_table("workflow_action_messages")
    op.drop_index(
        "idx_user_comm_prefs_history_user_time",
        table_name="user_comm_prefs_history",
    )
    op.drop_table("user_comm_prefs_history")
    op.drop_table("user_comm_prefs")
    op.drop_index(
        "idx_email_notifications_assignment_event",
        table_name="email_notifications",
    )
    op.drop_table("email_notifications")
    op.drop_table("email_templates")

    # Postgres cannot remove a single value from an enum without recreating the type.
    # We leave 'hearing_reassigned' on the enum on downgrade — harmless residue.
