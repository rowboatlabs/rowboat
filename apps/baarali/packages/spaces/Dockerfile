# Harbor, the Spaces server, as Baarali hosts it (decided 02/10/2026).
# Build context = repo root:
#   fly deploy --config apps/baarali/packages/spaces/fly.toml \
#     --dockerfile apps/baarali/packages/spaces/Dockerfile --remote-only .
#
# Harbor stays the upstream's code: its pages and a new team's first file
# are branded on this copy only (desktop/scripts/brand.mjs --only harbor).
# Runtime env: fly.toml for the public settings; secrets DATABASE_URL (Neon)
# and the Tigris keys (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY), set by
# `fly storage create`.

FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /src
COPY apps/harbor/package.json apps/harbor/pnpm-lock.yaml apps/harbor/pnpm-workspace.yaml apps/harbor/tsconfig.base.json apps/harbor/
COPY apps/harbor/packages/protocol/package.json apps/harbor/packages/protocol/
COPY apps/harbor/packages/server/package.json apps/harbor/packages/server/
RUN cd apps/harbor && pnpm install --frozen-lockfile
COPY apps/harbor/packages apps/harbor/packages
COPY apps/baarali/packages/desktop/scripts/brand.mjs apps/baarali/packages/desktop/scripts/brand.mjs
COPY apps/baarali/packages/spaces/src/pages.ts apps/baarali/packages/spaces/src/pages.ts
RUN node apps/baarali/packages/desktop/scripts/brand.mjs --yes --only harbor \
 && cd apps/harbor && pnpm build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /harbor
COPY --from=build /src/apps/harbor ./
EXPOSE 4272
CMD ["node", "packages/server/dist/main.js"]
