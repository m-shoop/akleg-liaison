"""Add hearing_assignments table, new workflow enum values, and hearing-assignment permissions

Revision ID: b4c5d6e7f8a9
Revises: 489ad6c9c25f
Create Date: 2026-04-22 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b4c5d6e7f8a9"
down_revision: Union[str, None] = "489ad6c9c25f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_WORKFLOW_TYPE = "hearing_assignment"

NEW_ACTION_TYPES = [
    "hearing_assigned",
    "hearing_assignment_complete",
    "reassignment_request",
    "hearing_assignment_canceled",
    "auto_suggested_hearing_assignment",
    "hearing_assignment_discarded",
]

NEW_PERMISSIONS = [
    "hearing-assignment:view",
    "hearing-assignment:view-auto-suggestions",
]


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Extend workflow_type_enum with 'hearing_assignment'
    #    ALTER TYPE ADD VALUE cannot run inside a transaction on PG < 12.
    #    The IF NOT EXISTS guard makes it safe to re-run.
    # ------------------------------------------------------------------
    op.execute(sa.text(
        "ALTER TYPE workflow_type_enum ADD VALUE IF NOT EXISTS 'hearing_assignment'"
    ))

    # ------------------------------------------------------------------
    # 2. Extend workflow_action_type_enum with the six new action types
    # ------------------------------------------------------------------
    for value in NEW_ACTION_TYPES:
        op.execute(sa.text(
            f"ALTER TYPE workflow_action_type_enum ADD VALUE IF NOT EXISTS '{value}'"
        ))

    # ------------------------------------------------------------------
    # 3. Create hearing_assignments table
    # ------------------------------------------------------------------
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS hearing_assignments (
            id          SERIAL  PRIMARY KEY,
            assignee_id INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
            hearing_id  INTEGER NOT NULL REFERENCES hearings(id) ON DELETE CASCADE,
            bill_id     INTEGER          REFERENCES bills(id)    ON DELETE SET NULL,
            workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            CONSTRAINT uq_hearing_assignment_workflow UNIQUE (workflow_id)
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_hearing_assignments_hearing_id"
        " ON hearing_assignments (hearing_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_hearing_assignments_assignee_id"
        " ON hearing_assignments (assignee_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_hearing_assignments_bill_id"
        " ON hearing_assignments (bill_id)"
    ))

    # ------------------------------------------------------------------
    # 4. Add new permissions
    # ------------------------------------------------------------------
    for perm in NEW_PERMISSIONS:
        op.execute(
            sa.text("INSERT INTO permissions (name) VALUES (:name) ON CONFLICT DO NOTHING")
            .bindparams(name=perm)
        )

    # ------------------------------------------------------------------
    # 5. Assign permissions to roles
    #    hearing-assignment:view       → admin and viewer
    #    hearing-assignment:view-auto-suggestions → admin only
    # ------------------------------------------------------------------
    for role_name in ("admin", "viewer"):
        op.execute(
            sa.text("""
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id FROM roles r, permissions p
                WHERE r.name = :role AND p.name = 'hearing-assignment:view'
                ON CONFLICT DO NOTHING
            """).bindparams(role=role_name)
        )

    op.execute(
        sa.text("""
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id FROM roles r, permissions p
            WHERE r.name = 'admin' AND p.name = 'hearing-assignment:view-auto-suggestions'
            ON CONFLICT DO NOTHING
        """)
    )


def downgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Remove role_permissions and permissions for new permissions
    # ------------------------------------------------------------------
    op.execute(
        sa.text("""
            DELETE FROM role_permissions
            WHERE permission_id IN (
                SELECT id FROM permissions WHERE name = ANY(:names)
            )
        """).bindparams(names=NEW_PERMISSIONS)
    )
    op.execute(
        sa.text("DELETE FROM permissions WHERE name = ANY(:names)")
        .bindparams(names=NEW_PERMISSIONS)
    )

    # ------------------------------------------------------------------
    # 2. Drop hearing_assignments table
    # ------------------------------------------------------------------
    op.execute(sa.text("DROP TABLE IF EXISTS hearing_assignments"))

    # ------------------------------------------------------------------
    # 3. Remove the new workflow action type values from the enum.
    #    PostgreSQL does not support DROP VALUE on an enum, so we
    #    recreate it: rename → rebuild → re-cast → drop old.
    # ------------------------------------------------------------------
    # Guard: fail early if any rows use the values we are about to remove.
    for value in NEW_ACTION_TYPES:
        op.execute(sa.text(f"""
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM workflow_actions WHERE type = '{value}'::workflow_action_type_enum
                ) THEN
                    RAISE EXCEPTION
                        'Cannot downgrade: workflow_actions rows exist with type = ''{value}''';
                END IF;
            END $$;
        """))

    op.execute(sa.text(
        "ALTER TYPE workflow_action_type_enum RENAME TO workflow_action_type_enum_old"
    ))
    op.execute(sa.text("""
        CREATE TYPE workflow_action_type_enum AS ENUM (
            'request_bill_tracking',
            'deny_bill_tracking',
            'approve_bill_tracking'
        )
    """))
    op.execute(sa.text("""
        ALTER TABLE workflow_actions
            ALTER COLUMN type TYPE workflow_action_type_enum
            USING type::text::workflow_action_type_enum
    """))
    op.execute(sa.text("DROP TYPE workflow_action_type_enum_old"))

    # ------------------------------------------------------------------
    # 4. Remove the new workflow type value from the enum.
    # ------------------------------------------------------------------
    op.execute(sa.text(f"""
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM workflows WHERE type = 'hearing_assignment'::workflow_type_enum
            ) THEN
                RAISE EXCEPTION
                    'Cannot downgrade: workflows rows exist with type = ''hearing_assignment''';
            END IF;
        END $$;
    """))

    op.execute(sa.text(
        "ALTER TYPE workflow_type_enum RENAME TO workflow_type_enum_old"
    ))
    op.execute(sa.text(
        "CREATE TYPE workflow_type_enum AS ENUM ('request_bill_tracking')"
    ))
    op.execute(sa.text("""
        ALTER TABLE workflows
            ALTER COLUMN type TYPE workflow_type_enum
            USING type::text::workflow_type_enum
    """))
    op.execute(sa.text("DROP TYPE workflow_type_enum_old"))
