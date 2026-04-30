"""Rename saved_reports.required_permissions -> allowed_roles, gating by role instead of permission.

Translates existing values: each report's required permissions become the set
of roles whose grants overlap those permissions (so a user who would have been
visible-via-permission stays visible-via-role).

Revision ID: 3c4d5e6f7a8b
Revises: c5d6e7f8a9b0
Create Date: 2026-04-30 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "3c4d5e6f7a8b"
down_revision: Union[str, None] = "c5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add the new column with empty default; populate it before dropping the old one.
    op.execute(sa.text("""
        ALTER TABLE saved_reports
        ADD COLUMN allowed_roles TEXT[] NOT NULL DEFAULT '{}'
    """))

    # Translate required_permissions -> allowed_roles by mapping each permission
    # to every role that grants it, then deduping. Empty arrays stay empty.
    op.execute(sa.text("""
        UPDATE saved_reports sr
        SET allowed_roles = COALESCE(translated.roles, '{}')
        FROM (
            SELECT
                sr2.id,
                ARRAY(
                    SELECT DISTINCT r.name
                    FROM unnest(sr2.required_permissions) AS rp(perm_name)
                    JOIN permissions p ON p.name = rp.perm_name
                    JOIN role_permissions link ON link.permission_id = p.id
                    JOIN roles r ON r.id = link.role_id
                    ORDER BY r.name
                ) AS roles
            FROM saved_reports sr2
            WHERE cardinality(sr2.required_permissions) > 0
        ) AS translated
        WHERE sr.id = translated.id
    """))

    op.execute(sa.text("ALTER TABLE saved_reports DROP COLUMN required_permissions"))


def downgrade() -> None:
    op.execute(sa.text("""
        ALTER TABLE saved_reports
        ADD COLUMN required_permissions TEXT[] NOT NULL DEFAULT '{}'
    """))

    # Reverse mapping: gather all permissions held by any of the allowed roles.
    op.execute(sa.text("""
        UPDATE saved_reports sr
        SET required_permissions = COALESCE(translated.perms, '{}')
        FROM (
            SELECT
                sr2.id,
                ARRAY(
                    SELECT DISTINCT p.name
                    FROM unnest(sr2.allowed_roles) AS ar(role_name)
                    JOIN roles r ON r.name = ar.role_name
                    JOIN role_permissions link ON link.role_id = r.id
                    JOIN permissions p ON p.id = link.permission_id
                    ORDER BY p.name
                ) AS perms
            FROM saved_reports sr2
            WHERE cardinality(sr2.allowed_roles) > 0
        ) AS translated
        WHERE sr.id = translated.id
    """))

    op.execute(sa.text("ALTER TABLE saved_reports DROP COLUMN allowed_roles"))
