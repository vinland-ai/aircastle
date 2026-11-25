"""Logfire tracing, console logs and request IDs."""

import re
from uuid import uuid7

import logfire
from fastapi import FastAPI
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from sqlalchemy.ext.asyncio import AsyncEngine
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import Message, Receive, Scope, Send

from aircastle_api.settings import Settings

REQUEST_ID_HEADER = "X-Request-ID"
SAFE_REQUEST_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}")


class RequestIdApp(FastAPI):
    """A FastAPI app that tags each HTTP request with an ID before any other layer.

    The tag sits outside Starlette's error middleware, so even the response to an
    unhandled exception carries the ID in `X-Request-ID`. Every span and log the
    request produces carries it as the `request_id` attribute.
    """

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Serve the request with its ID attached to the response and its logs."""
        if scope["type"] != "http":
            await super().__call__(scope, receive, send)
            return

        incoming = Headers(scope=scope).get(REQUEST_ID_HEADER, "")
        request_id = incoming if SAFE_REQUEST_ID.fullmatch(incoming) else str(uuid7())

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message).append(REQUEST_ID_HEADER, request_id)
            await send(message)

        with logfire.set_baggage(request_id=request_id):
            await super().__call__(scope, receive, send_with_id)


def observe(app: FastAPI, settings: Settings) -> None:
    """Trace each request and outgoing httpx call, and log them to the console.

    Traces reach Logfire only when a token is set. Incoming trace context is
    ignored, so callers can't join or tag our traces.
    """
    token = settings.logfire_token
    logfire.configure(
        service_name="aircastle-api",
        environment=settings.environment,
        token=token.get_secret_value() if token else None,
        send_to_logfire="if-token-present",
        console=logfire.ConsoleOptions(min_log_level=settings.log_level),
        min_level=settings.log_level,
        distributed_tracing=False,
    )
    logfire.instrument_fastapi(app)
    HTTPXClientInstrumentor().instrument()


def instrument_database(engine: AsyncEngine) -> None:
    """Trace each query `engine` runs, with its timing, inside the current request."""
    logfire.instrument_sqlalchemy(engine=engine)
