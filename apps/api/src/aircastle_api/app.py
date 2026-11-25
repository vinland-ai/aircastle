from fastapi import FastAPI

from aircastle_api.auth import add_auth
from aircastle_api.errors import add_problem_handlers
from aircastle_api.health import health_router
from aircastle_api.settings import Settings
from aircastle_api.v1 import v1_router


def create_app(settings: Settings) -> FastAPI:
    """Build the API from validated settings. Tests and production share this."""
    app = FastAPI(title="Aircastle API")
    add_problem_handlers(app)
    add_auth(app, settings)
    app.include_router(health_router(settings))
    app.include_router(v1_router())
    return app
