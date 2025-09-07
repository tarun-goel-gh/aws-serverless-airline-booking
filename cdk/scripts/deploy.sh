#!/bin/bash

# AWS Serverless Airline Booking - CDK Deployment Script
# This script handles the complete deployment of the migrated application

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
STAGE=${1:-dev}
REGION=${AWS_DEFAULT_REGION:-us-east-1}
ACCOUNT=${CDK_DEFAULT_ACCOUNT}

echo -e "${BLUE}🚀 Starting AWS Serverless Airline Booking CDK Deployment${NC}"
echo -e "${BLUE}Stage: ${STAGE}${NC}"
echo -e "${BLUE}Region: ${REGION}${NC}"
echo -e "${BLUE}Account: ${ACCOUNT}${NC}"

# Check prerequisites
check_prerequisites() {
    echo -e "\n${YELLOW}📋 Checking prerequisites...${NC}"
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        echo -e "${RED}❌ AWS CLI not found. Please install AWS CLI.${NC}"
        exit 1
    fi
    
    # Check CDK CLI
    if ! command -v cdk &> /dev/null; then
        echo -e "${RED}❌ CDK CLI not found. Please install: npm install -g aws-cdk${NC}"
        exit 1
    fi
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js not found. Please install Node.js 18+${NC}"
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        echo -e "${RED}❌ AWS credentials not configured. Please run 'aws configure'${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ All prerequisites met${NC}"
}

# Install dependencies
install_dependencies() {
    echo -e "\n${YELLOW}📦 Installing dependencies...${NC}"
    npm install
    echo -e "${GREEN}✅ Dependencies installed${NC}"
}

# Build TypeScript
build_project() {
    echo -e "\n${YELLOW}🔨 Building TypeScript...${NC}"
    npm run build
    echo -e "${GREEN}✅ Build completed${NC}"
}

# Bootstrap CDK (if needed)
bootstrap_cdk() {
    echo -e "\n${YELLOW}🏗️  Checking CDK bootstrap...${NC}"
    
    # Check if already bootstrapped
    if aws cloudformation describe-stacks --stack-name CDKToolkit --region "$REGION" &> /dev/null; then
        echo -e "${GREEN}✅ CDK already bootstrapped${NC}"
    else
        echo -e "${YELLOW}Bootstrapping CDK...${NC}"
        cdk bootstrap "aws://$ACCOUNT/$REGION"
        echo -e "${GREEN}✅ CDK bootstrapped${NC}"
    fi
}

# Deploy stacks in order
deploy_stacks() {
    echo -e "\n${YELLOW}🚀 Deploying stacks...${NC}"
    
    # Core stack first
    echo -e "\n${BLUE}Deploying Core Stack...${NC}"
    cdk deploy ServerlessAirline-Core-$STAGE --require-approval never --context stage=$STAGE
    
    # Backend services (can be deployed in parallel)
    echo -e "\n${BLUE}Deploying Catalog Stack...${NC}"
    cdk deploy ServerlessAirline-Catalog-$STAGE --require-approval never --context stage=$STAGE
    
    echo -e "\n${BLUE}Deploying Payment Stack...${NC}"
    cdk deploy ServerlessAirline-Payment-$STAGE --require-approval never --context stage=$STAGE
    
    echo -e "\n${BLUE}Deploying Loyalty Stack...${NC}"
    cdk deploy ServerlessAirline-Loyalty-$STAGE --require-approval never --context stage=$STAGE
    
    # Booking stack (depends on payment and loyalty)
    echo -e "\n${BLUE}Deploying Booking Stack...${NC}"
    cdk deploy ServerlessAirline-Booking-$STAGE --require-approval never --context stage=$STAGE
    
    # Frontend stack (depends on core and payment)
    echo -e "\n${BLUE}Deploying Frontend Stack...${NC}"
    cdk deploy ServerlessAirline-Frontend-$STAGE --require-approval never --context stage=$STAGE
    
    echo -e "${GREEN}✅ All stacks deployed successfully${NC}"
}

# Get deployment outputs
get_outputs() {
    echo -e "\n${YELLOW}📋 Getting deployment outputs...${NC}"
    
    # Get key outputs
    USER_POOL_ID=$(aws cloudformation describe-stacks \
        --stack-name ServerlessAirline-Core-$STAGE \
        --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
        --output text --region $REGION)
    
    GRAPHQL_URL=$(aws cloudformation describe-stacks \
        --stack-name ServerlessAirline-Core-$STAGE \
        --query "Stacks[0].Outputs[?OutputKey=='GraphQLApiUrl'].OutputValue" \
        --output text --region $REGION)
    
    FRONTEND_URL=$(aws cloudformation describe-stacks \
        --stack-name ServerlessAirline-Frontend-$STAGE \
        --query "Stacks[0].Outputs[?OutputKey=='FrontendUrl'].OutputValue" \
        --output text --region $REGION)
    
    echo -e "\n${GREEN}🎉 Deployment Complete!${NC}"
    echo -e "${GREEN}===========================================${NC}"
    echo -e "${GREEN}User Pool ID: ${USER_POOL_ID}${NC}"
    echo -e "${GREEN}GraphQL API: ${GRAPHQL_URL}${NC}"
    echo -e "${GREEN}Frontend URL: ${FRONTEND_URL}${NC}"
    echo -e "${GREEN}===========================================${NC}"
}

# Post-deployment configuration
post_deployment_config() {
    echo -e "\n${YELLOW}⚙️  Post-deployment configuration...${NC}"
    
    echo -e "${YELLOW}📝 Next steps:${NC}"
    echo -e "1. Update Stripe keys in SSM Parameter Store:"
    echo -e "   aws ssm put-parameter --name '/$STAGE/service/payment/stripe/secretKey' --value 'sk_test_...' --type 'SecureString' --overwrite"
    echo -e "   aws ssm put-parameter --name '/$STAGE/service/payment/stripe/publicKey' --value 'pk_test_...' --type 'String' --overwrite"
    echo -e ""
    echo -e "2. Create a test user:"
    echo -e "   aws cognito-idp admin-create-user --user-pool-id $USER_POOL_ID --username testuser --temporary-password 'TempPass123!' --message-action SUPPRESS"
    echo -e ""
    echo -e "3. Test the application at: $FRONTEND_URL"
    echo -e ""
    echo -e "4. Monitor logs:"
    echo -e "   aws logs tail /aws/lambda/ServerlessAirline-ReserveBooking-$STAGE --follow"
}

# Main execution
main() {
    check_prerequisites
    install_dependencies
    build_project
    bootstrap_cdk
    deploy_stacks
    get_outputs
    post_deployment_config
    
    echo -e "\n${GREEN}🎉 Deployment completed successfully!${NC}"
}

# Check for help flag
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    echo "Usage: $0 [STAGE]"
    echo "Deploy AWS Serverless Airline Booking CDK stacks"
    exit 0
fi

# Run main function
main