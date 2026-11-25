from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from aircastle_api.database import Database, open_database
from aircastle_api.health import health_router
from aircastle_api.settings import Settings


def create_app(settings: Settings) -> FastAPI:
    """Build the API from validated settings. Tests and production share this."""

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[dict[str, Database]]:
        async with open_database(settings) as database:
            yield {"database": database}

    app = FastAPI(title="Aircastle API", lifespan=lifespan)
    app.include_router(health_router(settings))
    return app
