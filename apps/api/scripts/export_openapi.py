"""Write the API's OpenAPI document to `apps/api/openapi.json`.

The document comes from the app factory, with no server running. Fixed
placeholder settings replace the environment and any `.env` file, so the
document is the same on every machine.
"""

import json
import os
from contextlib import chdir
from pathlib import Path
from tempfile import TemporaryDirectory

from aircastle_api.app import create_app
from aircastle_api.settings import Settings, load_settings

DOCUMENT = Path(__file__).parents[1] / "openapi.json"
PLACEHOLDER_ENVIRONMENT = {
    "ENVIRONMENT": "development",
    "DATABASE_URL": "postgresql://aircastle:aircastle@localhost:5432/aircastle",
    "CLERK_ISSUER": "https://clerk.aircastle.invalid",
    "CLERK_JWKS_URL": "https://clerk.aircastle.invalid/.well-known/jwks.json",
    "CLERK_AUTHORIZED_PARTIES": '["http://localhost:3000"]',
    "CORS_ORIGINS": '["http://localhost:3000"]',
}


def placeholder_settings() -> Settings:
    """Settings read from the placeholders alone, ignoring the shell and `.env`."""
    for name in Settings.model_fields:
        os.environ.pop(name.upper(), None)
    os.environ.update(PLACEHOLDER_ENVIRONMENT)
    with TemporaryDirectory() as empty, chdir(empty):
        return load_settings()


def main() -> None:
    """Build the app from placeholder settings and write its OpenAPI document."""
    app = create_app(placeholder_settings())
    document = json.dumps(app.openapi(), indent=2, ensure_ascii=False)
    DOCUMENT.write_text(f"{document}\n", encoding="utf-8")


if __name__ == "__main__":
    main()
