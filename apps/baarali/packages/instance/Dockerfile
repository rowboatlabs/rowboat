# A Baarali instance: the headless rowboat-server behind the gate
# (architecture §3.1, roadmap phase 0). Build context = repo root:
#   fly deploy --config apps/baarali/packages/instance/fly.toml \
#     --dockerfile apps/baarali/packages/instance/Dockerfile .
#
# Runtime env: BAARALI_INSTANCE_TOKEN (secret), API_URL (the control plane),
# BAARALI_SERVER_KEY (set by the control plane on the instances it creates).

FROM node:22-bookworm AS build
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate \
 && apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src

# 1. Harbor's protocol package: @x/shared links it.
COPY apps/harbor/package.json apps/harbor/pnpm-lock.yaml apps/harbor/pnpm-workspace.yaml apps/harbor/tsconfig.base.json apps/harbor/
COPY apps/harbor/packages/protocol apps/harbor/packages/protocol
COPY apps/harbor/packages/server/package.json apps/harbor/packages/server/
RUN cd apps/harbor && pnpm install --frozen-lockfile --filter @rowboat/spaces-protocol \
 && pnpm --filter @rowboat/spaces-protocol build

# 2. rowboat-server and what it needs, then its self-contained bundle.
COPY apps/x apps/x
RUN cd apps/x && pnpm install --frozen-lockfile --filter "@x/server..." \
 && (cd packages/shared && npm run build) \
 && (cd packages/core && npm run build) \
 && (cd apps/server && npm run build && node scripts/build-headless.mjs) \
 && (cd apps/server/dist-headless && npm install --omit=dev)

# 3. The Baarali launcher and gate.
COPY apps/baarali/package.json apps/baarali/pnpm-lock.yaml apps/baarali/pnpm-workspace.yaml apps/baarali/tsconfig.base.json apps/baarali/
COPY apps/baarali/packages/instance apps/baarali/packages/instance
COPY apps/baarali/packages/control/package.json apps/baarali/packages/control/
RUN cd apps/baarali && pnpm install --frozen-lockfile --filter @baarali/instance \
 && pnpm --filter @baarali/instance build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    ROWBOAT_WORKDIR=/data \
    ROWBOAT_SERVER_ENTRY=/app/server/rowboat-server.cjs \
    PORT=8080
WORKDIR /app
COPY --from=build /src/apps/x/apps/server/dist-headless ./server
COPY --from=build /src/apps/baarali/packages/instance/package.json ./instance/package.json
COPY --from=build /src/apps/baarali/packages/instance/dist ./instance/dist
EXPOSE 8080
CMD ["node", "/app/instance/dist/main.js"]
