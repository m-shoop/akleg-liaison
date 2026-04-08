"""add RBAC tables (roles, permissions, role_permissions, user_roles)

Migrates the existing users.role column into the new many-to-many role system
and seeds the initial role/permission data.

Revision ID: b9c0d1e2f3a4
Revises: e6f7a8b9c0d1
Create Date: 2026-04-08 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b9c0d1e2f3a4"
down_revision: Union[str, None] = "e6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# All permissions in the system
ALL_PERMISSIONS = [
    "bill:track",
    "hearing:query",
    "bill:query",
    "hearing:hide",
    "hearing-notes:edit",
    "hearing-notes:view",
    "bill-tags:edit",
    "bill-tags:view",
    "hearing:export-ics",
]

VIEWER_PERMISSIONS = [
    "hearing-notes:view",
    "bill-tags:view",
    "hearing:export-ics",
]

# Admin gets every permission (including viewer's)
ADMIN_PERMISSIONS = ALL_PERMISSIONS


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Create new tables
    # ------------------------------------------------------------------
    op.create_table(
        "roles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(50), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_roles_name"),
    )

    op.create_table(
        "permissions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_permissions_name"),
    )

    op.create_table(
        "role_permissions",
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("permission_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["permission_id"], ["permissions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("role_id", "permission_id"),
    )

    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "role_id"),
    )

    # ------------------------------------------------------------------
    # 2. Seed roles
    # ------------------------------------------------------------------
    op.execute("INSERT INTO roles (name) VALUES ('admin'), ('viewer')")

    # ------------------------------------------------------------------
    # 3. Seed permissions
    # ------------------------------------------------------------------
    for perm in ALL_PERMISSIONS:
        op.execute(sa.text("INSERT INTO permissions (name) VALUES (:name)").bindparams(name=perm))

    # ------------------------------------------------------------------
    # 4. Seed role_permissions
    # ------------------------------------------------------------------
    for perm in VIEWER_PERMISSIONS:
        op.execute(
            sa.text("""
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id FROM roles r, permissions p
                WHERE r.name = 'viewer' AND p.name = :perm
            """).bindparams(perm=perm)
        )

    for perm in ADMIN_PERMISSIONS:
        op.execute(
            sa.text("""
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id FROM roles r, permissions p
                WHERE r.name = 'admin' AND p.name = :perm
            """).bindparams(perm=perm)
        )

    # ------------------------------------------------------------------
    # 5. Migrate existing users.role → user_roles
    # ------------------------------------------------------------------
    op.execute("""
        INSERT INTO user_roles (user_id, role_id)
        SELECT u.id, r.id
        FROM users u
        JOIN roles r ON r.name = u.role::text
    """)

    # ------------------------------------------------------------------
    # 6. Drop old role column and enum
    # ------------------------------------------------------------------
    op.drop_column("users", "role")
    op.execute("DROP TYPE user_role_enum")


def downgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Re-create the enum type and role column
    # ------------------------------------------------------------------
    op.execute("CREATE TYPE user_role_enum AS ENUM ('admin', 'viewer')")
    op.add_column(
        "users",
        sa.Column(
            "role",
            sa.Enum("admin", "viewer", name="user_role_enum"),
            nullable=True,
        ),
    )

    # ------------------------------------------------------------------
    # 2. Populate role from user_roles — admin wins if user has it
    # ------------------------------------------------------------------
    op.execute("""
        UPDATE users u
        SET role = CASE
            WHEN EXISTS (
                SELECT 1 FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = u.id AND r.name = 'admin'
            ) THEN 'admin'::user_role_enum
            ELSE 'viewer'::user_role_enum
        END
    """)

    op.alter_column("users", "role", nullable=False, server_default="admin")

    # ------------------------------------------------------------------
    # 3. Drop RBAC tables (order matters for FK constraints)
    # ------------------------------------------------------------------
    op.drop_table("user_roles")
    op.drop_table("role_permissions")
    op.drop_table("permissions")
    op.drop_table("roles")
