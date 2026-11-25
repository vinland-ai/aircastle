"""Logfire tracing, console logs and request IDs."""

import re
import sys
from io import StringIO
from uuid import uuid7

import logfire
from fastapi import FastAPI
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.instrumentation.urllib import URLLibInstrumentor
from sqlalchemy.ext.asyncio import AsyncEngine
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from aircastle_api.settings import Settings

REQUEST_ID_HEADER = "X-Request-ID"
SAFE_REQUEST_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}")
_LINE_BREAK = re.compile(r"\n(?=.)")


class _RequestIdConsole(StringIO):
    """Standard output that starts each line with the request ID of its writer.

    The ID comes from the current request's baggage, so lines written outside
    a request have no prefix. Nothing is kept in the string buffer.
    """

    def __init__(self) -> None:
        super().__init__()
        self._at_line_start = True

    def isatty(self) -> bool:
        return sys.stdout.isatty()

    def flush(self) -> None:
        sys.stdout.flush()

    def write(self, s: str, /) -> int:
        text = s
        if s and (request_id := logfire.get_baggage().get("request_id")):
            prefix = f"[{request_id}] "
            text = _LINE_BREAK.sub(f"\n{prefix}", s)
            if self._at_line_start:
                text = f"{prefix}{text}"
        if s:
            self._at_line_start = s.endswith("\n")
        sys.stdout.write(text)
        return len(s)


class RequestIds:
    """An ASGI layer that tags each HTTP request with an ID.

    The response carries the ID in `X-Request-ID`, and every span and log of the
    request carries it as the `request_id` attribute.
    """

    def __init__(self, app: ASGIApp) -> None:
        """Tag the requests that `app` serves."""
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Serve the request with its ID attached to the response and its logs."""
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        incoming = Headers(scope=scope).get(REQUEST_ID_HEADER, "")
        request_id = incoming if SAFE_REQUEST_ID.fullmatch(incoming) else str(uuid7())

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message).append(REQUEST_ID_HEADER, request_id)
            await send(message)

        with logfire.set_baggage(request_id=request_id):
            await self._app(scope, receive, send_with_id)


def observe(app: FastAPI, settings: Settings) -> None:
    """Trace each request and its outgoing HTTP calls, and log them to the console.

    Traces reach Logfire only when a token is set. Incoming trace context is
    ignored, so callers can't join or tag our traces.
    """
    token = settings.logfire_token
    logfire.configure(
        service_name="aircastle-api",
        environment=settings.environment,
        token=token.get_secret_value() if token else None,
        send_to_logfire="if-token-present",
        console=logfire.ConsoleOptions(
            min_log_level=settings.log_level, output=_RequestIdConsole()
        ),
        min_level=settings.log_level,
        distributed_tracing=False,
    )
    logfire.instrument_fastapi(app)
    URLLibInstrumentor().instrument()


def instrument_database(engine: AsyncEngine) -> None:
    """Trace each query `engine` runs, with its timing, inside the current request.

    The instrumentation traces one engine per process, so this moves it from any
    earlier engine to `engine`. It declares support only below SQLAlchemy 2.1, yet
    works on 2.1, as the tests show against Postgres, so its version check is off.
    """
    instrumentor = SQLAlchemyInstrumentor()
    if instrumentor.is_instrumented_by_opentelemetry:
        instrumentor.uninstrument()
    logfire.instrument_sqlalchemy(engine=engine, skip_dep_check=True)
