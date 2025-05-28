# Use official Python runtime as base image
FROM python:3.12-slim

# Set working directory in container
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install poetry with specific version
RUN curl -sSL https://install.python-poetry.org | python3 - --version 1.7.1

# Add poetry to PATH
ENV PATH="/root/.local/bin:$PATH"

# Copy poetry files
COPY pyproject.toml poetry.lock ./

# Configure poetry
RUN poetry config virtualenvs.create false \
    && poetry config installer.max-workers 10

# Regenerate lock file and install dependencies
RUN poetry lock --no-update \
    && poetry install --no-interaction --no-ansi --no-root -v

# Copy project files
COPY . .

# Install the project with verbose output
RUN poetry install --no-interaction --no-ansi -v

# Set environment variables
ENV QUART_APP=src.app.main
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Command to run Flask development server
CMD ["quart", "run", "--host=0.0.0.0", "--port=3001"]
