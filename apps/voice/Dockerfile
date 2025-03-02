FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Debug: List files in /app
RUN ls -la /app

# Set environment variables
ENV PYTHONPATH=/app

# Expose the port the app runs on
EXPOSE 3009

# Command to run the application directly with Python
CMD ["python", "twilio_server.py"] 