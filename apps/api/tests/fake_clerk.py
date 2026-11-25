"""A fake Clerk instance: signing keys, session tokens and a JWKS endpoint."""

import time
from dataclasses import dataclass, field
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
from jwt.algorithms import RSAAlgorithm
from pytest_httpserver import HTTPServer

ISSUER = "https://clerk.aircastle.test"
WEB_ORIGIN = "http://localhost:3000"
JWKS_PATH = "/.well-known/jwks.json"
USER_ID = "user_2aircastle"


@dataclass(frozen=True)
class SigningKey:
    kid: str
    private: RSAPrivateKey = field(
        default_factory=lambda: rsa.generate_private_key(65537, 2048)
    )

    def jwk(self) -> dict[str, Any]:
        public = RSAAlgorithm.to_jwk(self.private.public_key(), as_dict=True)
        return {**public, "kid": self.kid, "alg": "RS256", "use": "sig"}

    def sign(self, claims: dict[str, Any]) -> str:
        return jwt.encode(
            claims, self.private, algorithm="RS256", headers={"kid": self.kid}
        )


FIRST_KEY = SigningKey("ins_first")
ROTATED_KEY = SigningKey("ins_rotated")
STRANGER_KEY = SigningKey("ins_stranger")


def session_claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    return {
        "iss": ISSUER,
        "sub": USER_ID,
        "sid": "sess_2aircastle",
        "azp": WEB_ORIGIN,
        "iat": now,
        "nbf": now - 5,
        "exp": now + 60,
        **overrides,
    }


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class FakeClerk:
    """Clerk's JWKS endpoint, served on loopback."""

    def __init__(self, server: HTTPServer) -> None:
        self.server = server

    def publish(self, *keys: SigningKey) -> None:
        self.server.clear()
        self.server.expect_request(JWKS_PATH).respond_with_json(
            {"keys": [key.jwk() for key in keys]}
        )

    @property
    def jwks_fetches(self) -> int:
        return len(self.server.log)


def trust_fake_clerk(
    httpserver: HTTPServer, environment: pytest.MonkeyPatch
) -> FakeClerk:
    """Point the app at a fake Clerk that publishes `FIRST_KEY`."""
    environment.setenv("CLERK_ISSUER", ISSUER)
    environment.setenv("CLERK_JWKS_URL", httpserver.url_for(JWKS_PATH))
    environment.setenv("CLERK_AUTHORIZED_PARTIES", f'["{WEB_ORIGIN}"]')
    environment.setenv("CLERK_JWKS_REFETCH_COOLDOWN_SECONDS", "0")
    clerk = FakeClerk(httpserver)
    clerk.publish(FIRST_KEY)
    return clerk
