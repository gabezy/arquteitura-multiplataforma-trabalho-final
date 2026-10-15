from httpx import ASGITransport, AsyncClient

from compliance_service.infra.http.app import create_app


async def test_health_returns_up():
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "UP"}
