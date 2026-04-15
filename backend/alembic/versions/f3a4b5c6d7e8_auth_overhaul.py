"""Auth overhaul: email identifier, user_status enum, nullable password, user_tokens table

Revision ID: f3a4b5c6d7e8
Revises: e7f8a9b0c1d2
Create Date: 2026-04-13 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, None] = "e7f8a9b0c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Create new PostgreSQL enum types
    # ------------------------------------------------------------------
    op.execute("CREATE TYPE user_status_enum AS ENUM ('inactive', 'active', 'deleted')")
    op.execute("CREATE TYPE token_type_enum AS ENUM ('registration', 'password_reset')")

    # ------------------------------------------------------------------
    # 2. Rename username -> email and widen the column to 255 chars
    # ------------------------------------------------------------------
    op.alter_column(
        "users",
        "username",
        new_column_name="email",
        existing_type=sa.String(100),
        type_=sa.String(255),
        existing_nullable=False,
    )

    # ------------------------------------------------------------------
    # 3. Make hashed_password nullable (inactive accounts have no password yet)
    # ------------------------------------------------------------------
    op.alter_column("users", "hashed_password", nullable=True)

    # ------------------------------------------------------------------
    # 4. Add user_status column, seed existing rows as 'active', then make NOT NULL
    # ------------------------------------------------------------------
    op.add_column(
        "users",
        sa.Column(
            "user_status",
            postgresql.ENUM(name="user_status_enum", create_type=False),
            nullable=True,
        ),
    )
    op.execute("UPDATE users SET user_status = 'active'")
    op.alter_column("users", "user_status", nullable=False)

    # ------------------------------------------------------------------
    # 5. Drop the old is_active boolean column
    # ------------------------------------------------------------------
    op.drop_column("users", "is_active")

    # ------------------------------------------------------------------
    # 6. Create user_tokens table
    # ------------------------------------------------------------------
    op.create_table(
        "user_tokens",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "token_type",
            postgresql.ENUM(name="token_type_enum", create_type=False),
            nullable=False,
        ),
        sa.Column("password_token", sa.String(64), nullable=False),
        sa.Column("password_token_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "token_type"),
    )


def downgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Drop user_tokens table
    # ------------------------------------------------------------------
    op.drop_table("user_tokens")

    # ------------------------------------------------------------------
    # 2. Restore is_active boolean (map active -> True, everything else -> False)
    # ------------------------------------------------------------------
    op.add_column(
        "users",
        sa.Column("is_active", sa.Boolean(), nullable=True),
    )
    op.execute("UPDATE users SET is_active = (user_status = 'active')")
    op.alter_column("users", "is_active", nullable=False, server_default="false")

    # ------------------------------------------------------------------
    # 3. Drop user_status column
    # ------------------------------------------------------------------
    op.drop_column("users", "user_status")

    # ------------------------------------------------------------------
    # 4. Make hashed_password NOT NULL again (fill NULLs with a placeholder first)
    # ------------------------------------------------------------------
    op.execute("UPDATE users SET hashed_password = 'INVALIDATED' WHERE hashed_password IS NULL")
    op.alter_column("users", "hashed_password", nullable=False)

    # ------------------------------------------------------------------
    # 5. Rename email -> username and narrow back to 100 chars
    # ------------------------------------------------------------------
    op.alter_column(
        "users",
        "email",
        new_column_name="username",
        existing_type=sa.String(255),
        type_=sa.String(100),
        existing_nullable=False,
    )

    # ------------------------------------------------------------------
    # 6. Drop enum types
    # ------------------------------------------------------------------
    op.execute("DROP TYPE token_type_enum")
    op.execute("DROP TYPE user_status_enum")
