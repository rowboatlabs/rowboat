#!/bin/bash

echo "Starting cleanup of Kubernetes resources..."

# Delete all deployments
echo "Deleting deployments..."
kubectl delete deployment rowboat
kubectl delete deployment rowboat-agents
kubectl delete deployment copilot
kubectl delete deployment docs
kubectl delete deployment redis
#kubectl delete deployment mongodb

# Delete all secrets
echo "Deleting secrets..."
kubectl delete secret app-secrets
kubectl delete secret openai-secret

# Delete all configmaps
echo "Deleting configmaps..."
kubectl delete configmap app-config

# Wait for pods to terminate
echo "Waiting for pods to terminate..."
while kubectl get pods | grep -q "Terminating"; do
  echo "Pods still terminating..."
  sleep 5
done

echo "Cleanup complete!" 
