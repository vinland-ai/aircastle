import pytest
from httpx import AsyncClient
from serving import serve
from widgets import widget_routes

from aircastle_api.app import create_app
from aircastle_api.settings import load_settings

PROBLEM_JSON = "application/problem+json"


async def test_swagger_ui_is_served_publicly(client: AsyncClient) -> None:
    response = await client.get("/docs")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "swagger-ui" in response.text
    assert "/openapi.json" in response.text


async def test_openapi_document_is_served_publicly(client: AsyncClient) -> None:
    response = await client.get("/openapi.json")

    assert response.status_code == 200
    assert response.json()["info"]["title"] == "Aircastle API"


async def test_operation_ids_are_the_handler_names(client: AsyncClient) -> None:
    document = (await client.get("/openapi.json")).json()

    assert document["paths"]["/health"]["get"]["operationId"] == "health"
    assert document["paths"]["/v1/me"]["get"]["operationId"] == "get_me"


async def test_me_requires_the_declared_bearer_scheme_and_health_does_not(
    client: AsyncClient,
) -> None:
    document = (await client.get("/openapi.json")).json()

    scheme = document["components"]["securitySchemes"]["HTTPBearer"]
    assert (scheme["type"], scheme["scheme"]) == ("http", "bearer")
    assert document["paths"]["/v1/me"]["get"]["security"] == [{"HTTPBearer": []}]
    assert "security" not in document["paths"]["/health"]["get"]


async def test_every_operation_declares_problem_json_for_its_errors(
    client: AsyncClient,
) -> None:
    document = (await client.get("/openapi.json")).json()

    operations = [
        operation for path in document["paths"].values() for operation in path.values()
    ]
    assert len(operations) >= 2
    for operation in operations:
        assert operation["responses"]["default"]["content"] == {
            PROBLEM_JSON: {"schema": {"$ref": "#/components/schemas/Problem"}}
        }
    problem = document["components"]["schemas"]["Problem"]
    assert set(problem["required"]) == {"title", "status", "detail", "instance"}
    assert set(problem["properties"]) == {
        "type",
        "title",
        "status",
        "detail",
        "instance",
    }


async def test_only_operations_that_take_input_declare_a_validation_problem(
    environment: pytest.MonkeyPatch,
) -> None:
    app = create_app(load_settings())
    app.include_router(widget_routes)

    async with serve(app) as client:
        document = (await client.get("/openapi.json")).json()

    widgets = document["paths"]["/test/widgets"]["post"]["responses"]
    assert widgets["422"]["content"] == {
        PROBLEM_JSON: {"schema": {"$ref": "#/components/schemas/ValidationProblem"}}
    }
    assert "422" not in document["paths"]["/health"]["get"]["responses"]
    assert "422" not in document["paths"]["/v1/me"]["get"]["responses"]
    schemas = document["components"]["schemas"]
    assert "errors" in schemas["ValidationProblem"]["required"]
    assert "HTTPValidationError" not in schemas


async def test_redoc_is_off(client: AsyncClient) -> None:
    response = await client.get("/redoc")

    assert response.status_code == 404
    assert response.headers["content-type"] == PROBLEM_JSON
