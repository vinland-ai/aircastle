from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from aircastle_api.app import create_app
from aircastle_api.settings import load_settings

VALID_ENVIRONMENT = {
    "ENVIRONMENT": "test",
    "DATABASE_URL": "postgresql://aircastle:hunter2@localhost:5432/aircastle",
}


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
async def client(environment: pytest.MonkeyPatch) -> AsyncIterator[AsyncClient]:
    app = create_app(load_settings())
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client
