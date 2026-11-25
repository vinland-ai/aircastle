from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from starlette.types import ASGIApp, Receive, Scope, Send

from aircastle_api.auth import add_auth
from aircastle_api.database import Database, open_database
from aircastle_api.errors import (
    PROBLEM_RESPONSES,
    add_problem_handlers,
    document_problems,
)
from aircastle_api.health import health_router
from aircastle_api.observability import RequestIds, observe
from aircastle_api.rate_limit import add_rate_limit
from aircastle_api.settings import Settings
from aircastle_api.v1 import v1_router


def _handler_name(route: APIRoute) -> str:
    return route.name


def _with_outer_layers(app: ASGIApp, settings: Settings) -> ASGIApp:
    """Wrap `app` in request IDs, then CORS.

    The layers sit outside Starlette's error handling, so a 500 carries their
    headers too.
    """
    return CORSMiddleware(
        RequestIds(app),
        allow_origins=sorted(settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Retry-After", "X-Request-ID"],
    )


class _AircastleAPI(FastAPI):
    """The API app, served through its outer layers."""

    def __init__(self, settings: Settings, **options: Any) -> None:
        super().__init__(**options)
        self._served = _with_outer_layers(super().__call__, settings)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await self._served(scope, receive, send)


def create_app(settings: Settings) -> FastAPI:
    """Build the API from validated settings. Tests and production share this."""

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[dict[str, Database]]:
        async with open_database(settings) as database:
            yield {"database": database}

    app = _AircastleAPI(
        settings,
        title="Aircastle API",
        lifespan=lifespan,
        redoc_url=None,
        responses=PROBLEM_RESPONSES,
        generate_unique_id_function=_handler_name,
    )
    observe(app, settings)
    add_problem_handlers(app)
    document_problems(app)
    add_auth(app, settings)
    add_rate_limit(app, settings)
    app.include_router(health_router(settings))
    app.include_router(v1_router())
    return app
