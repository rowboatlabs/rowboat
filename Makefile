# Ensure data directories exist
.PHONY: ensure-dirs
ensure-dirs:
	mkdir -p data/uploads
	mkdir -p data/qdrant
	mkdir -p data/mongo

# Set environment variables
.PHONY: set-env
set-env:
	export USE_RAG=true
	export USE_RAG_UPLOADS=true
	@if [ -n "$$COMPOSIO_API_KEY" ]; then \
		export USE_COMPOSIO_TOOLS=true; \
	fi
	export USE_KLAVIS_TOOLS=true

# Run the Docker Compose command
.PHONY: start
start: ensure-dirs set-env
	@CMD="docker compose"; \
	CMD="$$CMD --profile setup_qdrant"; \
	CMD="$$CMD --profile qdrant"; \
	CMD="$$CMD --profile rag-worker"; \
	CMD="$$CMD up --build"; \
	echo "Running: $$CMD"; \
	eval $$CMD