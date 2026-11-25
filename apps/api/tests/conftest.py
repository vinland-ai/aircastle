import asyncio
import os
import socket
import subprocess
import sys
from collections.abc import AsyncGenerator, Callable, Generator
from functools import partial
from pathlib import Path

import pytest
from httpx import AsyncClient
from serving import serve
from sqlalchemy import make_url
from sqlalchemy.ext.asyncio import AsyncSession
from testcontainers.community.postgres import PostgresContainer

from aircastle_api.app import create_app
from aircastle_api.database import create_engine, database_session
from aircastle_api.settings import load_settings, placeholder_environment

API_ROOT = Path(__file__).parents[1]
POSTGRES_IMAGE = "postgres:18-alpine"


def alembic(database_url: str, *arguments: str) -> str:
    """Run the Alembic CLI from the API root against the given database."""
    with placeholder_environment():
        return subprocess.run(
            [sys.executable, "-m", "alembic", *arguments],
            cwd=API_ROOT,
            env={**os.environ, "DATABASE_URL": database_url},
            check=True,
            stdout=subprocess.PIPE,
            text=True,
        ).stdout


@pytest.fixture(scope="session")
def database_url() -> Generator[str]:
    """Start a disposable Postgres for the test session, migrated to head."""
    with PostgresContainer(POSTGRES_IMAGE, driver=None) as postgres:
        url = postgres.get_connection_url()
        alembic(url, "upgrade", "head")
        yield url


@pytest.fixture
def migrate(database_url: str) -> Callable[..., str]:
    """Run the Alembic CLI against the test database."""
    return partial(alembic, database_url)


@pytest.fixture
def environment() -> Generator[pytest.MonkeyPatch]:
    """Start from a valid environment, isolated from the shell and any `.env` file."""
    with placeholder_environment(), pytest.MonkeyPatch.context() as monkeypatch:
        yield monkeypatch


@pytest.fixture
async def session(
    environment: pytest.MonkeyPatch, database_url: str
) -> AsyncGenerator[AsyncSession]:
    """A session on the test database whose writes roll back when the test ends."""
    environment.setenv("DATABASE_URL", database_url)
    engine = create_engine(load_settings())
    async with engine.connect() as connection:
        transaction = await connection.begin()
        async with AsyncSession(
            connection, join_transaction_mode="create_savepoint"
        ) as session:
            yield session
        await transaction.rollback()
    await engine.dispose()


@pytest.fixture
async def client(session: AsyncSession) -> AsyncGenerator[AsyncClient]:
    """The app on the test database, with request sessions in the test's transaction."""
    app = create_app(load_settings())
    app.dependency_overrides[database_session] = lambda: session
    async with serve(app) as client:
        yield client


def closed_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
    return port


async def drain(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await reader.read()
    writer.close()


@pytest.fixture(params=["refused", "silent", "rejected"])
async def unready_client(
    request: pytest.FixtureRequest,
    environment: pytest.MonkeyPatch,
    database_url: str,
) -> AsyncGenerator[AsyncClient]:
    """The app pointed at a Postgres that refuses, never answers, or denies login."""
    server = await asyncio.start_server(drain, "127.0.0.1", 0)
    silent_port: int = server.sockets[0].getsockname()[1]
    urls = {
        "refused": f"postgresql://aircastle:hunter2@127.0.0.1:{closed_port()}/app",
        "silent": f"postgresql://aircastle:hunter2@127.0.0.1:{silent_port}/app",
        "rejected": make_url(database_url)
        .set(password="wrong")
        .render_as_string(hide_password=False),
    }
    environment.setenv("DATABASE_URL", urls[request.param])
    async with serve(create_app(load_settings())) as client:
        yield client
    server.close_clients()
    server.close()
    await server.wait_closed()
