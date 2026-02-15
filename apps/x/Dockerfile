FROM node:22-slim

# Install system dependencies if needed (e.g. for native modules)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Enable pnpm
RUN corepack enable

WORKDIR /app

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy packages
COPY apps/server ./apps/server
COPY packages/core ./packages/core
COPY packages/shared ./packages/shared
# Note: we skip apps/main, apps/renderer, apps/preload as they are Electron-specific

# Install dependencies (skipping Electron devDeps if possible, but they are in root)
# We might need to ignore scripts or optional deps
RUN pnpm install --frozen-lockfile

# Build dependencies in order
WORKDIR /app/packages/shared
RUN npm run build

WORKDIR /app/packages/core
RUN npm run build

WORKDIR /app/apps/server
RUN npm run build

WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# The app uses ~/.rowboat for storage by default.
# In Docker, we should probably mount a volume or set HOME.
# Let's verify if we need to override the path via env var, but the code hardcodes path.join(homedir(), ".rowboat")
# So setting HOME=/data should work, provided we create the dir.
ENV HOME=/data
RUN mkdir -p /data/.rowboat

VOLUME /data/.rowboat

CMD ["node", "apps/server/dist/main.js"]
