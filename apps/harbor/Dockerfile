# Harbor — the spaces server.
# Build context = apps/harbor (set Root Directory to apps/harbor on Render).
#
# Runtime env (see packages/server/src/main.ts):
#   DATABASE_URL  HARBOR_ADDRESS (the public host)  AUTH_ISSUER
#   HARBOR_NAME (optional; the server's name on the login page)
#   AUTH_PUBLISHABLE_KEY (consent page)  PORT (set by the platform)
#   DATABASE_POOL_MAX (optional; pg pool ceiling, default 10)
#   HARBOR_WEB_ORIGINS (optional; comma-separated browser origins allowed to
#     call Harbor cross-origin — the Spaces web app's)
#   HARBOR_WEB_APP_URL (optional; the Spaces web app, e.g.
#     https://spaces.rowboatlabs.com — a Spaces link opened in a browser offers
#     it beside the desktop app; without it, only the desktop app)
#   HARBOR_INTERNAL_KEY (optional; bearer for GET /internal/stats — this
#     instance's live counters; the once-a-minute log line prints regardless)
#   HARBOR_INTEGRATION_KEY (optional; 64 hex characters, `openssl rand -hex 32`,
#     sealing platform agents' keys such as Replicas's, Agent37's and Conductor's — without it, such
#     agents can't be added. Rotate with HARBOR_INTEGRATION_KEY_ID and
#     HARBOR_INTEGRATION_PREVIOUS_KEYS, a JSON map of old ids to old keys)
#   HARBOR_MARITIME_API_KEY (optional; Rowboat's Maritime key — with it the
#     app offers agents Rowboat runs) HARBOR_MARITIME_LLM_CAP_CENTS (the
#     trial's monthly cap) HARBOR_MARITIME_IDLE_SECONDS (how long a VM stays awake)
#   HARBOR_BILLING_URL and HARBOR_BILLING_KEY (optional, both or neither;
#     rowboatx-backend's origin and internal key — with them agents Rowboat
#     runs bill to their owners' Rowboat plans and there is no trial)
#     HARBOR_BILLING_ISSUER (the issuer whose subjects are Rowboat accounts)
#     HARBOR_BILLING_UPGRADE_URL (else the backend's own app address)

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
