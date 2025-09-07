import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface CoreStackProps extends cdk.StackProps {
  stage: string;
}

export class CoreStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly appsyncApi: appsync.GraphqlApi;
  public readonly flightTable: dynamodb.Table;
  public readonly bookingTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: CoreStackProps) {
    super(scope, id, props);

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `ServerlessAirline-UserPool-${props.stage}`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // User Pool Client
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `ServerlessAirline-UserPoolClient-${props.stage}`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
    });

    // DynamoDB Tables
    this.flightTable = new dynamodb.Table(this, 'FlightTable', {
      tableName: `Flight-${props.stage}`,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Add GSI for flight searches
    this.flightTable.addGlobalSecondaryIndex({
      indexName: 'departureDate-index',
      partitionKey: {
        name: 'departureDate',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'departureAirportCode',
        type: dynamodb.AttributeType.STRING,
      },
    });

    this.bookingTable = new dynamodb.Table(this, 'BookingTable', {
      tableName: `Booking-${props.stage}`,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Add GSI for customer bookings
    this.bookingTable.addGlobalSecondaryIndex({
      indexName: 'customer-index',
      partitionKey: {
        name: 'customerId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // AppSync GraphQL API with minimal schema
    this.appsyncApi = new appsync.GraphqlApi(this, 'GraphQLApi', {
      name: `ServerlessAirline-GraphQL-${props.stage}`,
      definition: appsync.Definition.fromSchema(appsync.SchemaFile.fromAsset('./simple-schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool: this.userPool,
          },
        },
        additionalAuthorizationModes: [
          {
            authorizationType: appsync.AuthorizationType.API_KEY,
            apiKeyConfig: {
              expires: cdk.Expiration.after(cdk.Duration.days(365)),
            },
          },
        ],
      },
      xrayEnabled: true,
    });

    // DynamoDB Data Sources
    const flightDataSource = this.appsyncApi.addDynamoDbDataSource(
      'FlightDataSource',
      this.flightTable
    );

    const bookingDataSource = this.appsyncApi.addDynamoDbDataSource(
      'BookingDataSource',
      this.bookingTable
    );

    // Export values to SSM for cross-stack references
    new ssm.StringParameter(this, 'UserPoolIdParameter', {
      parameterName: `/${props.stage}/service/amplify/auth/userpool/id`,
      stringValue: this.userPool.userPoolId,
    });

    new ssm.StringParameter(this, 'UserPoolClientIdParameter', {
      parameterName: `/${props.stage}/service/amplify/auth/userpool/clientId`,
      stringValue: this.userPoolClient.userPoolClientId,
    });

    new ssm.StringParameter(this, 'GraphQLApiIdParameter', {
      parameterName: `/${props.stage}/service/amplify/api/id`,
      stringValue: this.appsyncApi.apiId,
    });

    new ssm.StringParameter(this, 'GraphQLApiUrlParameter', {
      parameterName: `/${props.stage}/service/amplify/api/url`,
      stringValue: this.appsyncApi.graphqlUrl,
    });

    new ssm.StringParameter(this, 'FlightTableNameParameter', {
      parameterName: `/${props.stage}/service/amplify/storage/table/flight`,
      stringValue: this.flightTable.tableName,
    });

    new ssm.StringParameter(this, 'BookingTableNameParameter', {
      parameterName: `/${props.stage}/service/amplify/storage/table/booking`,
      stringValue: this.bookingTable.tableName,
    });

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: `${props.stage}-UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: `${props.stage}-UserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'GraphQLApiUrl', {
      value: this.appsyncApi.graphqlUrl,
      exportName: `${props.stage}-GraphQLApiUrl`,
    });

    new cdk.CfnOutput(this, 'GraphQLApiId', {
      value: this.appsyncApi.apiId,
      exportName: `${props.stage}-GraphQLApiId`,
    });
  }
}