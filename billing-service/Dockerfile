# syntax=docker/dockerfile:1

# The build stage always runs on the builder's own platform and cross-compiles,
# so building for another architecture needs no emulation.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/billing-service ./cmd/billing-service

# Static binary on a base with no shell and no package manager. It runs as the
# unprivileged `nonroot` user (uid 65532) and applies its own migrations on startup.
FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/billing-service /billing-service

EXPOSE 8086
# The image has no curl: the binary answers its own health check.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 CMD ["/billing-service", "healthcheck"]
ENTRYPOINT ["/billing-service"]
