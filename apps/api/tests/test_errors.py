from collections.abc import AsyncIterator

import pytest
from httpx import AsyncClient
from serving import serve
from widgets import widget_routes

from aircastle_api.app import create_app
from aircastle_api.settings import load_settings

PROBLEM_JSON = "application/problem+json"


@pytest.fixture
async def client(environment: pytest.MonkeyPatch) -> AsyncIterator[AsyncClient]:
    """The real app, plus test-only routes that fail on purpose."""
    app = create_app(load_settings())
    app.include_router(widget_routes)
    async with serve(app) as client:
        yield client


async def test_unknown_path_is_a_404_problem(client: AsyncClient) -> None:
    response = await client.get("/nowhere")

    assert response.status_code == 404
    assert response.headers["content-type"] == PROBLEM_JSON
    assert response.json() == {
        "type": "about:blank",
        "title": "Not Found",
        "status": 404,
        "detail": "Not Found",
        "instance": "/nowhere",
    }


async def test_wrong_method_is_a_405_problem_that_names_the_allowed_methods(
    client: AsyncClient,
) -> None:
    response = await client.delete("/health")

    assert response.status_code == 405
    assert response.headers["content-type"] == PROBLEM_JSON
    assert response.headers["allow"] == "GET"
    assert response.json() == {
        "type": "about:blank",
        "title": "Method Not Allowed",
        "status": 405,
        "detail": "Method Not Allowed",
        "instance": "/health",
    }


async def test_invalid_request_is_a_422_problem_listing_each_field(
    client: AsyncClient,
) -> None:
    response = await client.post("/test/widgets", json={"quantity": "hunter2"})

    assert response.status_code == 422
    assert response.headers["content-type"] == PROBLEM_JSON
    assert response.json() == {
        "type": "about:blank",
        "title": "Unprocessable Content",
        "status": 422,
        "detail": "The request failed validation.",
        "instance": "/test/widgets",
        "errors": [
            {"path": ["body", "name"], "message": "Field required"},
            {
                "path": ["body", "quantity"],
                "message": "Input should be a valid integer, "
                "unable to parse string as an integer",
            },
        ],
    }
    assert "hunter2" not in response.text


async def test_domain_error_is_a_problem_with_its_chosen_status_and_headers(
    client: AsyncClient,
) -> None:
    response = await client.post("/test/widgets/reserve")

    assert response.status_code == 409
    assert response.headers["content-type"] == PROBLEM_JSON
    assert response.headers["retry-after"] == "60"
    assert response.json() == {
        "type": "about:blank",
        "title": "Conflict",
        "status": 409,
        "detail": "Every widget is sold out.",
        "instance": "/test/widgets/reserve",
    }


async def test_unhandled_exception_is_a_generic_500_problem_with_no_internals(
    client: AsyncClient,
) -> None:
    response = await client.post("/test/widgets/break")

    assert response.status_code == 500
    assert response.headers["content-type"] == PROBLEM_JSON
    assert response.json() == {
        "type": "about:blank",
        "title": "Internal Server Error",
        "status": 500,
        "detail": "The server hit an unexpected error.",
        "instance": "/test/widgets/break",
    }
    for internal in ("hunter2", "RuntimeError", "Traceback", "break_widget"):
        assert internal not in response.text
