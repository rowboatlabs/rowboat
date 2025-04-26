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
check_port 3001
check_port 3002
check_port 27017

# Start port forwards in the background
echo "Setting up port forwards..."
kubectl port-forward service/rowboat 3000:80 &
echo $! > port-forwards.pid

kubectl port-forward service/rowboat-agents 3001:3001 &
echo $! >> port-forwards.pid

kubectl port-forward service/copilot 3002:3002 &
echo $! >> port-forwards.pid

kubectl port-forward service/mongodb 27017:27017 &
echo $! >> port-forwards.pid

echo "Port forwards are running. You can access:"
echo "- Main UI: http://localhost:3000"
echo "- Playground: http://localhost:3001"
echo "- Copilot: http://localhost:3002"
echo "- MongoDB: localhost:27017"
echo ""
echo "To stop the port forwards, run: ./stop-port-forwards.sh" 