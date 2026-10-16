import asyncio

from httpx import ASGITransport, AsyncClient

from compliance_service.infra.http.app import create_app


async def test_health_returns_up():
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "UP"}


async def test_health_is_down_when_the_consumer_stopped():
    async def stopped():
        raise RuntimeError("consumer crashed")

    app = create_app()
    app.state.consumer_task = asyncio.create_task(stopped())
    await asyncio.sleep(0)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "DOWN"}


async def test_health_is_up_while_the_consumer_runs():
    app = create_app()
    app.state.consumer_task = asyncio.create_task(asyncio.sleep(60))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    app.state.consumer_task.cancel()
    assert response.status_code == 200
