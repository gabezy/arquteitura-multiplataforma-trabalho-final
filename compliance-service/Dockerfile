# syntax=docker/dockerfile:1

ARG PYTHON_VERSION=3.13

# Installs the service and its runtime dependencies into /app/.venv. Dependencies come first,
# in their own layer, so a source-only change reuses them.
FROM ghcr.io/astral-sh/uv:python${PYTHON_VERSION}-bookworm-slim AS build
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PORT=8083
WORKDIR /app

RUN groupadd --system compliance && useradd --system --no-create-home --gid compliance compliance

# Files stay owned by root, so the app user can read but not modify them.
COPY --from=build /app/.venv ./.venv
COPY alembic.ini ./

USER compliance

EXPOSE 8083

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/health', timeout=4)" || exit 1

# Applies pending migrations, then exec replaces the shell so python runs as PID 1 and
# SIGTERM reaches uvicorn, which runs the lifespan shutdown. Alembic records applied
# migrations, so a restart only runs the new ones.
CMD ["sh", "-c", "alembic upgrade head && exec python -m compliance_service.main"]
