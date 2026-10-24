# syntax=docker/dockerfile:1

ARG NODE_VERSION=22

# Production dependencies only, installed apart so the runtime image skips dev tooling.
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Compiles TypeScript to dist/.
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8087
WORKDIR /app

RUN addgroup -S marketplace && adduser -S -H -G marketplace marketplace

# Files stay owned by root, so the app user can read but not modify them.
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER marketplace

EXPOSE 8087

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

# Applies pending migrations, then exec replaces the shell so node runs as PID 1
# and SIGTERM reaches the shutdown handler in main.ts. Knex records applied
# migrations, so a restart only runs the new ones.
CMD ["sh", "-c", "npm run --silent migrate:deploy && exec node --require ./dist/infra/observability/instrumentation.js dist/main.js"]
