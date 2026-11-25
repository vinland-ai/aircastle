import time
from collections.abc import Callable

import pytest
from fake_clerk import (
    FIRST_KEY,
    ISSUER,
    JWKS_PATH,
    ROTATED_KEY,
    STRANGER_KEY,
    USER_ID,
    FakeClerk,
    SigningKey,
    bearer,
    session_claims,
    trust_fake_clerk,
)
from httpx import AsyncClient
from pytest_httpserver import HTTPServer
from serving import serve

from aircastle_api.app import create_app
from aircastle_api.settings import load_settings

PROBLEM_JSON = "application/problem+json"


@pytest.fixture(autouse=True)
def clerk(httpserver: HTTPServer, environment: pytest.MonkeyPatch) -> FakeClerk:
    """Trust the fake Clerk, which publishes `FIRST_KEY` until a test rotates it."""
    return trust_fake_clerk(httpserver, environment)


async def test_me_returns_the_clerk_user_id_for_a_valid_session(
    client: AsyncClient,
) -> None:
    response = await client.get(
        "/v1/me", headers=bearer(FIRST_KEY.sign(session_claims()))
    )

    assert response.status_code == 200
    assert response.json() == {"id": USER_ID}


def missing_token() -> dict[str, str]:
    return {}


def basic_credentials() -> dict[str, str]:
    return {"Authorization": "Basic dXNlcjpodW50ZXIy"}


def garbage_token() -> dict[str, str]:
    return bearer("not.a.jwt")


def expired_token() -> dict[str, str]:
    now = int(time.time())
    return bearer(FIRST_KEY.sign(session_claims(iat=now - 120, exp=now - 60)))


def not_yet_valid_token() -> dict[str, str]:
    return bearer(FIRST_KEY.sign(session_claims(nbf=int(time.time()) + 60)))


def wrong_issuer_token() -> dict[str, str]:
    return bearer(FIRST_KEY.sign(session_claims(iss="https://clerk.elsewhere.test")))


def wrong_party_token() -> dict[str, str]:
    return bearer(FIRST_KEY.sign(session_claims(azp="https://evil.test")))


def unknown_key_token() -> dict[str, str]:
    return bearer(STRANGER_KEY.sign(session_claims()))


def forged_kid_token() -> dict[str, str]:
    forged = SigningKey(FIRST_KEY.kid, STRANGER_KEY.private)
    return bearer(forged.sign(session_claims()))


def sessionless_token() -> dict[str, str]:
    claims = session_claims()
    del claims["sid"]
    return bearer(FIRST_KEY.sign(claims))


@pytest.mark.parametrize(
    ("headers", "challenge"),
    [
        (missing_token, "Bearer"),
        (basic_credentials, "Bearer"),
        (garbage_token, 'Bearer error="invalid_token"'),
        (expired_token, 'Bearer error="invalid_token"'),
        (not_yet_valid_token, 'Bearer error="invalid_token"'),
        (wrong_issuer_token, 'Bearer error="invalid_token"'),
        (wrong_party_token, 'Bearer error="invalid_token"'),
        (unknown_key_token, 'Bearer error="invalid_token"'),
        (forged_kid_token, 'Bearer error="invalid_token"'),
        (sessionless_token, 'Bearer error="invalid_token"'),
    ],
)
async def test_me_rejects_a_request_without_a_valid_session_as_a_401_problem(
    client: AsyncClient, headers: Callable[[], dict[str, str]], challenge: str
) -> None:
    response = await client.get("/v1/me", headers=headers())

    assert response.status_code == 401
    assert response.headers["content-type"] == PROBLEM_JSON
    assert response.headers["www-authenticate"] == challenge
    problem = response.json()
    assert problem["status"] == 401
    assert problem["title"] == "Unauthorized"
    assert problem["instance"] == "/v1/me"
    assert USER_ID not in response.text


async def test_me_accepts_a_token_without_an_authorized_party(
    client: AsyncClient,
) -> None:
    claims = session_claims()
    del claims["azp"]

    response = await client.get("/v1/me", headers=bearer(FIRST_KEY.sign(claims)))

    assert response.status_code == 200
    assert response.json() == {"id": USER_ID}


async def test_me_accepts_tokens_from_a_rotated_key_without_a_restart(
    client: AsyncClient, clerk: FakeClerk
) -> None:
    before = await client.get(
        "/v1/me", headers=bearer(FIRST_KEY.sign(session_claims()))
    )
    clerk.publish(FIRST_KEY, ROTATED_KEY)

    after = await client.get(
        "/v1/me", headers=bearer(ROTATED_KEY.sign(session_claims()))
    )

    assert before.status_code == 200
    assert after.status_code == 200
    assert after.json() == {"id": USER_ID}


async def test_the_key_set_is_fetched_once_across_requests(
    client: AsyncClient, clerk: FakeClerk
) -> None:
    for _ in range(3):
        response = await client.get(
            "/v1/me", headers=bearer(FIRST_KEY.sign(session_claims()))
        )
        assert response.status_code == 200

    assert clerk.jwks_fetches == 1


async def test_an_unreachable_key_set_is_a_503_problem(
    client: AsyncClient, httpserver: HTTPServer
) -> None:
    httpserver.clear()
    httpserver.expect_request(JWKS_PATH).respond_with_data("down", status=502)

    response = await client.get(
        "/v1/me", headers=bearer(FIRST_KEY.sign(session_claims()))
    )

    assert response.status_code == 503
    assert response.headers["content-type"] == PROBLEM_JSON
    assert response.json()["status"] == 503


async def test_an_issuer_set_with_a_trailing_slash_still_matches_its_tokens(
    environment: pytest.MonkeyPatch,
) -> None:
    environment.setenv("CLERK_ISSUER", f"{ISSUER}/")
    async with serve(create_app(load_settings())) as client:
        response = await client.get(
            "/v1/me", headers=bearer(FIRST_KEY.sign(session_claims()))
        )

    assert response.status_code == 200
