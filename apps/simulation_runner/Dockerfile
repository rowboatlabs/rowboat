# Use official Python runtime as base image
FROM python:3.11-slim

# Set working directory in container
WORKDIR /app

# Copy requirements file
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Expose port if your app needs it (adjust as needed)
ENV PYTHONUNBUFFERED=1

# Command to run the simulation service
CMD ["python", "service.py"]
