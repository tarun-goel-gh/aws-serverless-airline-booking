import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface BookingStackProps extends cdk.StackProps {
  stage: string;
  bookingTable: dynamodb.Table;
  flightTable: dynamodb.Table;
  appsyncApi: appsync.GraphqlApi;
  collectPaymentFunction: lambda.Function;
  refundPaymentFunction: lambda.Function;
  bookingTopic: sns.Topic;
}

export class BookingStack extends cdk.Stack {
  public readonly processBookingStateMachine: stepfunctions.StateMachine;

  constructor(scope: Construct, id: string, props: BookingStackProps) {
    super(scope, id, props);

    // Lambda Layer for shared libraries
    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      code: lambda.Code.fromAsset('../src/backend/shared/libs'),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'Shared libraries for booking service',
    });

    // Lambda Functions
    const reserveBookingFunction = new lambda.Function(this, 'ReserveBookingFunction', {
      functionName: `ServerlessAirline-ReserveBooking-${props.stage}`,
      runtime: lambda.Runtime.PYTHON_3_12, // Updated from deprecated python3.7
      handler: 'reserve.lambda_handler',
      code: lambda.Code.fromAsset('../src/backend/booking/src/reserve-booking'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        BOOKING_TABLE_NAME: props.bookingTable.tableName,
        STAGE: props.stage,
        POWERTOOLS_SERVICE_NAME: 'booking',
        POWERTOOLS_METRICS_NAMESPACE: 'ServerlessAirline',
        LOG_LEVEL: 'INFO',
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    const confirmBookingFunction = new lambda.Function(this, 'ConfirmBookingFunction', {
      functionName: `ServerlessAirline-ConfirmBooking-${props.stage}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'confirm.lambda_handler',
      code: lambda.Code.fromAsset('../src/backend/booking/src/confirm-booking'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        BOOKING_TABLE_NAME: props.bookingTable.tableName,
        STAGE: props.stage,
        POWERTOOLS_SERVICE_NAME: 'booking',
        POWERTOOLS_METRICS_NAMESPACE: 'ServerlessAirline',
        LOG_LEVEL: 'INFO',
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    const cancelBookingFunction = new lambda.Function(this, 'CancelBookingFunction', {
      functionName: `ServerlessAirline-CancelBooking-${props.stage}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'cancel.lambda_handler',
      code: lambda.Code.fromAsset('../src/backend/booking/src/cancel-booking'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        BOOKING_TABLE_NAME: props.bookingTable.tableName,
        STAGE: props.stage,
        POWERTOOLS_SERVICE_NAME: 'booking',
        POWERTOOLS_METRICS_NAMESPACE: 'ServerlessAirline',
        LOG_LEVEL: 'INFO',
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    const notifyBookingFunction = new lambda.Function(this, 'NotifyBookingFunction', {
      functionName: `ServerlessAirline-NotifyBooking-${props.stage}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'notify.lambda_handler',
      code: lambda.Code.fromAsset('../src/backend/booking/src/notify-booking'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        BOOKING_TOPIC: props.bookingTopic.topicArn,
        STAGE: props.stage,
        POWERTOOLS_SERVICE_NAME: 'booking',
        POWERTOOLS_METRICS_NAMESPACE: 'ServerlessAirline',
        LOG_LEVEL: 'INFO',
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    // Grant permissions
    props.bookingTable.grantReadWriteData(reserveBookingFunction);
    props.bookingTable.grantReadWriteData(confirmBookingFunction);
    props.bookingTable.grantReadWriteData(cancelBookingFunction);
    props.bookingTopic.grantPublish(notifyBookingFunction);

    // Dead Letter Queue
    const bookingsDLQ = new sqs.Queue(this, 'BookingsDLQ', {
      queueName: `ServerlessAirline-BookingsDLQ-${props.stage}`,
      retentionPeriod: cdk.Duration.days(14),
    });

    // Step Functions State Machine
    const reserveFlightTask = new stepfunctionsTasks.DynamoUpdateItem(this, 'ReserveFlightTask', {
      table: props.flightTable,
      key: {
        id: stepfunctionsTasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.outboundFlightId')),
      },
      updateExpression: 'SET seatCapacity = seatCapacity - :dec',
      expressionAttributeValues: {
        ':dec': stepfunctionsTasks.DynamoAttributeValue.fromNumber(1),
        ':noSeat': stepfunctionsTasks.DynamoAttributeValue.fromNumber(0),
      },
      conditionExpression: 'seatCapacity > :noSeat',
      resultPath: stepfunctions.JsonPath.DISCARD,
    });

    const releaseFlightTask = new stepfunctionsTasks.DynamoUpdateItem(this, 'ReleaseFlightTask', {
      table: props.flightTable,
      key: {
        id: stepfunctionsTasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.outboundFlightId')),
      },
      updateExpression: 'SET seatCapacity = seatCapacity + :inc',
      expressionAttributeValues: {
        ':inc': stepfunctionsTasks.DynamoAttributeValue.fromNumber(1),
      },
      resultPath: stepfunctions.JsonPath.DISCARD,
    });

    const reserveBookingTask = new stepfunctionsTasks.LambdaInvoke(this, 'ReserveBookingTask', {
      lambdaFunction: reserveBookingFunction,
      resultPath: '$.bookingId',
    });

    const confirmBookingTask = new stepfunctionsTasks.LambdaInvoke(this, 'ConfirmBookingTask', {
      lambdaFunction: confirmBookingFunction,
      resultPath: '$.bookingReference',
    });

    const cancelBookingTask = new stepfunctionsTasks.LambdaInvoke(this, 'CancelBookingTask', {
      lambdaFunction: cancelBookingFunction,
      resultPath: stepfunctions.JsonPath.DISCARD,
    });

    const collectPaymentTask = new stepfunctionsTasks.LambdaInvoke(this, 'CollectPaymentTask', {
      lambdaFunction: props.collectPaymentFunction,
      resultPath: '$.payment',
    });

    const refundPaymentTask = new stepfunctionsTasks.LambdaInvoke(this, 'RefundPaymentTask', {
      lambdaFunction: props.refundPaymentFunction,
      resultPath: stepfunctions.JsonPath.DISCARD,
    });

    const notifyBookingConfirmedTask = new stepfunctionsTasks.LambdaInvoke(this, 'NotifyBookingConfirmedTask', {
      lambdaFunction: notifyBookingFunction,
      resultPath: '$.notificationId',
    });

    const notifyBookingFailedTask = new stepfunctionsTasks.LambdaInvoke(this, 'NotifyBookingFailedTask', {
      lambdaFunction: notifyBookingFunction,
      resultPath: '$.notificationId',
    });

    const bookingDLQTask = new stepfunctionsTasks.SqsSendMessage(this, 'BookingDLQTask', {
      queue: bookingsDLQ,
      messageBody: stepfunctions.TaskInput.fromJsonPathAt('$'),
      resultPath: '$.deadLetterQueue',
    });

    // Define the state machine
    const bookingFailed = new stepfunctions.Fail(this, 'BookingFailed');
    const bookingConfirmed = new stepfunctions.Pass(this, 'BookingConfirmed');

    const definition = reserveFlightTask
      .addCatch(bookingFailed, {
        errors: ['States.ALL'],
        resultPath: '$.flightError',
      })
      .next(reserveBookingTask
        .addCatch(bookingFailed, {
          errors: ['States.ALL'],
          resultPath: '$.bookingError',
        })
        .next(collectPaymentTask
          .addCatch(bookingFailed, {
            errors: ['States.ALL'],
            resultPath: '$.paymentError',
          })
          .next(confirmBookingTask
            .addCatch(bookingFailed, {
              errors: ['States.ALL'],
              resultPath: '$.bookingError',
            })
            .next(notifyBookingConfirmedTask.next(bookingConfirmed))
          )
        )
      );

    this.processBookingStateMachine = new stepfunctions.StateMachine(this, 'ProcessBookingStateMachine', {
      stateMachineName: `Airline-ProcessBooking-${props.stage}`,
      definition,
      timeout: cdk.Duration.minutes(5),
      tracingEnabled: true,
    });

    // Grant Step Functions permissions
    props.flightTable.grantReadWriteData(this.processBookingStateMachine);
    bookingsDLQ.grantSendMessages(this.processBookingStateMachine);

    // AppSync Data Source for Step Functions
    const stepFunctionsRole = new iam.Role(this, 'AppSyncStepFunctionsRole', {
      assumedBy: new iam.ServicePrincipal('appsync.amazonaws.com'),
      inlinePolicies: {
        StepFunctionsExecutionPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['states:StartExecution'],
              resources: [this.processBookingStateMachine.stateMachineArn],
            }),
          ],
        }),
      },
    });

    const stepFunctionsDataSource = new appsync.HttpDataSource(this, 'StepFunctionsDataSource', {
      api: props.appsyncApi,
      endpoint: `https://states.${this.region}.amazonaws.com/`,
      name: 'ProcessBookingSFN',
      description: 'Step Functions State Machine for Booking',
      authorizationConfig: {
        signingRegion: this.region,
        signingServiceName: 'states',
      },
    });

    stepFunctionsDataSource.node.addDependency(stepFunctionsRole);

    // AppSync Resolver for processBooking mutation
    new appsync.Resolver(this, 'ProcessBookingResolver', {
      api: props.appsyncApi,
      typeName: 'Mutation',
      fieldName: 'processBooking',
      dataSource: stepFunctionsDataSource,
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        #set( $payload = {
          "outboundFlightId": $ctx.args.input.bookingOutboundFlightId,
          "customerId": $context.identity.sub,
          "chargeId": $ctx.args.input.paymentToken,
          "bookingTable": "${props.bookingTable.tableName}",
          "flightTable": "${props.flightTable.tableName}",
          "name": $util.autoId(),
          "createdAt": $util.time.nowISO8601()
        })
        
        {
          "version": "2018-05-29",
          "method": "POST",
          "resourcePath": "/",
          "params": {
            "headers": {
              "content-type": "application/x-amz-json-1.0",
              "x-amz-target": "AWSStepFunctions.StartExecution"
            },
            "body": {
              "stateMachineArn": "${this.processBookingStateMachine.stateMachineArn}",
              "input": "$util.escapeJavaScript($util.toJson($payload))",
              "name": "$util.autoId()"
            }
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "id": "$util.autoId()",
          "status": "PENDING"
        }
      `),
    });

    // SSM Parameters
    new ssm.StringParameter(this, 'ProcessBookingStateMachineParameter', {
      parameterName: `/${props.stage}/service/booking/statemachine/processBooking`,
      stringValue: this.processBookingStateMachine.stateMachineArn,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ProcessBookingStateMachineArn', {
      value: this.processBookingStateMachine.stateMachineArn,
      exportName: `${props.stage}-ProcessBookingStateMachineArn`,
    });
  }
}