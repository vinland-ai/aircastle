from collections.abc import AsyncGenerator, Collection
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from starlette.types import Receive, Scope, Send

from aircastle_api.auth import add_auth
from aircastle_api.database import Database, open_database
from aircastle_api.errors import (
    PROBLEM_JSON,
    Problem,
    ValidationProblem,
    add_problem_handlers,
)
from aircastle_api.health import health_router
from aircastle_api.observability import RequestIdApp, observe
from aircastle_api.settings import Settings
from aircastle_api.v1 import v1_router

_PROBLEM_RESPONSES: dict[int | str, dict[str, Any]] = {
    "422": {"model": ValidationProblem, "description": "Validation problem"},
    "default": {"model": Problem, "description": "Problem"},
}


def _handler_name(route: APIRoute) -> str:
    return route.name


class _AircastleAPI(RequestIdApp):
    """The API app, with CORS outside every other layer.

    Starlette answers an unhandled exception from outside all added middleware,
    so CORS wraps the whole app here. Browsers can then read even a 500 problem.
    """

    def __init__(self, *, cors_origins: Collection[str], **options: Any) -> None:
        super().__init__(**options)
        self._cors = CORSMiddleware(
            super().__call__,
            allow_origins=sorted(cors_origins),
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["Retry-After", "X-Request-ID"],
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await self._cors(scope, receive, send)

    def openapi(self) -> dict[str, Any]:
        if self.openapi_schema is None:
            for path in super().openapi()["paths"].values():
                for operation in path.values():
                    responses = operation["responses"]
                    if not {"parameters", "requestBody"} & operation.keys():
                        del responses["422"]
                    for status in _PROBLEM_RESPONSES.keys() & responses.keys():
                        content = responses[status]["content"]
                        content[PROBLEM_JSON] = content.pop("application/json")
        return super().openapi()


def create_app(settings: Settings) -> FastAPI:
    """Build the API from validated settings. Tests and production share this."""

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[dict[str, Database]]:
        async with open_database(settings) as database:
            yield {"database": database}

    app = _AircastleAPI(
        cors_origins=settings.cors_origins,
        title="Aircastle API",
        lifespan=lifespan,
        redoc_url=None,
        responses=_PROBLEM_RESPONSES,
        generate_unique_id_function=_handler_name,
    )
    observe(app, settings)
    add_problem_handlers(app)
    add_auth(app, settings)
    app.include_router(health_router(settings))
    app.include_router(v1_router())
    return app
