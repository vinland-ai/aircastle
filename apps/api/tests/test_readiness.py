import time

from httpx import AsyncClient


async def test_ready_when_postgres_answers(client: AsyncClient) -> None:
    response = await client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


async def test_not_ready_problem_when_postgres_does_not_answer(
    unready_client: AsyncClient,
) -> None:
    started = time.monotonic()
    response = await unready_client.get("/ready")

    assert time.monotonic() - started < 4
    assert response.status_code == 503
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json() == {
        "type": "about:blank",
        "title": "Service Unavailable",
        "status": 503,
        "detail": "The database is not answering.",
        "instance": "/ready",
    }


async def test_health_answers_without_postgres(unready_client: AsyncClient) -> None:
    response = await unready_client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "environment": "test"}
