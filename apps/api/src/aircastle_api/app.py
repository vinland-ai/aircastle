from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from aircastle_api.auth import add_auth
from aircastle_api.errors import (
    PROBLEM_JSON,
    Problem,
    ValidationProblem,
    add_problem_handlers,
)
from aircastle_api.health import health_router
from aircastle_api.settings import Settings
from aircastle_api.v1 import v1_router

_PROBLEM_RESPONSES: dict[int | str, dict[str, Any]] = {
    "422": {"model": ValidationProblem, "description": "Validation problem"},
    "default": {"model": Problem, "description": "Problem"},
}


class _AircastleAPI(FastAPI):
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
    app = _AircastleAPI(
        title="Aircastle API",
        redoc_url=None,
        responses=_PROBLEM_RESPONSES,
    )
    add_problem_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Retry-After", "X-Request-ID"],
    )
    add_auth(app, settings)
    app.include_router(health_router(settings))
    app.include_router(v1_router())
    return app
