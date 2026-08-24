# Harbor — the spaces server (deployment mode).
# Build context = apps/harbor (set Root Directory to apps/harbor on Render).
#
# Runtime env (see packages/server/src/main.ts):
#   HARBOR_MODE=deployment  DATABASE_URL  APEX_DOMAIN  AUTH_ISSUER
#   AUTH_PUBLISHABLE_KEY (consent page)  PORT (set by the platform)

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
