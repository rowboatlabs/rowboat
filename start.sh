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
