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

# Expose port if your app needs it (adjust as needed)
ENV FLASK_APP=app
ENV PYTHONUNBUFFERED=1

# Command to run Flask development server
CMD ["flask", "run", "--host=0.0.0.0", "--port=3002"]
