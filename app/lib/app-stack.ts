import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodeLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import * as s3 from 'aws-cdk-lib/aws-s3';

import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const saladBucket: s3.Bucket = new s3.Bucket(this, 'SaladBucket', {
      bucketName: 'salad-app-example-bucket',
    });

    // create the dynamodb table
    const saladAppTable: dynamodb.Table = new dynamodb.Table(
      this,
      'SaladAppDB',
      {
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        tableName: 'salad-app-db',
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        pointInTimeRecovery: false,
        contributorInsightsEnabled: true,
        removalPolicy: RemovalPolicy.DESTROY,
        partitionKey: {
          name: 'id',
          type: dynamodb.AttributeType.STRING,
        },
      }
    );

    // create the rest api
    const ordersApi: apigw.RestApi = new apigw.RestApi(this, 'SaladAppApi', {
      description: 'Salad App API',
      deploy: true,
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigw.MethodLoggingLevel.INFO,
      },
    });

    // create the rest api resources
    const orders: apigw.Resource = ordersApi.root.addResource('orders');
    const order: apigw.Resource = orders.addResource('{id}');

    // create the lambdas
    const createOrderLambda: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'CreateOrderLambda', {
        runtime: lambda.Runtime.NODEJS_16_X,
        entry: path.join(
          __dirname,
          'src/handlers/create-order/create-order.ts'
        ),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          TABLE_NAME: saladAppTable.tableName,
          BUCKET_NAME: saladBucket.bucketName,
        },
      });

    const getOrderLambda: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'GetOrderLambda', {
        runtime: lambda.Runtime.NODEJS_16_X,
        entry: path.join(__dirname, 'src/handlers/get-order/get-order.ts'),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          TABLE_NAME: saladAppTable.tableName,
        },
      });

    // hook up the lambda functions to the api
    orders.addMethod(
      'POST',
      new apigw.LambdaIntegration(createOrderLambda, {
        proxy: true,
      })
    );

    order.addMethod(
      'GET',
      new apigw.LambdaIntegration(getOrderLambda, {
        proxy: true,
      })
    );

    // grant the relevant lambdas access to our dynamodb database
    saladAppTable.grantReadData(getOrderLambda);
    saladAppTable.grantWriteData(createOrderLambda);

    // grant the create order lambda access to the s3 bucket
    saladBucket.grantWrite(createOrderLambda);
  }
}
