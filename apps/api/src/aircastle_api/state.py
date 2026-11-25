"""The services a running app opens once and shares with every request."""

from typing import TYPE_CHECKING, TypedDict, cast

from fastapi import Request

if TYPE_CHECKING:
    from aircastle_api.auth import ClerkSessions
    from aircastle_api.database import Database
    from aircastle_api.rate_limit import RateLimiter


class AppState(TypedDict):
    """What the app's lifespan yields, and each request reads back."""

    database: Database
    clerk_sessions: ClerkSessions
    rate_limiter: RateLimiter


def app_state(request: Request) -> AppState:
    """The state of the app that serves `request`.

    FastAPI injects only a plain `Request`, so this reads it as Starlette's
    typed `Request[AppState]`.
    """
    return cast("Request[AppState]", request).state
