#!/bin/bash
set -e

# Prepare the frontend and local runtime embedded by the desktop shell.

# Build the RowboatX Next.js frontend.
(cd apps/rowboatx && \
    npm install && \
    npm run build)

# Build the local CLI/runtime service.
(cd apps/cli && \
    npm install && \
    npm run build)
