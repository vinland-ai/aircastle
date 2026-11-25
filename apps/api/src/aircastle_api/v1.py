from fastapi import APIRouter, Depends
from pydantic import BaseModel

from aircastle_api.auth import CurrentUser
from aircastle_api.rate_limit import rate_limit


class Me(BaseModel):
    """The signed-in user."""

    id: str


async def get_me(user: CurrentUser) -> Me:
    """Return the signed-in user's Clerk ID."""
    return Me(id=user.id)


def v1_router() -> APIRouter:
    """Build the versioned API. Feature routes mount here, under `/v1`."""
    router = APIRouter(prefix="/v1", dependencies=[Depends(rate_limit)])
    router.add_api_route("/me", get_me, methods=["GET"], tags=["me"])
    return router
