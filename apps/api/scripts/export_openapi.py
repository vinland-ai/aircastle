"""Write the API's OpenAPI document to `apps/api/openapi.json`.

The document comes from the app factory, with no server running. Fixed
placeholder settings replace the environment and any `.env` file, so the
document is the same on every machine.
"""

import json
from pathlib import Path

from aircastle_api.app import create_app
from aircastle_api.settings import load_settings, placeholder_environment

DOCUMENT = Path(__file__).parents[1] / "openapi.json"


def main() -> None:
    """Build the app from placeholder settings and write its OpenAPI document."""
    with placeholder_environment():
        app = create_app(load_settings())
    document = json.dumps(app.openapi(), indent=2, ensure_ascii=False)
    DOCUMENT.write_text(f"{document}\n", encoding="utf-8")


if __name__ == "__main__":
    main()
