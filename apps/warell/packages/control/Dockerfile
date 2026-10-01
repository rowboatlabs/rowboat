# The Warell control plane (architecture §3.5, roadmap phase 0).
# Build context = repo root:
#   fly deploy --config apps/warell/packages/control/fly.toml \
#     --dockerfile apps/warell/packages/control/Dockerfile .
#
# Runtime env: OPENROUTER_API_KEY, WARELL_INSTANCE_TOKEN (secrets),
# WARELL_PUBLIC_URL, WARELL_PLAN_ID.

FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /src

COPY apps/harbor/package.json apps/harbor/pnpm-lock.yaml apps/harbor/pnpm-workspace.yaml apps/harbor/tsconfig.base.json apps/harbor/
COPY apps/harbor/packages/protocol apps/harbor/packages/protocol
COPY apps/harbor/packages/server/package.json apps/harbor/packages/server/
RUN cd apps/harbor && pnpm install --frozen-lockfile --filter @rowboat/spaces-protocol \
 && pnpm --filter @rowboat/spaces-protocol build

# Only @x/shared: the control plane reads its schemas and constants.
COPY apps/x apps/x
RUN cd apps/x && pnpm install --frozen-lockfile --filter @x/shared \
 && (cd packages/shared && npm run build)

COPY apps/warell/package.json apps/warell/pnpm-lock.yaml apps/warell/pnpm-workspace.yaml apps/warell/tsconfig.base.json apps/warell/
COPY apps/warell/packages/control apps/warell/packages/control
COPY apps/warell/packages/instance/package.json apps/warell/packages/instance/
RUN cd apps/warell && pnpm install --frozen-lockfile --filter @warell/control \
 && pnpm --filter @warell/control build

# No prune: links into apps/x and apps/harbor must survive. Correct beats small.
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /src
COPY --from=build /src ./
EXPOSE 8080
CMD ["node", "apps/warell/packages/control/dist/main.js"]
