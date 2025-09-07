import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface FrontendStackProps extends cdk.StackProps {
  stage: string;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  appsyncApi: appsync.GraphqlApi;
  paymentChargeUrl: string;
}

export class FrontendStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    // S3 Bucket for hosting
    this.bucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `serverless-airline-frontend-${props.stage}-${this.account}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Origin Access Identity for CloudFront
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: `OAI for ${props.stage} frontend`,
    });

    this.bucket.grantRead(originAccessIdentity);

    // CloudFront Distribution
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(this.bucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
          securityHeadersBehavior: {
            contentTypeOptions: { override: true },
            frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
            referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.SAME_ORIGIN, override: true },
            strictTransportSecurity: {
              accessControlMaxAge: cdk.Duration.seconds(31536000),
              includeSubdomains: true,
              override: true,
            },
            xssProtection: { protection: true, modeBlock: true, override: true },
          },
        }),
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enabled: true,
      comment: `${props.stage} Serverless Airline Frontend`,
    });

    // Generate aws-exports.js content
    const awsExports = {
      aws_project_region: this.region,
      aws_cognito_region: this.region,
      aws_user_pools_id: props.userPool.userPoolId,
      aws_user_pools_web_client_id: props.userPoolClient.userPoolClientId,
      oauth: {},
      aws_cognito_username_attributes: ['EMAIL'],
      aws_cognito_social_providers: [],
      aws_cognito_signup_attributes: ['EMAIL'],
      aws_cognito_mfa_configuration: 'OFF',
      aws_cognito_mfa_types: ['SMS'],
      aws_cognito_password_protection_settings: {
        passwordPolicyMinLength: 8,
        passwordPolicyCharacters: [],
      },
      aws_cognito_verification_mechanisms: ['EMAIL'],
      aws_appsync_graphqlEndpoint: props.appsyncApi.graphqlUrl,
      aws_appsync_region: this.region,
      aws_appsync_authenticationType: 'AMAZON_COGNITO_USER_POOLS',
      aws_appsync_apiKey: props.appsyncApi.apiKey || '',
    };

    // Deploy minimal HTML page
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [
        s3deploy.Source.data('index.html', `
<!DOCTYPE html>
<html>
<head>
  <title>AWS Serverless Airline</title>
</head>
<body>
  <h1>AWS Serverless Airline Booking</h1>
  <p>Application deployed successfully!</p>
  <p>GraphQL API: ${props.appsyncApi.graphqlUrl}</p>
  <p>User Pool: ${props.userPool.userPoolId}</p>
</body>
</html>`),
        s3deploy.Source.jsonData('aws-exports.js', {
          content: `const awsmobile = ${JSON.stringify(awsExports, null, 2)};\nexport default awsmobile;`,
        }),
      ],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });

    // SSM Parameters for frontend configuration
    new ssm.StringParameter(this, 'FrontendUrlParameter', {
      parameterName: `/${props.stage}/service/frontend/url`,
      stringValue: `https://${this.distribution.distributionDomainName}`,
    });

    new ssm.StringParameter(this, 'FrontendBucketParameter', {
      parameterName: `/${props.stage}/service/frontend/bucket`,
      stringValue: this.bucket.bucketName,
    });

    // Outputs
    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Frontend URL',
      exportName: `${props.stage}-FrontendUrl`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront Distribution ID',
      exportName: `${props.stage}-CloudFrontDistributionId`,
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: this.bucket.bucketName,
      description: 'Frontend S3 Bucket Name',
      exportName: `${props.stage}-FrontendBucketName`,
    });
  }
}