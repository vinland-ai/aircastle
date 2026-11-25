from fastapi import FastAPI

from aircastle_api.health import health_router
from aircastle_api.settings import Settings


def create_app(settings: Settings) -> FastAPI:
    """Build the API from validated settings. Tests and production share this."""
    app = FastAPI(title="Aircastle API")
    app.include_router(health_router(settings))
    return app
