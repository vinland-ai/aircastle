from fastapi import FastAPI

from aircastle_api.errors import add_problem_handlers
from aircastle_api.health import health_router
from aircastle_api.observability import RequestIdApp, observe
from aircastle_api.settings import Settings


def create_app(settings: Settings) -> FastAPI:
    """Build the API from validated settings. Tests and production share this."""
    app = RequestIdApp(title="Aircastle API")
    observe(app, settings)
    add_problem_handlers(app)
    app.include_router(health_router(settings))
    return app
