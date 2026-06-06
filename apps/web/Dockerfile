# clip.al web — multi-stage build producing a Next.js standalone server.
# Build context is the repo root (see infra/docker-compose.yml).

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps + build ----------------------------------------------------------
FROM base AS build
# Manifests first for layer caching.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile

# Placeholder env so `next build` can evaluate server modules (config validates
# at import, and in production it REQUIRES TURNSTILE_SECRET_KEY + GSB_API_KEY).
# These are build-only — they live in this stage, never the runner stage, and the
# standalone server re-reads process.env from the container's real env at start.
# SESSION_SECRET must be valid hex (≥64 chars); the others just need to be present.
ENV NODE_ENV=production \
    APP_URL=https://clip.al \
    COOKIE_DOMAIN=clip.al \
    SESSION_SECRET=0000000000000000000000000000000000000000000000000000000000000000 \
    DATABASE_URL=postgres://user:pass@localhost:5432/db \
    REDIS_URL=redis://localhost:6379 \
    CLICKHOUSE_URL=http://localhost:8123 \
    S3_ENDPOINT=http://localhost:9000 \
    S3_PUBLIC_URL=https://cdn.clip.al \
    TURNSTILE_SECRET_KEY=build-placeholder \
    GSB_API_KEY=build-placeholder
RUN pnpm --filter @clipal/web build

# ---- runtime ---------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production PORT=3000
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Next standalone bundles a pruned node_modules + server.js (monorepo-aware paths).
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
