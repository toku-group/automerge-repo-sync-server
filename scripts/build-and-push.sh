#!/bin/bash

# Docker Build and Push Script for Automerge Repo Sync Server
# This script builds the Docker container and pushes it to GHCR

set -e  # Exit on any error

# Configuration
REGISTRY="ghcr.io"
REPOSITORY="toku-group/automerge-repo-sync-server"
TAG="dev"
FULL_IMAGE_NAME="${REGISTRY}/${REPOSITORY}:${TAG}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Docker Build and Push Script${NC}"
echo -e "${BLUE}================================${NC}"
echo -e "Registry: ${YELLOW}${REGISTRY}${NC}"
echo -e "Repository: ${YELLOW}${REPOSITORY}${NC}"
echo -e "Tag: ${YELLOW}${TAG}${NC}"
echo -e "Full Image: ${YELLOW}${FULL_IMAGE_NAME}${NC}"
echo ""

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}❌ Error: Docker is not running${NC}"
    exit 1
fi

# Check if user is logged in to GHCR
echo -e "${BLUE}🔐 Checking GHCR authentication...${NC}"
if ! docker system info | grep -q "ghcr.io"; then
    echo -e "${YELLOW}⚠️  You may need to login to GHCR. Run:${NC}"
    echo -e "${YELLOW}   echo \$GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin${NC}"
    echo ""
fi

# Build the Docker image
echo -e "${BLUE}🔨 Building Docker image...${NC}"
docker build -t "${FULL_IMAGE_NAME}" .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Docker image built successfully${NC}"
else
    echo -e "${RED}❌ Docker build failed${NC}"
    exit 1
fi

# Tag the image with latest as well
echo -e "${BLUE}🏷️  Tagging image...${NC}"
docker tag "${FULL_IMAGE_NAME}" "${REGISTRY}/${REPOSITORY}:latest"

# Push the image to GHCR
echo -e "${BLUE}📤 Pushing image to GHCR...${NC}"
docker push "${FULL_IMAGE_NAME}"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Image pushed successfully to ${FULL_IMAGE_NAME}${NC}"
else
    echo -e "${RED}❌ Failed to push image${NC}"
    exit 1
fi

# Also push latest tag
echo -e "${BLUE}📤 Pushing latest tag...${NC}"
docker push "${REGISTRY}/${REPOSITORY}:latest"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Latest tag pushed successfully${NC}"
else
    echo -e "${YELLOW}⚠️  Failed to push latest tag (this is optional)${NC}"
fi

# Show image details
echo ""
echo -e "${GREEN}🎉 Build and push completed successfully!${NC}"
echo -e "${BLUE}Image Details:${NC}"
echo -e "  • Name: ${YELLOW}${FULL_IMAGE_NAME}${NC}"
echo -e "  • Size: ${YELLOW}$(docker images --format "table {{.Size}}" ${FULL_IMAGE_NAME} | tail -1)${NC}"
echo -e "  • Created: ${YELLOW}$(docker images --format "table {{.CreatedAt}}" ${FULL_IMAGE_NAME} | tail -1)${NC}"

echo ""
echo -e "${BLUE}📋 To run the container locally:${NC}"
echo -e "${YELLOW}   docker run -p 80:80 ${FULL_IMAGE_NAME}${NC}"

echo ""
echo -e "${BLUE}📋 To pull and run from GHCR:${NC}"
echo -e "${YELLOW}   docker pull ${FULL_IMAGE_NAME}${NC}"
echo -e "${YELLOW}   docker run -p 80:80 ${FULL_IMAGE_NAME}${NC}"