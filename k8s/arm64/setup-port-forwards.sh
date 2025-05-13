#!/bin/bash

# Function to check if a port is already in use
check_port() {
    if lsof -i :$1 > /dev/null 2>&1; then
        echo "Port $1 is already in use. Please free up this port and try again."
        exit 1
    fi
}

# Check all ports before starting
echo "Checking if ports are available..."
check_port 3000

# Start port forwards in the background
echo "Setting up port forwards..."
kubectl port-forward service/rowboat 3000:3000 &
echo $! > port-forwards.pid


echo "Port forwards are running. You can access:"
echo "- Main UI: http://localhost:3000"
echo ""
echo "To stop the port forwards, run: ./stop-port-forwards.sh" 
