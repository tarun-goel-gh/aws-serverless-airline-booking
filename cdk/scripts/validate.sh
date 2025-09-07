#!/bin/bash

# Validation script for CDK deployment readiness
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🔍 Validating CDK deployment readiness...${NC}"

# Check Lambda source directories
LAMBDA_DIRS=(
    "../src/backend/booking/src/reserve-booking"
    "../src/backend/booking/src/confirm-booking"
    "../src/backend/booking/src/cancel-booking"
    "../src/backend/booking/src/notify-booking"
    "../src/backend/catalog/src/reserve-flight"
    "../src/backend/catalog/src/release-flight"
    "../src/backend/payment/src/collect-payment"
    "../src/backend/payment/src/refund-payment"
    "../src/backend/shared/libs"
)

echo -e "\n${YELLOW}📁 Checking Lambda source directories...${NC}"
for dir in "${LAMBDA_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        echo -e "${GREEN}✅ $dir${NC}"
    else
        echo -e "${RED}❌ $dir (missing)${NC}"
        MISSING_DIRS=true
    fi
done

# Check Loyalty build directories
echo -e "\n${YELLOW}📁 Checking Loyalty build directories...${NC}"
LOYALTY_DIRS=(
    "../src/backend/loyalty/build/get"
    "../src/backend/loyalty/build/ingest"
)

for dir in "${LOYALTY_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        echo -e "${GREEN}✅ $dir${NC}"
    else
        echo -e "${YELLOW}⚠️  $dir (needs build)${NC}"
        NEEDS_BUILD=true
    fi
done

# Check frontend build
echo -e "\n${YELLOW}📁 Checking frontend build...${NC}"
if [ -d "../src/frontend/dist/spa" ]; then
    echo -e "${GREEN}✅ Frontend build exists${NC}"
else
    echo -e "${YELLOW}⚠️  Frontend needs build${NC}"
    NEEDS_FRONTEND_BUILD=true
fi

# Check required files
echo -e "\n${YELLOW}📄 Checking required files...${NC}"
REQUIRED_FILES=(
    "./schema.graphql"
    "./package.json"
    "./tsconfig.json"
    "./cdk.json"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✅ $file${NC}"
    else
        echo -e "${RED}❌ $file (missing)${NC}"
        MISSING_FILES=true
    fi
done

# Check environment variables
echo -e "\n${YELLOW}🌍 Checking environment variables...${NC}"
if [ -n "$CDK_DEFAULT_ACCOUNT" ] || [ -n "$AWS_ACCOUNT_ID" ]; then
    echo -e "${GREEN}✅ AWS Account ID configured${NC}"
else
    echo -e "${YELLOW}⚠️  CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID not set${NC}"
    MISSING_ENV=true
fi

if [ -n "$CDK_DEFAULT_REGION" ] || [ -n "$AWS_DEFAULT_REGION" ]; then
    echo -e "${GREEN}✅ AWS Region configured${NC}"
else
    echo -e "${GREEN}✅ AWS Region will default to us-east-1${NC}"
fi

# Summary and recommendations
echo -e "\n${YELLOW}📋 Validation Summary:${NC}"

if [ "$MISSING_DIRS" = true ]; then
    echo -e "${RED}❌ Missing Lambda source directories${NC}"
    echo -e "   Run: git clone or ensure all source code is present"
fi

if [ "$NEEDS_BUILD" = true ]; then
    echo -e "${YELLOW}⚠️  Loyalty TypeScript needs build${NC}"
    echo -e "   Run: cd ../src/backend/loyalty && npm install && npm run build"
fi

if [ "$NEEDS_FRONTEND_BUILD" = true ]; then
    echo -e "${YELLOW}⚠️  Frontend needs build${NC}"
    echo -e "   Run: cd ../src/frontend && npm install && npm run build"
fi

if [ "$MISSING_ENV" = true ]; then
    echo -e "${YELLOW}⚠️  Set environment variables${NC}"
    echo -e "   Run: export CDK_DEFAULT_ACCOUNT=\$(aws sts get-caller-identity --query Account --output text)"
fi

# Final verdict
if [ "$MISSING_DIRS" = true ] || [ "$MISSING_FILES" = true ]; then
    echo -e "\n${RED}❌ CDK is NOT ready for deployment${NC}"
    exit 1
elif [ "$NEEDS_BUILD" = true ] || [ "$NEEDS_FRONTEND_BUILD" = true ]; then
    echo -e "\n${YELLOW}⚠️  CDK needs preparation before deployment${NC}"
    exit 2
else
    echo -e "\n${GREEN}✅ CDK is ready for deployment!${NC}"
    exit 0
fi