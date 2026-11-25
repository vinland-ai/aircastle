"""Test-only routes under `/test/widgets` that log, validate and fail on purpose."""

from http import HTTPStatus

import logfire
from fastapi import APIRouter
from pydantic import BaseModel, PositiveInt

from aircastle_api.errors import DomainError, Problem

WIDGETS_PER_BATCH = 200


class Widget(BaseModel):
    name: str
    quantity: PositiveInt


class WidgetsSoldOutError(DomainError):
    status = HTTPStatus.CONFLICT


async def create_widget(widget: Widget) -> Widget:
    return widget


async def buy_widget() -> dict[str, str]:
    logfire.info("Bought a {widget}", widget="sprocket")
    return {"widget": "sprocket"}


def count_widgets(batch: str) -> dict[str, int]:
    for number in range(WIDGETS_PER_BATCH):
        logfire.info(
            "Counted widget {number} of batch {batch}", number=number, batch=batch
        )
    return {"counted": WIDGETS_PER_BATCH}


async def reserve_widget() -> Widget:
    raise WidgetsSoldOutError(
        "Every widget is sold out.", headers={"Retry-After": "60"}
    )


async def break_widget() -> Widget:
    logfire.warning("The {widget} is about to break", widget="sprocket")
    message = "connect to postgresql://aircastle:hunter2@db failed"
    raise RuntimeError(message)


widget_routes = APIRouter(prefix="/test/widgets")
widget_routes.add_api_route("", create_widget, methods=["POST"])
widget_routes.add_api_route("/buy", buy_widget, methods=["POST"])
widget_routes.add_api_route(
    "/reserve",
    reserve_widget,
    methods=["POST"],
    responses={"4XX": {"model": Problem, "description": "Not reserved"}},
)
widget_routes.add_api_route("/count", count_widgets, methods=["POST"])
widget_routes.add_api_route("/break", break_widget, methods=["POST"])
