"""Baseline with no tables

Revision ID: e53ebc66c8db
Revises:
Create Date: 2026-11-26 03:50:39.299533
"""

from collections.abc import Sequence

revision: str = "e53ebc66c8db"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""


def downgrade() -> None:
    """Downgrade schema."""
