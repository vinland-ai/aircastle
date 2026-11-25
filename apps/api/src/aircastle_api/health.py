from http import HTTPStatus
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from aircastle_api.database import Database, current_database
from aircastle_api.errors import Problem, problem_response
from aircastle_api.settings import Environment, Settings


class Health(BaseModel):
    """Liveness of the process, with the environment it runs in."""

    status: Literal["ok"]
    environment: Environment


class Readiness(BaseModel):
    """The instance can serve traffic: Postgres answers."""

    status: Literal["ready"]


def health_router(settings: Settings) -> APIRouter:
    """Build the liveness and readiness routes."""

    async def health() -> Health:
        return Health(status="ok", environment=settings.environment)

    async def ready(
        request: Request, database: Annotated[Database, Depends(current_database)]
    ) -> Readiness | JSONResponse:
        if await database.is_reachable():
            return Readiness(status="ready")
        return problem_response(
            request, HTTPStatus.SERVICE_UNAVAILABLE, "The database is not answering."
        )

    router = APIRouter(tags=["health"])
    router.add_api_route("/health", health, methods=["GET"])
    router.add_api_route(
        "/ready",
        ready,
        methods=["GET"],
        response_model=Readiness,
        responses={
            503: {"model": Problem, "description": "Postgres is not answering."}
        },
    )
    return router
