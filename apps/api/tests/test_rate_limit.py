import traceback

import pytest
from fake_clerk import FIRST_KEY, FakeClerk, bearer, session_claims, trust_fake_clerk
from httpx import AsyncClient
from pytest_httpserver import HTTPServer
from serving import serve

from aircastle_api.app import create_app
from aircastle_api.settings import SettingsError, load_settings

PROBLEM_JSON = "application/problem+json"


@pytest.fixture(autouse=True)
def clerk(httpserver: HTTPServer, environment: pytest.MonkeyPatch) -> FakeClerk:
    """Allow two requests a minute, so tests reach the limit quickly."""
    environment.setenv("RATE_LIMIT", "2/minute")
    return trust_fake_clerk(httpserver, environment)


async def test_a_caller_over_the_limit_gets_a_429_problem_with_retry_after(
    client: AsyncClient,
) -> None:
    for _ in range(2):
        allowed = await client.get("/v1/me")
        assert allowed.status_code == 401

    response = await client.get("/v1/me")

    assert response.status_code == 429
    assert response.headers["content-type"] == PROBLEM_JSON
    assert 1 <= int(response.headers["retry-after"]) <= 60
    problem = response.json()
    assert problem["status"] == 429
    assert problem["title"] == "Too Many Requests"
    assert problem["instance"] == "/v1/me"


async def test_signed_in_users_have_separate_limits(client: AsyncClient) -> None:
    alice = bearer(FIRST_KEY.sign(session_claims(sub="user_alice")))
    bob = bearer(FIRST_KEY.sign(session_claims(sub="user_bob")))
    for _ in range(2):
        allowed = await client.get("/v1/me", headers=alice)
        assert allowed.status_code == 200

    limited = await client.get("/v1/me", headers=alice)
    other = await client.get("/v1/me", headers=bob)

    assert limited.status_code == 429
    assert other.status_code == 200
    assert other.json() == {"id": "user_bob"}


async def test_anonymous_callers_behind_the_proxy_are_limited_by_their_own_ip(
    environment: pytest.MonkeyPatch,
) -> None:
    environment.setenv("CLIENT_IP_HEADER", "X-Real-IP")
    async with serve(create_app(load_settings())) as client:
        first = {"X-Real-IP": "203.0.113.7"}
        second = {"X-Real-IP": "198.51.100.23"}
        for _ in range(2):
            allowed = await client.get("/v1/me", headers=first)
            assert allowed.status_code == 401

        limited = await client.get("/v1/me", headers=first)
        other = await client.get("/v1/me", headers=second)

    assert limited.status_code == 429
    assert other.status_code == 401


async def test_a_caller_cannot_dodge_the_limit_with_an_untrusted_ip_header(
    client: AsyncClient,
) -> None:
    for octet in range(1, 3):
        allowed = await client.get("/v1/me", headers={"X-Real-IP": f"192.0.2.{octet}"})
        assert allowed.status_code == 401

    response = await client.get("/v1/me", headers={"X-Real-IP": "192.0.2.3"})

    assert response.status_code == 429


@pytest.mark.parametrize("path", ["/health", "/ready"])
async def test_health_checks_are_never_limited(client: AsyncClient, path: str) -> None:
    for _ in range(3):
        await client.get("/v1/me")

    responses = [await client.get(path) for _ in range(5)]

    assert [response.status_code for response in responses] == [200] * 5


def test_rate_limit_settings_that_are_malformed_are_all_named(
    environment: pytest.MonkeyPatch,
) -> None:
    environment.setenv("RATE_LIMIT", "lots")
    environment.setenv("RATE_LIMIT_REDIS_URL", "http://:hunter2@cache:6379")

    with pytest.raises(SettingsError) as raised:
        load_settings()

    lines = str(raised.value).splitlines()
    assert {line.split(":")[0].strip() for line in lines[1:]} == {
        "RATE_LIMIT",
        "RATE_LIMIT_REDIS_URL",
    }
    assert "hunter2" not in "".join(traceback.format_exception(raised.value))
