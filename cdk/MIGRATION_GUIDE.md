# Migration Guide: Amplify to CDK

This guide outlines the migration process from AWS Amplify to AWS CDK for the Serverless Airline Booking application.

## Overview

The migration addresses several critical issues found in the original Amplify implementation:

### Security Issues Resolved
- ✅ Updated Python runtime from 3.7 (EOL) to 3.12
- ✅ Updated Node.js runtime from 14.x to 20.x  
- ✅ Fixed package vulnerabilities in dependencies
- ✅ Added input sanitization for log injection prevention
- ✅ Implemented proper error handling
- ✅ Added TTL configuration for DynamoDB tables
- ✅ Enhanced security headers in CloudFront

### Infrastructure Improvements
- ✅ Complete Infrastructure as Code with CDK
- ✅ Proper dependency management between resources
- ✅ Environment-specific deployments
- ✅ Automated parameter management
- ✅ Enhanced monitoring and observability

## Pre-Migration Checklist

### 1. Backup Current Environment
```bash
# Export Amplify environment
amplify env export --name dev

# Backup DynamoDB tables
aws dynamodb create-backup --table-name Flight-<env> --backup-name flight-backup-$(date +%Y%m%d)
aws dynamodb create-backup --table-name Booking-<env> --backup-name booking-backup-$(date +%Y%m%d)

# Export Cognito users (if needed)
aws cognito-idp list-users --user-pool-id <user-pool-id> > cognito-users-backup.json
```

### 2. Document Current Configuration
```bash
# Get current Amplify configuration
amplify status
amplify env get --name dev

# Document current endpoints
echo "GraphQL Endpoint: $(aws appsync list-graphql-apis --query 'graphqlApis[?name==`awsserverlessairline`].uris.GRAPHQL' --output text)"
echo "User Pool ID: $(aws cognito-idp list-user-pools --max-items 10 --query 'UserPools[?Name==`awsserverlessairline*`].Id' --output text)"
```

## Migration Steps

### Step 1: Prepare CDK Environment

```bash
# Navigate to project root
cd aws-serverless-airline-booking

# Install CDK dependencies
cd cdk
npm install

# Bootstrap CDK (if not done before)
cdk bootstrap

# Build TypeScript
npm run build
```

### Step 2: Update Lambda Code (Address Security Issues)

#### Fix Python Runtime Issues
Update all Python Lambda functions to use Python 3.12 compatible code:

```python
# Update datetime usage (timezone-aware)
from datetime import datetime, timezone

# Before (naive datetime)
created_at = datetime.utcnow().isoformat()

# After (timezone-aware)
created_at = datetime.now(timezone.utc).isoformat()
```

#### Fix Log Injection Issues
Sanitize user input before logging:

```python
import re

def sanitize_for_logging(user_input):
    """Sanitize user input for safe logging"""
    if not isinstance(user_input, str):
        user_input = str(user_input)
    # Remove newlines and control characters
    return re.sub(r'[\r\n\t\x00-\x1f\x7f-\x9f]', '', user_input)

# Before
logger.info(f"Processing booking: {booking_data}")

# After  
logger.info(f"Processing booking: {sanitize_for_logging(booking_data)}")
```

#### Update Package Dependencies
Update `requirements.txt` files:

```txt
# src/backend/shared/libs/src/requirements.txt
requests>=2.32.0  # Fixed security vulnerability
aws-lambda-powertools>=2.0.0
boto3>=1.26.0
```

### Step 3: Deploy Core Infrastructure

```bash
# Deploy core stack first (Cognito, AppSync, DynamoDB)
cdk deploy ServerlessAirline-Core-dev

# Verify deployment
aws cognito-idp list-user-pools --max-items 10
aws appsync list-graphql-apis
aws dynamodb list-tables
```

### Step 4: Migrate Data (if needed)

If you have existing data in Amplify-created tables:

```bash
# Export data from old tables
aws dynamodb scan --table-name Flight-<old-env> --output json > flight-data.json
aws dynamodb scan --table-name Booking-<old-env> --output json > booking-data.json

# Import to new tables (use DynamoDB import/export or custom script)
# Note: Table names will be Flight-dev and Booking-dev in CDK
```

### Step 5: Deploy Backend Services

```bash
# Deploy in dependency order
cdk deploy ServerlessAirline-Catalog-dev
cdk deploy ServerlessAirline-Payment-dev  
cdk deploy ServerlessAirline-Loyalty-dev
cdk deploy ServerlessAirline-Booking-dev
```

### Step 6: Configure Stripe Integration

```bash
# Set Stripe keys in SSM Parameter Store
aws ssm put-parameter \
  --name "/dev/service/payment/stripe/secretKey" \
  --value "sk_test_your_stripe_secret_key" \
  --type "SecureString" \
  --overwrite

aws ssm put-parameter \
  --name "/dev/service/payment/stripe/publicKey" \
  --value "pk_test_your_stripe_public_key" \
  --type "String" \
  --overwrite
```

