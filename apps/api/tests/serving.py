"""Serve an app in-process, the way every test calls the API."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


@asynccontextmanager
async def serve(app: FastAPI) -> AsyncGenerator[AsyncClient]:
    """Run the app's lifespan and call it in-process.

    An unhandled exception reaches the client as the app's 500 response.
    """
    async with (
        LifespanManager(app) as manager,
        AsyncClient(
            transport=ASGITransport(app=manager.app, raise_app_exceptions=False),
            base_url="http://test",
        ) as client,
    ):
        yield client
