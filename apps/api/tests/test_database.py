import asyncio
from collections.abc import Callable

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session


@pytest.mark.parametrize("run", ["first", "second"])
async def test_writes_never_outlive_their_test(session: AsyncSession, run: str) -> None:
    await session.execute(text("create table scratch (run text)"))
    await session.execute(text("insert into scratch values (:run)"), {"run": run})
    await session.commit()

    rows = await session.execute(text("select run from scratch"))

    assert rows.scalars().all() == [run]


def table_names(session: Session) -> set[str]:
    return set(inspect(session.connection()).get_table_names())


async def test_migrations_downgrade_and_upgrade_with_no_domain_tables(
    migrate: Callable[..., str], session: AsyncSession
) -> None:
    await asyncio.to_thread(migrate, "downgrade", "base")
    at_base = await asyncio.to_thread(migrate, "current")
    await asyncio.to_thread(migrate, "upgrade", "head")
    at_head = await asyncio.to_thread(migrate, "current")

    assert at_base.strip() == ""
    assert at_head.strip().endswith("(head)")
    assert await session.run_sync(table_names) == {"alembic_version"}
