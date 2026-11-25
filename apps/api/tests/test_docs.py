from httpx import AsyncClient

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


async def test_me_requires_the_declared_bearer_scheme_and_health_does_not(
    client: AsyncClient,
) -> None:
    document = (await client.get("/openapi.json")).json()

    scheme = document["components"]["securitySchemes"]["HTTPBearer"]
    assert (scheme["type"], scheme["scheme"]) == ("http", "bearer")
    assert document["paths"]["/v1/me"]["get"]["security"] == [{"HTTPBearer": []}]
    assert "security" not in document["paths"]["/health"]["get"]


async def test_redoc_is_off(client: AsyncClient) -> None:
    response = await client.get("/redoc")

    assert response.status_code == 404
    assert response.headers["content-type"] == PROBLEM_JSON
