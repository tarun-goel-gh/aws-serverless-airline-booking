#!/bin/bash

# Preparation script for CDK deployment
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔧 Preparing CDK deployment...${NC}"

# Set environment variables
echo -e "\n${YELLOW}🌍 Setting environment variables...${NC}"
if [ -z "$CDK_DEFAULT_ACCOUNT" ] && [ -z "$AWS_ACCOUNT_ID" ]; then
    export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
    if [ -n "$CDK_DEFAULT_ACCOUNT" ]; then
        echo -e "${GREEN}✅ CDK_DEFAULT_ACCOUNT set to: $CDK_DEFAULT_ACCOUNT${NC}"
    else
        echo -e "${RED}❌ Failed to get AWS Account ID. Please configure AWS CLI.${NC}"
        exit 1
    fi
fi

# Build Loyalty TypeScript
echo -e "\n${YELLOW}🔨 Building Loyalty TypeScript...${NC}"
cd ../src/backend/loyalty
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Loyalty package.json not found${NC}"
    exit 1
fi

npm install
npm run build

if [ -d "build" ]; then
    echo -e "${GREEN}✅ Loyalty build completed${NC}"
else
    echo -e "${RED}❌ Loyalty build failed${NC}"
    exit 1
fi

# Build Frontend (optional - can be skipped for backend-only deployment)
echo -e "\n${YELLOW}🔨 Building Frontend...${NC}"
cd ../frontend

if [ ! -f "package.json" ]; then
    echo -e "${YELLOW}⚠️  Frontend package.json not found, skipping frontend build${NC}"
else
    # Check if dependencies are installed
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}📦 Installing frontend dependencies...${NC}"
        npm install
    fi
    
    # Build frontend
    npm run build
    
    if [ -d "dist/spa" ]; then
        echo -e "${GREEN}✅ Frontend build completed${NC}"
    else
        echo -e "${YELLOW}⚠️  Frontend build may have issues, but continuing...${NC}"
    fi
fi

# Return to CDK directory
cd ../../cdk

# Install CDK dependencies
echo -e "\n${YELLOW}📦 Installing CDK dependencies...${NC}"
npm install

# Build CDK TypeScript
echo -e "\n${YELLOW}🔨 Building CDK TypeScript...${NC}"
npm run build

echo -e "\n${GREEN}✅ Preparation completed successfully!${NC}"
echo -e "${BLUE}You can now run: ./scripts/deploy.sh${NC}"