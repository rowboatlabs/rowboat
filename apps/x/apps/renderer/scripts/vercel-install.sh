#!/bin/sh
# The Spaces web app's install on Vercel (vercel.json; WEB.md). A script
# because Vercel caps installCommand at 256 characters (2026-10-12).
# Harbor's protocol package first (the renderer links it), then only the
# renderer's slice of this workspace, without Electron's binary.
# pnpm is pinned: the lockfile is outside the project's root directory.
set -e
cd ../../../harbor
npx -y pnpm@10 install --frozen-lockfile --filter @rowboat/spaces-protocol
npx -y pnpm@10 --filter @rowboat/spaces-protocol run build
cd ../x
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npx -y pnpm@10 install --frozen-lockfile --filter '@x/renderer...'
