#!/bin/bash

echo "Stopping all kubectl port-forward processes..."
pkill -f "kubectl port-forward"

# Also try to clean up any PID file if it exists
if [ -f port-forwards.pid ]; then
    rm port-forwards.pid
fi

echo "All port forwards have been stopped." 