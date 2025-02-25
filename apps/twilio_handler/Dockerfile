FROM python:3.12-slim

WORKDIR /app

# Copy requirements first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Set environment variables
ENV FLASK_APP=app
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Command to run Flask development server
CMD ["flask", "run", "--host=0.0.0.0", "--port=4010"]