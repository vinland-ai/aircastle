from httpx import AsyncClient


async def test_health_reports_ok_with_the_environment_name(
    client: AsyncClient,
) -> None:
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "environment": "test"}
