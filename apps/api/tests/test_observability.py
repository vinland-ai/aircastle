from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from typing import Protocol, runtime_checkable

import jwt
import logfire
import pytest
from httpx import ASGITransport, AsyncClient
from opentelemetry import trace
from opentelemetry.sdk.trace import ReadableSpan, SpanProcessor
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import SpanKind
from pytest_httpserver import HTTPServer

from aircastle_api.app import create_app
from aircastle_api.settings import load_settings


async def buy_widget() -> dict[str, str]:
    logfire.info("Bought a {widget}", widget="sprocket")
    return {"widget": "sprocket"}


async def break_widget() -> None:
    logfire.warning("The {widget} is about to break", widget="sprocket")
    message = "the widget broke"
    raise RuntimeError(message)


@runtime_checkable
class TracerProviderWithProcessors(Protocol):
    def add_span_processor(self, span_processor: SpanProcessor) -> None: ...


@asynccontextmanager
async def app_client() -> AsyncGenerator[AsyncClient]:
    """The real app built from the current environment, plus test-only routes."""
    app = create_app(load_settings())
    app.add_api_route("/test/widgets/buy", buy_widget, methods=["POST"])
    app.add_api_route("/test/widgets/break", break_widget, methods=["POST"])
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield client


@pytest.fixture
async def client(environment: pytest.MonkeyPatch) -> AsyncIterator[AsyncClient]:
    async with app_client() as client:
        yield client


def capture_spans() -> InMemorySpanExporter:
    """Every span and log the app exports, as a Logfire backend would receive them."""
    provider = trace.get_tracer_provider()
    assert isinstance(provider, TracerProviderWithProcessors)
    exporter = InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return exporter


@pytest.fixture
def exported(client: AsyncClient) -> InMemorySpanExporter:
    return capture_spans()


def attribute(spans: tuple[ReadableSpan, ...], key: str) -> list[str]:
    return [str((span.attributes or {}).get(key)) for span in spans]


async def test_each_response_gets_a_fresh_request_id(client: AsyncClient) -> None:
    first = await client.get("/health")
    second = await client.get("/health")

    assert first.headers["x-request-id"]
    assert second.headers["x-request-id"]
    assert first.headers["x-request-id"] != second.headers["x-request-id"]


async def test_an_incoming_request_id_is_kept(client: AsyncClient) -> None:
    response = await client.get(
        "/health", headers={"X-Request-ID": "edge-7f3a.42:retry_1"}
    )

    assert response.headers["x-request-id"] == "edge-7f3a.42:retry_1"


@pytest.mark.parametrize("unsafe", ["a" * 129, "<script>", "id with spaces", ""])
async def test_an_unsafe_incoming_request_id_is_replaced(
    client: AsyncClient, unsafe: str
) -> None:
    response = await client.get("/health", headers={"X-Request-ID": unsafe})

    assert response.headers["x-request-id"]
    assert response.headers["x-request-id"] != unsafe


async def test_an_unhandled_error_response_still_carries_the_request_id(
    client: AsyncClient,
) -> None:
    response = await client.post(
        "/test/widgets/break", headers={"X-Request-ID": "req-500"}
    )

    assert response.status_code == 500
    assert response.headers["x-request-id"] == "req-500"


async def test_every_log_of_a_request_carries_its_request_id(
    client: AsyncClient, exported: InMemorySpanExporter
) -> None:
    await client.post("/test/widgets/buy", headers={"X-Request-ID": "req-log"})

    spans = exported.get_finished_spans()
    assert "Bought a sprocket" in attribute(spans, "logfire.msg")
    assert "POST /test/widgets/buy" in attribute(spans, "logfire.msg")
    assert set(attribute(spans, "request_id")) == {"req-log"}


async def test_the_logs_of_an_unhandled_error_carry_the_request_id(
    client: AsyncClient, exported: InMemorySpanExporter
) -> None:
    await client.post("/test/widgets/break", headers={"X-Request-ID": "req-500"})

    spans = exported.get_finished_spans()
    assert "exception" in {event.name for span in spans for event in span.events}
    assert set(attribute(spans, "request_id")) == {"req-500"}


async def test_outgoing_http_calls_of_a_request_carry_its_request_id(
    environment: pytest.MonkeyPatch, httpserver: HTTPServer
) -> None:
    httpserver.expect_request("/jwks").respond_with_json({"keys": []})
    environment.setenv("CLERK_JWKS_URL", httpserver.url_for("/jwks"))
    token = jwt.encode(
        {"sub": "user_1"}, "k" * 32, algorithm="HS256", headers={"kid": "ins_1"}
    )

    async with app_client() as client:
        exported = capture_spans()
        await client.get(
            "/v1/me",
            headers={"X-Request-ID": "req-out", "Authorization": f"Bearer {token}"},
        )

    spans = exported.get_finished_spans()
    outgoing = tuple(span for span in spans if span.kind is SpanKind.CLIENT)
    assert len(httpserver.log) == 1
    assert len(outgoing) == 1
    assert set(attribute(spans, "request_id")) == {"req-out"}


async def test_requests_are_logged_to_the_console_in_production(
    environment: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    environment.setenv("ENVIRONMENT", "production")

    async with app_client() as client:
        await client.post("/test/widgets/buy")

    console = capsys.readouterr().out
    assert "POST /test/widgets/buy" in console
    assert "Bought a sprocket" in console


async def test_the_log_level_hides_quieter_logs(
    environment: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    environment.setenv("LOG_LEVEL", "warning")

    async with app_client() as client:
        await client.post("/test/widgets/buy")
        await client.post("/test/widgets/break")

    console = capsys.readouterr().out
    assert "The sprocket is about to break" in console
    assert "Bought a sprocket" not in console
