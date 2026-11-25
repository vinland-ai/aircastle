from typing import Annotated, Literal

from limits import RateLimitItem, parse
from pydantic import (
    AfterValidator,
    Field,
    HttpUrl,
    NonNegativeFloat,
    PlainValidator,
    PositiveInt,
    PostgresDsn,
    RedisDsn,
    Secret,
    TypeAdapter,
    ValidationError,
)
from pydantic_settings import BaseSettings, SettingsConfigDict

type Environment = Literal["development", "test", "production"]

_HTTP_URL = TypeAdapter(HttpUrl)


def _as_origin(value: str) -> str:
    try:
        url = _HTTP_URL.validate_python(value)
    except ValidationError:
        url = None
    if url is None or url.path != "/" or url.query or url.fragment or url.username:
        message = "must be an origin, like https://example.com"
        raise ValueError(message)
    return str(url).removesuffix("/")


type Origin = Annotated[str, AfterValidator(_as_origin)]
"""An http(s) scheme, host and optional port, with no trailing slash."""


type RateLimit = Annotated[RateLimitItem, PlainValidator(parse)]
"""A request count per time window, written like `120/minute`."""


class Settings(BaseSettings):
    """Configuration read from the environment and an optional `.env` file."""

    model_config = SettingsConfigDict(env_file=".env", frozen=True)

    environment: Environment
    database_url: Secret[PostgresDsn]
    database_pool_size: PositiveInt = 5
    clerk_issuer: Origin
    clerk_jwks_url: HttpUrl
    clerk_authorized_parties: frozenset[Origin] = Field(min_length=1)
    clerk_jwks_refetch_cooldown_seconds: NonNegativeFloat = 30
    rate_limit: RateLimit = Field(default="120/minute", validate_default=True)
    rate_limit_redis_url: Secret[RedisDsn] | None = None
    client_ip_header: str | None = None

    def __init__(self) -> None:
        """Read every value from the environment. Settings take no arguments."""
        super().__init__()


class SettingsError(Exception):
    """The environment is missing variables or holds invalid ones."""

    def __init__(self, error: ValidationError) -> None:
        """Name each bad variable without echoing its value."""
        problems = (
            f"  {str(problem['loc'][0]).upper()}: {problem['msg']}"
            for problem in error.errors(include_input=False, include_url=False)
        )
        super().__init__("\n".join(["Invalid environment:", *problems]))


def load_settings() -> Settings:
    """Read settings from the environment. Raise `SettingsError` if any are bad."""
    try:
        return Settings()
    except ValidationError as error:
        raise SettingsError(error) from None
