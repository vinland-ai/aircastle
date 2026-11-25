from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from aircastle_api.settings import Environment, Settings


class Health(BaseModel):
    """Liveness of the process, with the environment it runs in."""

    status: Literal["ok"]
    environment: Environment


def health_router(settings: Settings) -> APIRouter:
    """Build the liveness route. It answers without touching any dependency."""

    async def health() -> Health:
        return Health(status="ok", environment=settings.environment)

    router = APIRouter(tags=["health"])
    router.add_api_route("/health", health, methods=["GET"])
    return router
