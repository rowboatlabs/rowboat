#!/bin/bash

# Set variables
IMAGE_NAME="litellm-proxy"
VERSION="1.0.0"
REGISTRY="stevef1uk"

# Build the image for ARM64
echo "Building image for ARM64..."
docker build --platform linux/arm64 -t ${REGISTRY}/${IMAGE_NAME}:${VERSION} .

# Try to push the image
echo "Pushing image to Docker Hub..."
if ! docker push ${REGISTRY}/${IMAGE_NAME}:${VERSION}; then
    echo "Failed to push image. Please make sure you're logged in to Docker Hub:"
    echo "docker login"
    exit 1
fi

# Also tag as latest
echo "Tagging as latest..."
docker tag ${REGISTRY}/${IMAGE_NAME}:${VERSION} ${REGISTRY}/${IMAGE_NAME}:latest
docker push ${REGISTRY}/${IMAGE_NAME}:latest

echo "Done!" 