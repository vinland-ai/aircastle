"""Clerk session authentication: verify the bearer JWT and name the signed-in user."""

from collections.abc import Mapping
from dataclasses import dataclass
from http import HTTPStatus
from typing import Annotated

import anyio.to_thread
import jwt
from fastapi import Depends, FastAPI, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.security.utils import get_authorization_scheme_param
from jwt import PyJWKClient, PyJWKClientConnectionError

from aircastle_api.errors import DomainError
from aircastle_api.settings import Settings

_CHALLENGE = {"WWW-Authenticate": "Bearer"}
_INVALID_TOKEN = {"WWW-Authenticate": 'Bearer error="invalid_token"'}
_REQUIRED_CLAIMS = ["exp", "nbf", "iat", "iss", "sub", "sid"]


class UnauthorizedError(DomainError):
    """The request carries no valid Clerk session."""

    status = HTTPStatus.UNAUTHORIZED


class IdentityProviderUnavailableError(DomainError):
    """Clerk's signing keys could not be fetched, so no token can be checked."""

    status = HTTPStatus.SERVICE_UNAVAILABLE


@dataclass(frozen=True)
class User:
    """A signed-in Clerk user, read from a verified session token."""

    id: str
    session_id: str
    claims: Mapping[str, object]


class ClerkSessions:
    """Verifies Clerk session tokens against the instance's published keys.

    The key set is cached, and refetched when a token names an unknown key.
    """

    def __init__(self, settings: Settings) -> None:
        """Trust the issuer, key set and authorized parties in `settings`."""
        self._keys = PyJWKClient(
            str(settings.clerk_jwks_url),
            lifespan=300,
            cooldown_duration=settings.clerk_jwks_refetch_cooldown_seconds,
            timeout=5,
        )
        self._issuer = settings.clerk_issuer
        self._authorized_parties = settings.clerk_authorized_parties

    async def verify(self, token: str) -> User:
        """Return the token's user, or raise `UnauthorizedError` if it is not valid."""
        try:
            key = await anyio.to_thread.run_sync(
                self._keys.get_signing_key_from_jwt, token
            )
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                issuer=self._issuer,
                leeway=5,
                options={"require": _REQUIRED_CLAIMS},
            )
        except PyJWKClientConnectionError:
            raise IdentityProviderUnavailableError(
                "The identity provider is unreachable. Try again shortly."
            ) from None
        except jwt.PyJWTError:
            raise UnauthorizedError(
                "The session token is invalid or expired.", headers=_INVALID_TOKEN
            ) from None
        authorized_party = claims.get("azp")
        if (
            authorized_party is not None
            and authorized_party not in self._authorized_parties
        ):
            raise UnauthorizedError(
                "The session token was issued for another origin.",
                headers=_INVALID_TOKEN,
            )
        return User(id=claims["sub"], session_id=claims["sid"], claims=claims)


def add_auth(app: FastAPI, settings: Settings) -> None:
    """Let the app verify Clerk sessions, for `CurrentUser` and `optional_user`."""
    app.state.clerk_sessions = ClerkSessions(settings)


async def optional_user(request: Request) -> User | None:
    """The signed-in user, or None when the request has no Authorization header.

    A header that holds no valid bearer token is a 401. This does not mark a
    route as secured in OpenAPI, so it suits code that serves anyone, such as
    a rate limiter keyed by user.
    """
    authorization = request.headers.get("Authorization")
    if authorization is None:
        return None
    scheme, token = get_authorization_scheme_param(authorization)
    if scheme.lower() != "bearer" or not token:
        raise UnauthorizedError(
            "The Authorization header must hold a bearer token.", headers=_CHALLENGE
        )
    sessions: ClerkSessions = request.app.state.clerk_sessions
    return await sessions.verify(token)


_bearer = HTTPBearer(auto_error=False, description="A Clerk session token.")


async def current_user(
    user: Annotated[User | None, Depends(optional_user)],
    _credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    """The signed-in user. Without one the request is a 401."""
    if user is None:
        raise UnauthorizedError("Sign in to use this endpoint.", headers=_CHALLENGE)
    return user


CurrentUser = Annotated[User, Depends(current_user)]
"""Declare a parameter of this type to require a signed-in user."""
