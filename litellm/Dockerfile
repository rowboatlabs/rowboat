# Use Python 3.11 slim image for ARM64
FROM --platform=linux/arm64 python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages
RUN pip install --no-cache-dir litellm[proxy] prisma

# Create directory for custom handler
RUN mkdir -p /app/custom_handlers

# Copy custom handler
COPY handler/custom_handler.py /app/custom_handlers/
RUN touch /app/custom_handlers/__init__.py

# Copy config and schema
COPY config.yaml /app/
COPY schema.prisma /app/

# Set environment variables
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# Expose the port
EXPOSE 4000

# Run LiteLLM
CMD ["litellm", "--config", "/app/config.yaml"] 