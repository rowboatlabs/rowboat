#!/bin/sh
# The Spaces web app's build on Vercel (vercel.json; WEB.md): the two
# workspace packages it imports, then the web entry into dist-web.
set -e
cd ../..
npx -y pnpm@10 --filter @x/shared --filter @x/spaces-client run build
cd apps/renderer
npx -y pnpm@10 run build:web
