import asyncio
import socket
from collections.abc import AsyncGenerator, Generator
from contextlib import asynccontextmanager

import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import make_url
from sqlalchemy.ext.asyncio import AsyncSession
from testcontainers.community.postgres import PostgresContainer

from aircastle_api.app import create_app
from aircastle_api.database import create_engine, database_session
from aircastle_api.settings import load_settings

POSTGRES_IMAGE = "postgres:18-alpine"
VALID_ENVIRONMENT = {
    "ENVIRONMENT": "test",
    "DATABASE_URL": "postgresql://aircastle:hunter2@localhost:5432/aircastle",
}


@pytest.fixture(scope="session")
def database_url() -> Generator[str]:
    """Start a disposable Postgres for the test session."""
    with PostgresContainer(POSTGRES_IMAGE, driver=None) as postgres:
        yield postgres.get_connection_url()


@pytest.fixture
def environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path_factory: pytest.TempPathFactory
) -> pytest.MonkeyPatch:
    """Start from a valid environment, isolated from the shell and any `.env` file."""
    monkeypatch.chdir(tmp_path_factory.mktemp("cwd"))
    for name in ("ENVIRONMENT", "DATABASE_URL", "DATABASE_POOL_SIZE"):
        monkeypatch.delenv(name, raising=False)
    for name, value in VALID_ENVIRONMENT.items():
        monkeypatch.setenv(name, value)
    return monkeypatch


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


@asynccontextmanager
async def serve(app: FastAPI) -> AsyncGenerator[AsyncClient]:
    """Run the app's lifespan and call it in-process."""
    async with (
        LifespanManager(app) as manager,
        AsyncClient(
            transport=ASGITransport(app=manager.app), base_url="http://test"
        ) as client,
    ):
        yield client


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
