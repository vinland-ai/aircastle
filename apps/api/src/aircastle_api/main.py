"""Server entrypoint. Importing it reads the environment and fails if invalid."""

from aircastle_api.app import create_app
from aircastle_api.settings import load_settings

app = create_app(load_settings())
