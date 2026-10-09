# Harbor — the spaces server (deployment mode).
# Build context = apps/harbor (set Root Directory to apps/harbor on Render).
#
# Runtime env (see packages/server/src/main.ts):
#   HARBOR_MODE=deployment  DATABASE_URL  APEX_DOMAIN  AUTH_ISSUER
#   AUTH_PUBLISHABLE_KEY (consent page)  PORT (set by the platform)
#   DATABASE_POOL_MAX (optional; pg pool ceiling, default 10)
#   HARBOR_WEB_ORIGINS (optional; comma-separated browser origins allowed to
#     call the orgs and the apex cross-origin — the Spaces web app's)
#   HARBOR_INTERNAL_KEY (optional; bearer for GET /internal/stats — this
#     instance's live counters; the once-a-minute log line prints regardless)
#   HARBOR_INTEGRATION_KEY (optional; 64 hex characters, `openssl rand -hex 32`,
#     sealing platform agents' keys such as Replicas's, Agent37's and Conductor's — without it, such
#     agents can't be added. Rotate with HARBOR_INTEGRATION_KEY_ID and
#     HARBOR_INTEGRATION_PREVIOUS_KEYS, a JSON map of old ids to old keys)
#   HARBOR_JEV_OPENROUTER_KEY (optional; Rowboat's OpenRouter key, for Jev
#     through OpenRouter's ~typesafe/jev-latest — with it every org
#     gets Jev, the built-in agent that tags whoever a message needs; without
#     it, no Jev is created and an existing one stays idle)

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /harbor
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
# No prune: pnpm's virtual store doesn't survive `prune --prod` intact, and
# the dev deps cost a few MB in an internal image. Correct beats small.
RUN pnpm build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /harbor
COPY --from=build /harbor ./
EXPOSE 4272
CMD ["node", "packages/server/dist/main.js"]
