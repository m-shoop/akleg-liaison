"""Invert allowed_roles semantics + strip 'admin' from existing rows.

The original ``allowed_roles`` model treated an empty array as "ungated, visible
to everyone".  That made admins appear in the picker as a useful option (lock
to admins) and led to admins locking themselves out of their own reports.

The new model is purely additive: admins always see every system report by
bypass (see ``saved_report_repository.ADMIN_ROLE``), and the array is the set
of *non-admin* roles allowed to view the row.  An empty array therefore means
admin-only — there is no implicit "everyone".  ``admin`` is now rejected as an
input value and excluded from the picker.

Two data fixes are needed when upgrading existing rows:

1. Rows that today have ``allowed_roles=[]`` were created under the old
   "empty = everyone" intent (the four starter seeds from ``8c9d0e1f2a3b``,
   plus any user-created reports).  Backfill them with ``['viewer']`` so they
   stay visible to viewers under the new semantics.

2. Rows that contain ``admin`` (the two admin-only seeds from
   ``17bdec1233ad``: 'All Open Assignments', 'Needs Assignment') need ``admin``
   stripped.  After step 1 these rows still hold ``['admin']``; stripping
   leaves them as ``[]``, which under the new semantics is admin-only — i.e.
   their original intent is preserved.

Order matters: step 1 must run before step 2.  Otherwise an
``allowed_roles=['admin']`` row would be stripped to ``[]`` and then
backfilled to ``['viewer']``, flipping its meaning.

Revision ID: 4d5e6f7a8b9c
Revises: 3c4d5e6f7a8b
Create Date: 2026-04-30 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "4d5e6f7a8b9c"
down_revision: Union[str, None] = "3c4d5e6f7a8b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Preserve "visible to everyone" intent on legacy empty-array rows.
    op.execute(sa.text("""
        UPDATE saved_reports
        SET allowed_roles = ARRAY['viewer']
        WHERE publication_level = 'system'
          AND cardinality(allowed_roles) = 0
    """))

    # 2. Strip 'admin' from any remaining rows.  Admin-only rows that started
    # as ['admin'] (and were skipped by step 1) become [] — admin-only under
    # the new semantics, matching their original intent.
    op.execute(sa.text("""
        UPDATE saved_reports
        SET allowed_roles = array_remove(allowed_roles, 'admin')
        WHERE 'admin' = ANY(allowed_roles)
    """))


def downgrade() -> None:
    # Not reversible: we don't know which rows had 'admin' in them before, and
    # the new visibility model treats admin as a bypass rather than an array
    # entry, so reintroducing 'admin' would be meaningless.  The viewer
    # backfill from step 1 also can't be cleanly undone (we'd need to know
    # which rows were originally empty vs. originally ['viewer']).
    pass
