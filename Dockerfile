# syntax=docker/dockerfile:1

# Build on real Node (the engine Carby targets) with Bun only as the package manager, because
# oven/bun images have no node binary and `bun run build` would run the Vite build under Bun.
FROM node:22-slim AS deps
COPY --from=oven/bun:1.4.2-slim /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run build

FROM node:22-slim AS prod-deps
COPY --from=oven/bun:1.4.2-slim /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends socat && rm -rf /var/lib/apt/lists/*
RUN useradd --system --create-home --uid 10001 carby \
    && mkdir -p /var/run/cabotage \
    && chown carby:carby /var/run/cabotage
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY scripts/serve-production.mjs scripts/migrate.mjs scripts/start-web ./scripts/
COPY postgres ./postgres
RUN chmod +x ./scripts/start-web && chown -R carby:carby /app
USER carby
ENV NODE_ENV=production
EXPOSE 3000
CMD ["./scripts/start-web"]
