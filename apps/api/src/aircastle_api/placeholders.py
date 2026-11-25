"""Placeholder settings that reach no real service.

The OpenAPI export and the tests build the app from these, so neither depends
on the machine's environment or `.env` file. The app itself never reads them.
"""

import os
from collections.abc import Generator
from contextlib import chdir, contextmanager
from tempfile import TemporaryDirectory

from aircastle_api.settings import Settings

_PLACEHOLDERS = {
    "ENVIRONMENT": "test",
    "DATABASE_URL": "postgresql://aircastle:aircastle@localhost:5432/aircastle",
    "CLERK_ISSUER": "https://clerk.aircastle.invalid",
    "CLERK_JWKS_URL": "https://clerk.aircastle.invalid/.well-known/jwks.json",
    "CLERK_AUTHORIZED_PARTIES": '["http://localhost:3000"]',
    "CORS_ORIGINS": '["http://localhost:3000"]',
}


@contextmanager
def placeholder_environment() -> Generator[None]:
    """Within the block, settings read valid placeholders that reach no real service.

    Every settings variable is replaced, and the working directory is an empty
    one with no `.env` file. The environment and directory return on exit.
    """
    saved = os.environ.copy()
    try:
        for name in Settings.model_fields:
            os.environ.pop(name.upper(), None)
        os.environ.update(_PLACEHOLDERS)
        with TemporaryDirectory() as empty, chdir(empty):
            yield
    finally:
        os.environ.clear()
        os.environ.update(saved)
