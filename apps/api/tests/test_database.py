import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.parametrize("run", ["first", "second"])
async def test_writes_never_outlive_their_test(session: AsyncSession, run: str) -> None:
    await session.execute(text("create table scratch (run text)"))
    await session.execute(text("insert into scratch values (:run)"), {"run": run})
    await session.commit()

    rows = await session.execute(text("select run from scratch"))

    assert rows.scalars().all() == [run]
