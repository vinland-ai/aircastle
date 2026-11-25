from typing import Literal

from pydantic import PositiveInt, PostgresDsn, Secret, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

type Environment = Literal["development", "test", "production"]


class Settings(BaseSettings):
    """Configuration read from the environment and an optional `.env` file."""

    model_config = SettingsConfigDict(env_file=".env", frozen=True)

    environment: Environment
    database_url: Secret[PostgresDsn]
    database_pool_size: PositiveInt = 5

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
