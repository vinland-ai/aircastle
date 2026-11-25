"""Migrate the database named by the environment, using the app's engine settings."""

import asyncio
import logging

from alembic import context
from sqlalchemy import Connection

from aircastle_api.database import Base, create_engine
from aircastle_api.settings import load_settings

logging.basicConfig(format="%(levelname)s [%(name)s] %(message)s")
logging.getLogger("alembic").setLevel(logging.INFO)


def run_migrations(connection: Connection) -> None:
    """Run pending migrations on one connection, in one transaction."""
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()


async def migrate() -> None:
    """Connect to the configured database and migrate it."""
    engine = create_engine(load_settings())
    try:
        async with engine.connect() as connection:
            await connection.run_sync(run_migrations)
    finally:
        await engine.dispose()


asyncio.run(migrate())
