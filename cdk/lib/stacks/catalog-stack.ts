import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface CatalogStackProps extends cdk.StackProps {
  stage: string;
  flightTable: dynamodb.Table;
}

export class CatalogStack extends cdk.Stack {
  public readonly reserveFlightFunction: lambda.Function;
  public readonly releaseFlightFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: CatalogStackProps) {
    super(scope, id, props);

    // Reserve Flight Function
    this.reserveFlightFunction = new lambda.Function(this, 'ReserveFlightFunction', {
      functionName: `ServerlessAirline-ReserveFlight-${props.stage}`,
      runtime: lambda.Runtime.PYTHON_3_12, // Updated from deprecated python3.7
      handler: 'reserve.lambda_handler',
      code: lambda.Code.fromAsset('../src/backend/catalog/src/reserve-flight'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        FLIGHT_TABLE_NAME: props.flightTable.tableName,
        STAGE: props.stage,
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    // Release Flight Function
    this.releaseFlightFunction = new lambda.Function(this, 'ReleaseFlightFunction', {
      functionName: `ServerlessAirline-ReleaseFlight-${props.stage}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'release.lambda_handler',
      code: lambda.Code.fromAsset('../src/backend/catalog/src/release-flight'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        FLIGHT_TABLE_NAME: props.flightTable.tableName,
        STAGE: props.stage,
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    // Grant DynamoDB permissions
    props.flightTable.grantReadWriteData(this.reserveFlightFunction);
    props.flightTable.grantReadWriteData(this.releaseFlightFunction);

    // SSM Parameters
    new ssm.StringParameter(this, 'ReserveFlightFunctionParameter', {
      parameterName: `/${props.stage}/service/catalog/reserveFunction`,
      stringValue: this.reserveFlightFunction.functionArn,
    });

    new ssm.StringParameter(this, 'ReleaseFlightFunctionParameter', {
      parameterName: `/${props.stage}/service/catalog/releaseFunction`,
      stringValue: this.releaseFlightFunction.functionArn,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ReserveFlightFunctionArn', {
      value: this.reserveFlightFunction.functionArn,
      exportName: `${props.stage}-ReserveFlightFunctionArn`,
    });

    new cdk.CfnOutput(this, 'ReleaseFlightFunctionArn', {
      value: this.releaseFlightFunction.functionArn,
      exportName: `${props.stage}-ReleaseFlightFunctionArn`,
    });
  }
}