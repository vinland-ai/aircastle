"""Rate limiting for the versioned API, keyed by signed-in user or client IP."""

import math
import time
from http import HTTPStatus

from fastapi import FastAPI, Request
from limits.aio.storage import MemoryStorage, RedisStorage, Storage
from limits.aio.strategies import MovingWindowRateLimiter

from aircastle_api.auth import Authentication, User
from aircastle_api.errors import DomainError
from aircastle_api.settings import Settings


class RateLimitedError(DomainError):
    """The caller has used up its requests for the current window."""

    status = HTTPStatus.TOO_MANY_REQUESTS


def _storage(settings: Settings) -> Storage:
    if settings.rate_limit_redis_url is None:
        return MemoryStorage()
    return RedisStorage(f"async+{settings.rate_limit_redis_url.get_secret_value()}")


class RateLimiter:
    """Counts each caller's requests against the configured limit."""

    def __init__(self, settings: Settings) -> None:
        """Enforce the limit in `settings`."""
        self._limit = settings.rate_limit
        self._client_ip_header = settings.client_ip_header
        self._windows = MovingWindowRateLimiter(_storage(settings))

    async def hit(self, request: Request, user: User | None) -> None:
        """Count one request, or raise `RateLimitedError` if the caller is over."""
        key = f"user:{user.id}" if user else f"ip:{self._client_ip(request)}"
        if await self._windows.hit(self._limit, key):
            return
        window = await self._windows.get_window_stats(self._limit, key)
        retry_after = max(1, math.ceil(window.reset_time - time.time()))
        raise RateLimitedError(
            f"Too many requests. Retry in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )

    def _client_ip(self, request: Request) -> str:
        if self._client_ip_header and (
            forwarded := request.headers.get(self._client_ip_header)
        ):
            return forwarded
        return request.client.host if request.client else "unknown"


def add_rate_limit(app: FastAPI, settings: Settings) -> None:
    """Let the app limit request rates, for the `rate_limit` dependency."""
    app.state.rate_limiter = RateLimiter(settings)


async def rate_limit(request: Request, authentication: Authentication) -> None:
    """Count the request against its caller's limit. Over the limit is a 429.

    A request with an invalid token counts against its client IP.
    """
    limiter: RateLimiter = request.app.state.rate_limiter
    user = authentication if isinstance(authentication, User) else None
    await limiter.hit(request, user)
