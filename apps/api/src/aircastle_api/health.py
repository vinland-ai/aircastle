from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from aircastle_api.database import Database, current_database
from aircastle_api.settings import Environment, Settings


class Health(BaseModel):
    """Liveness of the process, with the environment it runs in."""

    status: Literal["ok"]
    environment: Environment


class Readiness(BaseModel):
    """The instance can serve traffic: Postgres answers."""

    status: Literal["ready"]


def not_ready(request: Request) -> JSONResponse:
    """An RFC 9457 problem saying the database is not answering."""
    return JSONResponse(
        {
            "type": "about:blank",
            "title": "Service Unavailable",
            "status": 503,
            "detail": "The database is not answering.",
            "instance": request.url.path,
        },
        status_code=503,
        media_type="application/problem+json",
    )


def health_router(settings: Settings) -> APIRouter:
    """Build the liveness and readiness routes."""

    async def health() -> Health:
        return Health(status="ok", environment=settings.environment)

    async def ready(
        request: Request, database: Annotated[Database, Depends(current_database)]
    ) -> Readiness | JSONResponse:
        if await database.answers():
            return Readiness(status="ready")
        return not_ready(request)

    router = APIRouter(tags=["health"])
    router.add_api_route("/health", health, methods=["GET"])
    router.add_api_route(
        "/ready",
        ready,
        methods=["GET"],
        response_model=Readiness,
        responses={503: {"description": "Postgres is not answering."}},
    )
    return router
