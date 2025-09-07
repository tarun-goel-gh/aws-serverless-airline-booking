#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CoreStack } from '../lib/stacks/core-stack';
import { BookingStack } from '../lib/stacks/booking-stack';
import { CatalogStack } from '../lib/stacks/catalog-stack';
import { LoyaltyStack } from '../lib/stacks/loyalty-stack';
import { PaymentStack } from '../lib/stacks/payment-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

const stage = app.node.tryGetContext('stage') || 'dev';

// Core infrastructure (Cognito, AppSync, DynamoDB)
const coreStack = new CoreStack(app, `ServerlessAirline-Core-${stage}`, {
  env,
  stage,
});

// Backend services
const catalogStack = new CatalogStack(app, `ServerlessAirline-Catalog-${stage}`, {
  env,
  stage,
  flightTable: coreStack.flightTable,
});

const paymentStack = new PaymentStack(app, `ServerlessAirline-Payment-${stage}`, {
  env,
  stage,
});

const loyaltyStack = new LoyaltyStack(app, `ServerlessAirline-Loyalty-${stage}`, {
  env,
  stage,
  appsyncApi: coreStack.appsyncApi,
});

const bookingStack = new BookingStack(app, `ServerlessAirline-Booking-${stage}`, {
  env,
  stage,
  bookingTable: coreStack.bookingTable,
  flightTable: coreStack.flightTable,
  appsyncApi: coreStack.appsyncApi,
  collectPaymentFunction: paymentStack.collectPaymentFunction,
  refundPaymentFunction: paymentStack.refundPaymentFunction,
  bookingTopic: loyaltyStack.bookingTopic,
});

// Frontend
const frontendStack = new FrontendStack(app, `ServerlessAirline-Frontend-${stage}`, {
  env,
  stage,
  userPool: coreStack.userPool,
  userPoolClient: coreStack.userPoolClient,
  appsyncApi: coreStack.appsyncApi,
  paymentChargeUrl: paymentStack.paymentChargeUrl,
});

// Add dependencies
catalogStack.addDependency(coreStack);
paymentStack.addDependency(coreStack);
loyaltyStack.addDependency(coreStack);
bookingStack.addDependency(coreStack);
bookingStack.addDependency(paymentStack);
bookingStack.addDependency(loyaltyStack);
frontendStack.addDependency(coreStack);
frontendStack.addDependency(paymentStack);