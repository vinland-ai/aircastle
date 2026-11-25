import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import make_url, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from aircastle_api.observability import instrument_database
from aircastle_api.settings import Settings
from aircastle_api.state import app_state

PING_TIMEOUT_SECONDS = 2


class Base(DeclarativeBase):
    """The declarative base. Its metadata is what Alembic migrates."""


def create_engine(settings: Settings) -> AsyncEngine:
    """Build an asyncpg engine for the configured database. It connects lazily."""
    url = make_url(settings.database_url.get_secret_value().encoded_string())
    return create_async_engine(
        url.set(drivername="postgresql+asyncpg"),
        pool_size=settings.database_pool_size,
    )


class Database:
    """The connection pool of one running app, and the sessions it hands out."""

    def __init__(self, engine: AsyncEngine) -> None:
        """Serve sessions and pings from the given engine."""
        self._engine = engine
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def is_reachable(self) -> bool:
        """Report whether Postgres runs a trivial query within the ping timeout."""
        try:
            async with (
                asyncio.timeout(PING_TIMEOUT_SECONDS),
                self._engine.connect() as connection,
            ):
                await connection.execute(text("select 1"))
        except OSError, SQLAlchemyError:
            return False
        return True


@asynccontextmanager
async def open_database(settings: Settings) -> AsyncGenerator[Database]:
    """Open the connection pool, and dispose of it on exit."""
    engine = create_engine(settings)
    instrument_database(engine)
    try:
        yield Database(engine)
    finally:
        await engine.dispose()


def current_database(request: Request) -> Database:
    """The database the app opened at startup."""
    return app_state(request)["database"]


async def database_session(
    database: Annotated[Database, Depends(current_database)],
) -> AsyncGenerator[AsyncSession]:
    """A session for one request, closed when the request ends."""
    async with database.sessions() as session:
        yield session


Session = Annotated[AsyncSession, Depends(database_session)]
