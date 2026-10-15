from fastapi import FastAPI
from starlette.types import Lifespan

from compliance_service.infra.http import health


def create_app(lifespan: Lifespan[FastAPI] | None = None) -> FastAPI:
    app = FastAPI(title="compliance-service", lifespan=lifespan)
    app.include_router(health.router)
    return app
