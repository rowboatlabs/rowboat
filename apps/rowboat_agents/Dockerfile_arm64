# Use official Python runtime as base image
FROM python:3.12-slim

# Set working directory in container
WORKDIR /app

# Install poetry
RUN pip install poetry

# Copy poetry files
COPY pyproject.toml poetry.lock ./

# Configure poetry to not create virtual environment in container
RUN poetry config virtualenvs.create false

# Install dependencies
RUN poetry install --no-interaction --no-ansi

# Copy project files
COPY . .

# Set environment variables
ENV QUART_APP=src.app.main
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Command to run Flask development server
CMD ["quart", "run", "--host=0.0.0.0", "--port=3001"]
