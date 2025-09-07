# AWS Serverless Airline Booking - CDK Implementation

This directory contains the AWS CDK implementation of the Serverless Airline Booking application, migrated from AWS Amplify.

## Architecture

The application is deployed using multiple CDK stacks:

- **CoreStack**: Cognito User Pool, AppSync GraphQL API, DynamoDB tables
- **CatalogStack**: Flight catalog management Lambda functions
- **PaymentStack**: Payment processing Lambda functions (Stripe integration)
- **LoyaltyStack**: Loyalty points system with API Gateway and Lambda
- **BookingStack**: Booking workflow with Step Functions state machine
- **FrontendStack**: S3 + CloudFront hosting for Vue.js frontend

## Key Improvements from Amplify Version

### Security Enhancements
- Updated Python runtime from 3.7 (EOL) to 3.12
- Updated Node.js runtime from 14.x to 20.x
- Added proper security headers in CloudFront
- Enabled encryption at rest for all DynamoDB tables
- Added TTL configuration for DynamoDB tables
- Implemented proper IAM least-privilege access

### Infrastructure as Code
- Complete infrastructure defined in TypeScript CDK
- Proper dependency management between stacks
- Environment-specific deployments
- Automated parameter management via SSM

### Monitoring & Observability
- X-Ray tracing enabled for all Lambda functions
- CloudWatch log retention policies
- Structured logging with AWS Lambda Powertools

## Prerequisites

1. AWS CLI configured with appropriate permissions
2. Node.js 18+ installed
3. AWS CDK CLI installed: `npm install -g aws-cdk`
4. Docker installed (for Lambda bundling)

## Setup

1. Install dependencies:
   ```bash
   cd cdk
   npm install
   ```

2. Bootstrap CDK (first time only):
   ```bash
   cdk bootstrap
   ```

3. Build the TypeScript:
   ```bash
   npm run build
   ```

## Deployment

### Deploy All Stacks
```bash
npm run deploy
```

### Deploy Specific Stack
```bash
cdk deploy ServerlessAirline-Core-dev
```

### Deploy with Context
```bash
cdk deploy --context stage=prod
```

## Configuration

### Environment Variables
Set these environment variables or use CDK context:

- `CDK_DEFAULT_ACCOUNT`: AWS Account ID
- `CDK_DEFAULT_REGION`: AWS Region (default: us-east-1)

### Stripe Configuration
After deployment, update the Stripe keys in SSM Parameter Store:

```bash
aws ssm put-parameter --name "/dev/service/payment/stripe/secretKey" --value "sk_test_..." --type "SecureString" --overwrite
aws ssm put-parameter --name "/dev/service/payment/stripe/publicKey" --value "pk_test_..." --type "String" --overwrite
```

## Frontend Deployment

The frontend is automatically deployed to S3 and CloudFront. To update:

1. Build the frontend:
   ```bash
   cd ../src/frontend
   npm install
   npm run build
   ```

2. Redeploy the frontend stack:
   ```bash
   cd ../../cdk
   cdk deploy ServerlessAirline-Frontend-dev
   ```

## Monitoring

### CloudWatch Dashboards
Access CloudWatch to monitor:
- Lambda function metrics and logs
- DynamoDB table metrics
- Step Functions execution history
- API Gateway metrics

### X-Ray Tracing
View distributed traces in AWS X-Ray console to debug performance issues.

## Security Considerations

### Secrets Management
- Stripe keys stored in SSM Parameter Store (SecureString)
- No hardcoded secrets in code
- IAM roles follow least-privilege principle

### Network Security
- All resources deployed in default VPC with security groups
- CloudFront enforces HTTPS
- API Gateway uses IAM authentication

### Data Protection
- DynamoDB tables encrypted at rest
- S3 buckets encrypted and versioned
- CloudFront enforces security headers

## Troubleshooting

### Common Issues

1. **Permission Denied**: Ensure your AWS credentials have sufficient permissions
2. **Stack Dependencies**: Deploy stacks in order or use `--all` flag
3. **Resource Limits**: Check AWS service quotas if deployment fails

### Logs
Check CloudWatch logs for each Lambda function:
```bash
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/ServerlessAirline"
```

## Cleanup

To destroy all resources:
```bash
npm run destroy
```

Or destroy specific stack:
```bash
cdk destroy ServerlessAirline-Frontend-dev
```

## Migration Notes

### From Amplify to CDK

1. **GraphQL Schema**: Copy from `amplify/backend/api/awsserverlessairline/schema.graphql`
2. **Lambda Code**: Existing Lambda code works with minimal changes
3. **Environment Variables**: Updated to use CDK-managed parameters
4. **Dependencies**: Updated all package versions for security

### Breaking Changes
- Python runtime updated (may require code changes)
- Node.js runtime updated (may require dependency updates)
- Some environment variable names changed

## Development

### Adding New Features
1. Create new constructs in `lib/constructs/`
2. Add to appropriate stack
3. Update dependencies in `bin/app.ts`
4. Test with `cdk diff` before deploying

### Testing
```bash
npm test
```

### Linting
```bash
npm run lint
```