import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface PaymentStackProps extends cdk.StackProps {
  stage: string;
}

export class PaymentStack extends cdk.Stack {
  public readonly collectPaymentFunction: lambda.Function;
  public readonly refundPaymentFunction: lambda.Function;
  public readonly paymentChargeUrl: string;

  constructor(scope: Construct, id: string, props: PaymentStackProps) {
    super(scope, id, props);

    // Lambda Layer for shared libraries
    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      code: lambda.Code.fromAsset('../src/backend/shared/libs'),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'Shared libraries for payment service',
    });

    // Note: In a real implementation, you would deploy the Stripe SAR application
    // For now, we'll create placeholder URLs and functions
    const stripeChargeUrl = `https://api.stripe.com/v1/charges`;
    const stripeRefundUrl = `https://api.stripe.com/v1/refunds`;
    
    this.paymentChargeUrl = stripeChargeUrl;

    // Collect Payment Function
    this.collectPaymentFunction = new lambda.Function(this, 'CollectPaymentFunction', {
      functionName: `ServerlessAirline-CollectPayment-${props.stage}`,
      runtime: lambda.Runtime.PYTHON_3_12, // Updated from deprecated python3.7
      handler: 'collect.lambda_handler',
      code: lambda.Code.fromAsset('../src/backend/payment/src/collect-payment'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        PAYMENT_API_URL: stripeChargeUrl,
        STAGE: props.stage,
        POWERTOOLS_SERVICE_NAME: 'payment',
        POWERTOOLS_METRICS_NAMESPACE: 'ServerlessAirline',
        LOG_LEVEL: 'INFO',
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    // Refund Payment Function
    this.refundPaymentFunction = new lambda.Function(this, 'RefundPaymentFunction', {
      functionName: `ServerlessAirline-RefundPayment-${props.stage}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'refund.lambda_handler',
      code: lambda.Code.fromAsset('../src/backend/payment/src/refund-payment'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        PAYMENT_API_URL: stripeRefundUrl,
        STAGE: props.stage,
        POWERTOOLS_SERVICE_NAME: 'payment',
        POWERTOOLS_METRICS_NAMESPACE: 'ServerlessAirline',
        LOG_LEVEL: 'INFO',
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    // SSM Parameters for payment endpoints
    new ssm.StringParameter(this, 'CollectPaymentFunctionParameter', {
      parameterName: `/${props.stage}/service/payment/function/collect`,
      stringValue: this.collectPaymentFunction.functionArn,
    });

    new ssm.StringParameter(this, 'RefundPaymentFunctionParameter', {
      parameterName: `/${props.stage}/service/payment/function/refund`,
      stringValue: this.refundPaymentFunction.functionArn,
    });

    new ssm.StringParameter(this, 'PaymentChargeUrlParameter', {
      parameterName: `/${props.stage}/service/payment/api/charge/url`,
      stringValue: this.paymentChargeUrl,
    });

    new ssm.StringParameter(this, 'PaymentCaptureUrlParameter', {
      parameterName: `/${props.stage}/service/payment/api/capture/url`,
      stringValue: stripeChargeUrl,
    });

    new ssm.StringParameter(this, 'PaymentRefundUrlParameter', {
      parameterName: `/${props.stage}/service/payment/api/refund/url`,
      stringValue: stripeRefundUrl,
    });

    // Store Stripe keys in SSM (these should be set manually or via CI/CD)
    new ssm.StringParameter(this, 'StripeSecretKeyParameter', {
      parameterName: `/${props.stage}/service/payment/stripe/secretKey`,
      stringValue: 'PLACEHOLDER_STRIPE_SECRET_KEY', // Should be replaced with actual key
      description: 'Stripe Secret Key - Replace with actual value',
    });

    new ssm.StringParameter(this, 'StripePublicKeyParameter', {
      parameterName: `/${props.stage}/service/payment/stripe/publicKey`,
      stringValue: 'PLACEHOLDER_STRIPE_PUBLIC_KEY', // Should be replaced with actual key
      description: 'Stripe Public Key - Replace with actual value',
    });

    // Outputs
    new cdk.CfnOutput(this, 'CollectPaymentFunctionArn', {
      value: this.collectPaymentFunction.functionArn,
      exportName: `${props.stage}-CollectPaymentFunctionArn`,
    });

    new cdk.CfnOutput(this, 'RefundPaymentFunctionArn', {
      value: this.refundPaymentFunction.functionArn,
      exportName: `${props.stage}-RefundPaymentFunctionArn`,
    });

    new cdk.CfnOutput(this, 'PaymentChargeUrl', {
      value: this.paymentChargeUrl,
      exportName: `${props.stage}-PaymentChargeUrl`,
    });
  }
}