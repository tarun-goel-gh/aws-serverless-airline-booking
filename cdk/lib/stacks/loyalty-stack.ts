import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface LoyaltyStackProps extends cdk.StackProps {
  stage: string;
  appsyncApi: appsync.GraphqlApi;
}

export class LoyaltyStack extends cdk.Stack {
  public readonly bookingTopic: sns.Topic;
  public readonly loyaltyApi: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: LoyaltyStackProps) {
    super(scope, id, props);

    // SNS Topic for booking notifications
    this.bookingTopic = new sns.Topic(this, 'BookingTopic', {
      topicName: `ServerlessAirline-BookingTopic-${props.stage}`,
      displayName: 'Booking Notifications',
    });

    // DynamoDB Table for Loyalty Data
    const loyaltyTable = new dynamodb.Table(this, 'LoyaltyTable', {
      tableName: `Airline-LoyaltyData-${props.stage}`,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      // Add TTL as recommended by security scan
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Add GSI for customer-flag queries
    loyaltyTable.addGlobalSecondaryIndex({
      indexName: 'customer-flag',
      partitionKey: {
        name: 'customerId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'flag',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Lambda Functions (Node.js)
    const ingestFunction = new lambda.Function(this, 'IngestLoyaltyFunction', {
      functionName: `ServerlessAirline-IngestLoyalty-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_20_X, // Updated from nodejs14.x
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../src/backend/loyalty/src/ingest'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        TABLE_NAME: loyaltyTable.tableName,
        STAGE: props.stage,
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    const getLoyaltyFunction = new lambda.Function(this, 'GetLoyaltyFunction', {
      functionName: `ServerlessAirline-GetLoyalty-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../src/backend/loyalty/src/get'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        TABLE_NAME: loyaltyTable.tableName,
        STAGE: props.stage,
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    // Grant DynamoDB permissions
    loyaltyTable.grantReadWriteData(ingestFunction);
    loyaltyTable.grantReadData(getLoyaltyFunction);

    // SNS Subscription for ingest function
    this.bookingTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(ingestFunction, {
        filterPolicy: {
          'Booking.Status': sns.SubscriptionFilter.stringFilter({
            allowlist: ['confirmed'],
          }),
        },
      })
    );

    // API Gateway
    this.loyaltyApi = new apigateway.RestApi(this, 'LoyaltyApi', {
      restApiName: `Airline-Loyalty-${props.stage}`,
      description: 'Loyalty service API',
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date'],
      },
      cloudWatchRole: true,
    });

    // API Gateway IAM Authorizer
    const apiRole = new iam.Role(this, 'ApiGatewayRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs'),
      ],
    });

    // Loyalty resource and method
    const loyaltyResource = this.loyaltyApi.root.addResource('loyalty');
    const customerResource = loyaltyResource.addResource('{customerId}');

    customerResource.addMethod('GET', new apigateway.LambdaIntegration(getLoyaltyFunction), {
      authorizationType: apigateway.AuthorizationType.IAM,
      requestParameters: {
        'method.request.path.customerId': true,
      },
    });

    // AppSync HTTP Data Source for Loyalty API
    const loyaltyApiRole = new iam.Role(this, 'AppSyncLoyaltyApiRole', {
      assumedBy: new iam.ServicePrincipal('appsync.amazonaws.com'),
      inlinePolicies: {
        LoyaltyApiInvoke: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['execute-api:Invoke'],
              resources: [`${this.loyaltyApi.arnForExecuteApi()}/*/*/*`],
            }),
          ],
        }),
      },
    });

    const loyaltyApiDataSource = new appsync.HttpDataSource(this, 'LoyaltyApiDataSource', {
      api: props.appsyncApi,
      endpoint: this.loyaltyApi.url,
      name: 'LoyaltyRestApi',
      description: 'Loyalty REST API Gateway',
      authorizationConfig: {
        signingRegion: this.region,
        signingServiceName: 'execute-api',
      },
    });

    loyaltyApiDataSource.node.addDependency(loyaltyApiRole);

    // AppSync Resolver for getLoyalty
    new appsync.Resolver(this, 'GetLoyaltyResolver', {
      api: props.appsyncApi,
      typeName: 'Query',
      fieldName: 'getLoyalty',
      dataSource: loyaltyApiDataSource,
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        #set( $customer = $util.defaultIfNull($ctx.args.customer, $ctx.identity.claims.get("sub")) )
        
        ## Authorization checks
        #set( $userGroups = $util.defaultIfNull($ctx.identity.claims.get("cognito:groups"), []) )
        #set( $allowedGroups = ["Admin"] )
        #set($isStaticGroupAuthorized = $util.defaultIfNull($isStaticGroupAuthorized, false))
        #foreach( $userGroup in $userGroups )
          #foreach( $allowedGroup in $allowedGroups )
            #if( $allowedGroup == $userGroup )
              #set( $isStaticGroupAuthorized = true )
            #end
          #end
        #end
        
        #set( $isOwnerAuthorized = $util.defaultIfNull($isOwnerAuthorized, false) )
        #set( $identityValue = $util.defaultIfNull($ctx.identity.claims.get("sub"), "___xamznone____") )
        #if( $customer == $identityValue )
          #set( $isOwnerAuthorized = true )
        #end
        
        #if( !($isStaticGroupAuthorized == true || $isOwnerAuthorized == true) )
          $util.unauthorized()
        #end
        
        {
          "version": "2018-05-29",
          "method": "GET",
          "resourcePath": "/Prod/loyalty/$customer",
          "params": {
            "headers": {
              "Content-Type": "application/json"
            }
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($ctx.error)
          $util.error($ctx.error.message, $ctx.error.type)
        #end
        #if($ctx.result.statusCode == 200)
          $ctx.result.body
        #else
          $util.error($ctx.result.body)
        #end
      `),
    });

    // SSM Parameters
    new ssm.StringParameter(this, 'BookingTopicParameter', {
      parameterName: `/${props.stage}/service/booking/messaging/bookingTopic`,
      stringValue: this.bookingTopic.topicArn,
    });

    new ssm.StringParameter(this, 'LoyaltyApiUrlParameter', {
      parameterName: `/${props.stage}/service/loyalty/api/url`,
      stringValue: this.loyaltyApi.url,
    });

    // Outputs
    new cdk.CfnOutput(this, 'BookingTopicArn', {
      value: this.bookingTopic.topicArn,
      exportName: `${props.stage}-BookingTopicArn`,
    });

    new cdk.CfnOutput(this, 'LoyaltyApiUrl', {
      value: this.loyaltyApi.url,
      exportName: `${props.stage}-LoyaltyApiUrl`,
    });

    new cdk.CfnOutput(this, 'LoyaltyTableName', {
      value: loyaltyTable.tableName,
      exportName: `${props.stage}-LoyaltyTableName`,
    });
  }
}