"""Add target_user_id, ip_address, request_id to audit_logs.

Adds columns needed before backfilling audit calls into saved_reports, report
runs, auth flows, and email-template edits — so new callers can populate the
fields from day one rather than being retrofitted later.

- target_user_id: actor vs. target distinction (e.g. admin overriding another
  user's preferences). Nullable because most actions affect the actor only.
- ip_address: VARCHAR(45) fits both IPv4 and IPv6 textual forms.
- request_id: nullable; reserved for when we add a request-id middleware.

Revision ID: a4b5c6d7e8f9
Revises: 4d5e6f7a8b9c
Create Date: 2026-05-01 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a4b5c6d7e8f9"
down_revision: Union[str, None] = "4d5e6f7a8b9c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "audit_logs",
        sa.Column("target_user_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "audit_logs",
        sa.Column("ip_address", sa.String(length=45), nullable=True),
    )
    op.add_column(
        "audit_logs",
        sa.Column("request_id", sa.String(length=64), nullable=True),
    )
    op.create_foreign_key(
        "fk_audit_logs_target_user_id_users",
        "audit_logs",
        "users",
        ["target_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_audit_logs_target_user_id",
        "audit_logs",
        ["target_user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_logs_target_user_id", table_name="audit_logs")
    op.drop_constraint("fk_audit_logs_target_user_id_users", "audit_logs", type_="foreignkey")
    op.drop_column("audit_logs", "request_id")
    op.drop_column("audit_logs", "ip_address")
    op.drop_column("audit_logs", "target_user_id")
