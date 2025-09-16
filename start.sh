#!/bin/bash

# ensure data dirs exist
mkdir -p data/uploads
mkdir -p data/qdrant
mkdir -p data/mongo

# set the following environment variables
export USE_RAG=true
export USE_RAG_UPLOADS=true

# enable composio tools if API key is set
if [ -n "$COMPOSIO_API_KEY" ]; then
  export USE_COMPOSIO_TOOLS=true
fi

# always show klavis tools, even if API key is not set
export USE_KLAVIS_TOOLS=true

# # enable klavis tools if API key is set
# if [ -n "$KLAVIS_API_KEY" ]; then
#   export USE_KLAVIS_TOOLS=true
# fi

# default to disabling auth if not explicitly enabled
export USE_AUTH="${USE_AUTH:-false}"

# provide dummy auth0 env vars if missing (to silence build-time warnings)
# Note: app/lib/auth0.ts expects AUTH0_ISSUER_BASE_URL and AUTH0_BASE_URL
export AUTH0_ISSUER_BASE_URL="${AUTH0_ISSUER_BASE_URL:-${AUTH0_DOMAIN:-test}}"
export AUTH0_CLIENT_ID="${AUTH0_CLIENT_ID:-test}"
export AUTH0_BASE_URL="${AUTH0_BASE_URL:-${APP_BASE_URL:-test}}"
export AUTH0_SECRET="${AUTH0_SECRET:-test}"
export AUTH0_CLIENT_SECRET="${AUTH0_CLIENT_SECRET:-test}"

# Start with the base command and profile flags
CMD="docker compose"
CMD="$CMD --profile setup_qdrant"
CMD="$CMD --profile qdrant"
CMD="$CMD --profile rag-worker"

# Add more mappings as needed
# if [ "$SOME_OTHER_ENV" = "true" ]; then
#   CMD="$CMD --profile some_other_profile"
# fi

# Add the up and build flags at the end
CMD="$CMD up --build"

echo "Running: $CMD"
exec $CMD
