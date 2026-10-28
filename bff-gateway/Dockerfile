# syntax=docker/dockerfile:1

ARG JAVA_VERSION=25

# Builds the jar with the Maven wrapper. The cache mount keeps Maven and the dependencies
# between builds, so a source-only change does not download them again. Tests run in CI
# (_java-service.yml): some need Docker, which the image build does not have.
FROM eclipse-temurin:${JAVA_VERSION}-jdk AS build
WORKDIR /app
COPY mvnw pom.xml ./
COPY .mvn ./.mvn
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -q package -DskipTests && cp target/bff-gateway-*.jar app.jar

FROM eclipse-temurin:${JAVA_VERSION}-jre AS runtime
WORKDIR /app

RUN groupadd --system bff && useradd --system --no-create-home --gid bff bff

# Files stay owned by root, so the app user can read but not modify them.
COPY --from=build /app/app.jar ./app.jar

USER bff

EXPOSE 8080

# The image has neither curl nor wget, so bash talks HTTP to the actuator over /dev/tcp.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && printf 'GET /actuator/health HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && grep -q '\"UP\"' <&3"]

# Exec form, so java runs as PID 1 and SIGTERM reaches Spring's graceful shutdown.
ENTRYPOINT ["java", "-jar", "app.jar"]
