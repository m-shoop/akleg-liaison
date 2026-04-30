"""Add saved_reports and default_user_reports tables, plus user-report and system-report permissions

Revision ID: 7a8b9c0d1e2f
Revises: c2570ca09907
Create Date: 2026-04-28 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "7a8b9c0d1e2f"
down_revision: Union[str, None] = "c2570ca09907"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    "user-report:edit",
    "system-report:edit",
]


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. publication_level enum
    # ------------------------------------------------------------------
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE publication_level_enum AS ENUM ('user', 'system');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$
    """))

    # ------------------------------------------------------------------
    # 2. saved_reports table
    # ------------------------------------------------------------------
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS saved_reports (
            id                   SERIAL  PRIMARY KEY,
            display_name         TEXT    NOT NULL,
            registry_name        TEXT    NOT NULL,
            publication_level    publication_level_enum NOT NULL,
            user_id              INTEGER REFERENCES users(id) ON DELETE CASCADE,
            required_permissions TEXT[]  NOT NULL DEFAULT '{}',
            is_active            BOOLEAN NOT NULL DEFAULT TRUE,
            report_criteria      JSONB   NOT NULL,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_saved_reports_user_matches_publication_level CHECK (
                (publication_level = 'user'   AND user_id IS NOT NULL) OR
                (publication_level = 'system' AND user_id IS NULL)
            )
        )
    """))

    # Partial unique indexes — Postgres treats NULL as distinct by default,
    # so a single composite UNIQUE on (display_name, publication_level, user_id)
    # would not enforce uniqueness across system-level rows.
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_reports_system_display_name"
        " ON saved_reports (display_name)"
        " WHERE publication_level = 'system'"
    ))
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_reports_user_display_name"
        " ON saved_reports (display_name, user_id)"
        " WHERE publication_level = 'user'"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_saved_reports_registry_name ON saved_reports (registry_name)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_saved_reports_user_id ON saved_reports (user_id)"
    ))

    # ------------------------------------------------------------------
    # 3. default_user_reports table
    # ------------------------------------------------------------------
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS default_user_reports (
            id            SERIAL  PRIMARY KEY,
            user_id       INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
            registry_name TEXT    NOT NULL,
            report_id     INTEGER NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
            CONSTRAINT uq_default_user_reports_user_registry UNIQUE (user_id, registry_name)
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_default_user_reports_report_id"
        " ON default_user_reports (report_id)"
    ))

    # ------------------------------------------------------------------
    # 4. New permissions
    # ------------------------------------------------------------------
    for perm in NEW_PERMISSIONS:
        op.execute(
            sa.text("INSERT INTO permissions (name) VALUES (:name) ON CONFLICT DO NOTHING")
            .bindparams(name=perm)
        )

    # ------------------------------------------------------------------
    # 5. Grant permissions to roles
    #    user-report:edit   → admin + viewer
    #    system-report:edit → admin only
    # ------------------------------------------------------------------
    for role_name in ("admin", "viewer"):
        op.execute(
            sa.text("""
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id FROM roles r, permissions p
                WHERE r.name = :role AND p.name = 'user-report:edit'
                ON CONFLICT DO NOTHING
            """).bindparams(role=role_name)
        )

    op.execute(sa.text("""
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r, permissions p
        WHERE r.name = 'admin' AND p.name = 'system-report:edit'
        ON CONFLICT DO NOTHING
    """))


def downgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Remove permissions and grants
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
    # 2. Drop tables (default_user_reports first — it FKs saved_reports)
    # ------------------------------------------------------------------
    op.execute(sa.text("DROP TABLE IF EXISTS default_user_reports"))
    op.execute(sa.text("DROP TABLE IF EXISTS saved_reports"))

    # ------------------------------------------------------------------
    # 3. Drop publication_level enum
    # ------------------------------------------------------------------
    op.execute(sa.text("DROP TYPE IF EXISTS publication_level_enum"))
