#!/bin/bash

# ensure data dirs exist
mkdir -p data/uploads
mkdir -p data/qdrant
mkdir -p data/mongo

# set the following environment variables
export USE_RAG=true
export USE_RAG_UPLOADS=true

# Start with the base command and profile flags
CMD="docker-compose"
CMD="$CMD --profile setup_qdrant"
CMD="$CMD --profile qdrant"
CMD="$CMD --profile rag_text_worker"
CMD="$CMD --profile rag_files_worker"

# enable rag urls worker
if [ "$USE_RAG_SCRAPING" = "true" ]; then
  CMD="$CMD --profile rag_urls_worker"
fi

# Add more mappings as needed
# if [ "$SOME_OTHER_ENV" = "true" ]; then
#   CMD="$CMD --profile some_other_profile"
# fi

# Add the up and build flags at the end
CMD="$CMD up --build"

echo "Running: $CMD"
exec $CMD
