"""Add workflow tables and new permissions (bill:request-tracking, workflow:view-all, workflow:approve-tracking)

Revision ID: 0f6deb8ccb8c
Revises: f3a4b5c6d7e8
Create Date: 2026-04-14 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0f6deb8ccb8c"
down_revision: Union[str, None] = "f3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    "bill:request-tracking",
    "workflow:view-all",
    "workflow:approve-tracking",
]


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Create enums (idempotent — no-op if they already exist)
    # ------------------------------------------------------------------
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE workflow_type_enum AS ENUM ('request_bill_tracking');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
    """))
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE workflow_status_enum AS ENUM ('open', 'closed');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
    """))
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE workflow_action_type_enum AS ENUM
                ('request_bill_tracking', 'deny_bill_tracking', 'approve_bill_tracking');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
    """))

    # ------------------------------------------------------------------
    # 2. Create workflows table (raw SQL avoids sa.Enum re-creating types)
    # ------------------------------------------------------------------
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS workflows (
            id          SERIAL PRIMARY KEY,
            type        workflow_type_enum   NOT NULL,
            status      workflow_status_enum NOT NULL DEFAULT 'open',
            created_by  INTEGER             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at  TIMESTAMPTZ         NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ         NOT NULL DEFAULT now()
        )
    """))

    # ------------------------------------------------------------------
    # 3. Create workflow_actions table
    # ------------------------------------------------------------------
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS workflow_actions (
            id               SERIAL PRIMARY KEY,
            workflow_id      INTEGER                     NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            type             workflow_action_type_enum   NOT NULL,
            user_id          INTEGER                     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            action_timestamp TIMESTAMPTZ                 NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_workflow_actions_workflow_id ON workflow_actions (workflow_id)"
    ))

    # ------------------------------------------------------------------
    # 4. Create bill_tracking_requests table
    # ------------------------------------------------------------------
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS bill_tracking_requests (
            id          SERIAL PRIMARY KEY,
            bill_id     INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
            workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            CONSTRAINT uq_bill_tracking_request_workflow UNIQUE (workflow_id)
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_bill_tracking_requests_bill_id ON bill_tracking_requests (bill_id)"
    ))

    # ------------------------------------------------------------------
    # 5. Add new permissions
    # ------------------------------------------------------------------
    for perm in NEW_PERMISSIONS:
        op.execute(
            sa.text("INSERT INTO permissions (name) VALUES (:name)").bindparams(name=perm)
        )

    # ------------------------------------------------------------------
    # 6. Assign permissions to roles
    #    ALL users: bill:request-tracking
    #    Admin (has bill:track): workflow:view-all, workflow:approve-tracking
    # ------------------------------------------------------------------

    # bill:request-tracking → all roles
    for role_name in ("admin", "viewer"):
        op.execute(
            sa.text("""
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id FROM roles r, permissions p
                WHERE r.name = :role AND p.name = 'bill:request-tracking'
            """).bindparams(role=role_name)
        )

    # workflow:view-all and workflow:approve-tracking → admin only
    for perm in ("workflow:view-all", "workflow:approve-tracking"):
        op.execute(
            sa.text("""
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id FROM roles r, permissions p
                WHERE r.name = 'admin' AND p.name = :perm
            """).bindparams(perm=perm)
        )


def downgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Remove role_permissions entries for new permissions
    # ------------------------------------------------------------------
    op.execute(
        sa.text("""
            DELETE FROM role_permissions
            WHERE permission_id IN (
                SELECT id FROM permissions
                WHERE name IN ('bill:request-tracking', 'workflow:view-all', 'workflow:approve-tracking')
            )
        """)
    )

    # ------------------------------------------------------------------
    # 2. Remove permissions
    # ------------------------------------------------------------------
    op.execute(
        sa.text("""
            DELETE FROM permissions
            WHERE name IN ('bill:request-tracking', 'workflow:view-all', 'workflow:approve-tracking')
        """)
    )

    # ------------------------------------------------------------------
    # 3. Drop tables (order matters for FK constraints)
    # ------------------------------------------------------------------
    op.execute(sa.text("DROP TABLE IF EXISTS bill_tracking_requests"))
    op.execute(sa.text("DROP TABLE IF EXISTS workflow_actions"))
    op.execute(sa.text("DROP TABLE IF EXISTS workflows"))

    # ------------------------------------------------------------------
    # 4. Drop enums
    # ------------------------------------------------------------------
    op.execute(sa.text("DROP TYPE IF EXISTS workflow_action_type_enum"))
    op.execute(sa.text("DROP TYPE IF EXISTS workflow_status_enum"))
    op.execute(sa.text("DROP TYPE IF EXISTS workflow_type_enum"))
