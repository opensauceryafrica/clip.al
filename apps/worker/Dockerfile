# clip.al worker — runs the TypeScript entry directly with tsx (long-running
# process; no bundling needed). Build context is the repo root.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app ./
# GeoLite2 .mmdb files are provided at runtime via the geoipdata volume (GEOIP_DIR).
EXPOSE 9090
CMD ["pnpm", "--filter", "@clipal/worker", "start"]
