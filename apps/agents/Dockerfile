# Use official Python runtime as base image
FROM python:3.12-slim

# Set working directory in container
WORKDIR /app

# Copy requirements file
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Set environment variables
ENV FLASK_APP=src.app.main
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Command to run Flask development server
CMD ["flask", "run", "--host=0.0.0.0", "--port=3001"]
