#!/bin/bash

# Apply all configurations
kubectl apply -f app-config.yaml
kubectl apply -f app-secrets.yaml
kubectl apply -f openai-secret.yaml
kubectl apply -f copilot-deployment.yaml
kubectl apply -f mongodb-vpc.yaml
kubectl apply -f mongodb-deployment.yaml
kubectl apply -f redis-deployment.yaml
kubectl apply -f rowboat-agents-go-deployment.yaml
kubectl apply -f rowboat-deployment.yaml

# Wait for 2 seconds before starting restarts
sleep 2

# Restart deployments with delays between each
echo "Restarting redis deployment..."
kubectl rollout restart deployment/redis
sleep 2

echo "Restarting rowboat-agents deployment..."
kubectl rollout restart deployment/rowboat-agents
sleep 2

echo "Restarting copilot deployment..."
kubectl rollout restart deployment/copilot
sleep 2

echo "Restarting rowboat deployment..."
kubectl rollout restart deployment/rowboat 