### Step 7: Update Frontend Configuration

```bash
# Build frontend with updated dependencies
cd ../src/frontend

# Update package.json dependencies
npm audit fix
npm update

# Build frontend
npm run build

# Deploy frontend
cd ../../cdk
cdk deploy ServerlessAirline-Frontend-dev
```

### Step 8: Update DNS (if using custom domain)

```bash
# Get new CloudFront distribution domain
DISTRIBUTION_DOMAIN=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='dev Serverless Airline Frontend'].DomainName" \
  --output text)

echo "Update your DNS to point to: $DISTRIBUTION_DOMAIN"
```

## Post-Migration Verification

### 1. Test Core Functionality

```bash
# Test GraphQL API
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"query": "query { listFlights { items { id departureCity arrivalCity } } }"}' \
  https://YOUR_APPSYNC_ENDPOINT/graphql

# Test Cognito authentication
aws cognito-idp admin-create-user \
  --user-pool-id YOUR_USER_POOL_ID \
  --username testuser \
  --temporary-password TempPass123! \
  --message-action SUPPRESS
```

### 2. Verify Security Improvements

```bash
# Check Lambda runtimes
aws lambda list-functions \
  --query "Functions[?starts_with(FunctionName, 'ServerlessAirline')].Runtime"

# Verify encryption
aws dynamodb describe-table --table-name Flight-dev \
  --query "Table.SSEDescription"

# Check security headers
curl -I https://YOUR_CLOUDFRONT_DOMAIN
```

### 3. Monitor Performance

```bash
# Check X-Ray traces
aws xray get-trace-summaries \
  --time-range-type TimeRangeByStartTime \
  --start-time $(date -d '1 hour ago' -u +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S)

# Monitor CloudWatch metrics
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/ServerlessAirline"
```

## Rollback Plan

If issues occur during migration:

### 1. Quick Rollback to Amplify

```bash
# Revert DNS to old Amplify hosting
# Update frontend to use old API endpoints
# Restore from DynamoDB backups if needed

aws dynamodb restore-table-from-backup \
  --target-table-name Flight-rollback \
  --backup-arn arn:aws:dynamodb:region:account:table/Flight-env/backup/backup-name
```

### 2. Gradual Migration

Consider a blue-green deployment approach:
1. Keep Amplify environment running
2. Deploy CDK to new environment
3. Gradually migrate traffic
4. Decommission Amplify after validation

## Cleanup Old Resources

After successful migration and validation:

```bash
# Delete Amplify environment
amplify delete

# Clean up old CloudFormation stacks
aws cloudformation list-stacks \
  --query "StackSummaries[?contains(StackName, 'amplify')].StackName" \
  --output text

# Delete old S3 buckets (after backing up if needed)
aws s3 ls | grep amplify
```

## Troubleshooting

### Common Issues

1. **Lambda Runtime Errors**
   - Check CloudWatch logs for Python 3.12 compatibility issues
   - Update deprecated boto3 methods
   - Fix timezone-aware datetime usage

2. **Permission Issues**
   - Verify IAM roles have correct permissions
   - Check resource-based policies
   - Ensure cross-stack references work

3. **Frontend Issues**
   - Update aws-exports.js with new endpoints
   - Check CORS configuration
   - Verify Cognito integration

### Monitoring Commands

```bash
# Check deployment status
cdk list
cdk diff

# Monitor logs
aws logs tail /aws/lambda/ServerlessAirline-ReserveBooking-dev --follow

# Check Step Functions
aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:region:account:stateMachine:Airline-ProcessBooking-dev
```

## Performance Optimization

### Post-Migration Optimizations

1. **Lambda Performance**
   - Enable provisioned concurrency for high-traffic functions
   - Optimize memory allocation based on CloudWatch metrics
   - Implement connection pooling for DynamoDB

2. **DynamoDB Optimization**
   - Monitor read/write capacity metrics
   - Optimize GSI usage
   - Implement caching with ElastiCache if needed

3. **Frontend Performance**
   - Enable CloudFront compression
   - Optimize cache policies
   - Implement service worker for offline support

## Security Hardening

### Additional Security Measures

1. **Network Security**
   - Deploy Lambda functions in VPC if needed
   - Implement WAF rules for API Gateway
   - Use VPC endpoints for AWS services

2. **Data Protection**
   - Enable DynamoDB point-in-time recovery
   - Implement field-level encryption for sensitive data
   - Regular security audits with AWS Config

3. **Access Control**
   - Implement fine-grained IAM policies
   - Use Cognito groups for authorization
   - Regular access reviews

This migration guide provides a comprehensive approach to moving from Amplify to CDK while addressing security vulnerabilities and improving infrastructure management.