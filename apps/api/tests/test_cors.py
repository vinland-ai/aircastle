from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from aircastle_api.app import create_app
from aircastle_api.settings import load_settings

WEB_ORIGIN = "http://localhost:3000"
OTHER_ORIGIN = "https://evil.example"
PROBLEM_JSON = "application/problem+json"


@asynccontextmanager
async def serve(app: FastAPI) -> AsyncGenerator[AsyncClient]:
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield client


def preflight(origin: str) -> dict[str, str]:
    return {
        "Origin": origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
    }


async def test_preflight_from_the_web_origin_is_allowed(client: AsyncClient) -> None:
    response = await client.options("/v1/me", headers=preflight(WEB_ORIGIN))

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == WEB_ORIGIN
    assert "GET" in response.headers["access-control-allow-methods"]
    assert "authorization" in response.headers["access-control-allow-headers"]


async def test_preflight_from_another_origin_gets_no_cors_headers(
    client: AsyncClient,
) -> None:
    response = await client.options("/v1/me", headers=preflight(OTHER_ORIGIN))

    assert "access-control-allow-origin" not in response.headers


async def test_request_from_the_web_origin_gets_cors_headers(
    client: AsyncClient,
) -> None:
    response = await client.get("/health", headers={"Origin": WEB_ORIGIN})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == WEB_ORIGIN


async def test_request_from_another_origin_gets_no_cors_headers(
    client: AsyncClient,
) -> None:
    response = await client.get("/health", headers={"Origin": OTHER_ORIGIN})

    assert "access-control-allow-origin" not in response.headers


async def test_browsers_may_read_the_retry_and_request_id_headers(
    client: AsyncClient,
) -> None:
    response = await client.get("/health", headers={"Origin": WEB_ORIGIN})

    exposed = response.headers["access-control-expose-headers"].lower().split(", ")
    assert {"retry-after", "x-request-id"} <= set(exposed)


async def test_allowed_origins_come_from_settings(
    environment: pytest.MonkeyPatch,
) -> None:
    environment.setenv(
        "CORS_ORIGINS", '["https://app.aircastle.test/", "https://aircastle.test"]'
    )

    async with serve(create_app(load_settings())) as client:
        responses = {
            origin: await client.get("/health", headers={"Origin": origin})
            for origin in ("https://app.aircastle.test", "https://aircastle.test")
        }
        localhost = await client.get("/health", headers={"Origin": WEB_ORIGIN})

    for origin, response in responses.items():
        assert response.headers["access-control-allow-origin"] == origin
    assert "access-control-allow-origin" not in localhost.headers


async def test_unhandled_error_from_the_web_origin_is_a_readable_500_problem(
    environment: pytest.MonkeyPatch,
) -> None:
    async def crash() -> None:
        message = "connect to postgresql://aircastle:hunter2@db failed"
        raise RuntimeError(message)

    app = create_app(load_settings())
    app.add_api_route("/test/crash", crash)

    async with serve(app) as client:
        response = await client.get("/test/crash", headers={"Origin": WEB_ORIGIN})

    assert response.status_code == 500
    assert response.headers["content-type"] == PROBLEM_JSON
    assert response.headers["access-control-allow-origin"] == WEB_ORIGIN
    assert response.json()["instance"] == "/test/crash"
    assert "hunter2" not in response.text
