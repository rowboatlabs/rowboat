#!/bin/bash
set -e

# build rowboatx next.js app
(cd apps/rowboatx && \
    npm install && \
    npm run build)

# build rowboat server
(cd apps/cli && \
    npm install && \
    npm run build)