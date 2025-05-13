#!/bin/bash

echo "Stopping all kubectl port-forward processes..."
pkill -f "kubectl port-forward"

echo "Stopping processes on port 3000..."
# Find processes using port 3000 and kill them
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Also try to clean up any PID file if it exists
if [ -f port-forwards.pid ]; then
    rm port-forwards.pid
fi

echo "All port forwards and processes on port 3000 have been stopped." 