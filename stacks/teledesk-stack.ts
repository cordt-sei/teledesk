import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface TeledeskStackProps extends cdk.StackProps {
  telegramBotToken?: string;
  slackApiToken?: string;
  slackChannelId?: string;
  slackSigningSecret?: string;
  zendeskApiUrl?: string;
  zendeskEmail?: string;
  zendeskApiToken?: string;
  teamMembers?: string;
  approvedGroups?: string; // Add this line
}

export class TeledeskStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: TeledeskStackProps) {
    super(scope, id, props);

    // Create DynamoDB Tables for state persistence
    const activeTicketsTable = new dynamodb.Table(this, 'ActiveTicketsTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN in production
      pointInTimeRecovery: true,
    });

    const userStatesTable = new dynamodb.Table(this, 'UserStatesTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    const slackAcknowledgmentsTable = new dynamodb.Table(this, 'SlackAcknowledgmentsTable', {
      partitionKey: { name: 'messageTs', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expirationTime', // TTL for cleanup of old acknowledgments
    });

    // Create or import secrets
    const botSecret = this.createOrImportSecret('TelegramBotToken', props?.telegramBotToken);
    const slackApiSecret = this.createOrImportSecret('SlackApiToken', props?.slackApiToken);
    const slackSigningSecret = this.createOrImportSecret('SlackSigningSecret', props?.slackSigningSecret);
    const zendeskTokenSecret = this.createOrImportSecret('ZendeskApiToken', props?.zendeskApiToken);

    // Common IAM role for Lambda execution
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant DynamoDB permissions to the Lambda role
    activeTicketsTable.grantReadWriteData(lambdaExecutionRole);
    userStatesTable.grantReadWriteData(lambdaExecutionRole);
    slackAcknowledgmentsTable.grantReadWriteData(lambdaExecutionRole);

    // Grant permissions to read secrets
    botSecret.grantRead(lambdaExecutionRole);
    slackApiSecret.grantRead(lambdaExecutionRole);
    slackSigningSecret.grantRead(lambdaExecutionRole);
    zendeskTokenSecret.grantRead(lambdaExecutionRole);
    
    // Common environment variables for Lambda functions
    const commonEnvironment = {
      ACTIVE_TICKETS_TABLE: activeTicketsTable.tableName,
      USER_STATES_TABLE: userStatesTable.tableName,
      SLACK_ACKNOWLEDGMENTS_TABLE: slackAcknowledgmentsTable.tableName,
      TELEGRAM_BOT_TOKEN: botSecret.secretValue.toString(),
      SLACK_API_TOKEN: slackApiSecret.secretValue.toString(),
      SLACK_CHANNEL_ID: props?.slackChannelId || '',
      SLACK_SIGNING_SECRET: slackSigningSecret.secretValue.toString(),
      ZENDESK_API_URL: props?.zendeskApiUrl || '',
      ZENDESK_EMAIL: props?.zendeskEmail || '',
      ZENDESK_API_TOKEN: zendeskTokenSecret.secretValue.toString(),
      TEAM_MEMBERS: props?.teamMembers || '',
      APPROVED_GROUPS: props?.approvedGroups || '', // Add this line
      DEPLOY_ENV: 'production',
    };
    
    // Create Lambda for Telegram webhook handler
    const telegramWebhookLambda = new lambda.Function(this, 'TelegramWebhookLambda', {
      functionName: 'TelegramWebhookHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'telegram-webhook.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/telegram-webhook')),
      environment: commonEnvironment,
      timeout: cdk.Duration.minutes(1),
      memorySize: 256,
      role: lambdaExecutionRole,
    });
    
    // Create Lambda for Slack interactions
    const slackInteractionsLambda = new lambda.Function(this, 'SlackInteractionsLambda', {
      functionName: 'SlackInteractionsHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'slack-interactions.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/slack-interactions')),
      environment: commonEnvironment,
      timeout: cdk.Duration.minutes(1),
      memorySize: 256,
      role: lambdaExecutionRole,
    });
    
    // Create Lambda for setting up the Telegram webhook
    const setWebhookLambda = new lambda.Function(this, 'SetWebhookLambda', {
      functionName: 'SetTelegramWebhook',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'set-webhook.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/set-webhook')),
      environment: commonEnvironment,
      timeout: cdk.Duration.minutes(1),
      memorySize: 128,
      role: lambdaExecutionRole,
    });
    
    // Create API Gateway
    const api = new apigateway.RestApi(this, 'TeledeskApi', {
      restApiName: 'Teledesk API',
      description: 'API for Telegram bot and Slack interactions',
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });
    
    // Add resource for Telegram bot webhook - route includes bot token for security
    const telegramResource = api.root.addResource('telegram');
    const botTokenResource = telegramResource.addResource('{botToken}');
    botTokenResource.addMethod('POST', new apigateway.LambdaIntegration(telegramWebhookLambda), {
      apiKeyRequired: false,
    });
    
    // Add resource for Slack interactions
    const slackResource = api.root.addResource('slack');
    const interactionsResource = slackResource.addResource('interactions');
    interactionsResource.addMethod('POST', new apigateway.LambdaIntegration(slackInteractionsLambda), {
      apiKeyRequired: false,
    });
    
    // Add simple health check endpoint
    const healthResource = api.root.addResource('health');
    healthResource.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseTemplates: {
          'application/json': '{"status": "ok", "timestamp": "$context.requestTime"}',
        },
      }],
      passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      requestTemplates: {
        'application/json': '{"statusCode": 200}',
      },
    }), {
      methodResponses: [{ statusCode: '200' }],
    });
    
    // Update the webhook setup Lambda with the API Gateway URL
    setWebhookLambda.addEnvironment('WEBHOOK_URL', 
      `https://${api.restApiId}.execute-api.${this.region}.amazonaws.com/prod/telegram`);
      
    // Custom resource to set up the webhook on deployment
    const webhookSetupProvider = new cr.Provider(this, 'WebhookSetupProvider', {
      onEventHandler: setWebhookLambda,
    });
    
    new cdk.CustomResource(this, 'SetupTelegramWebhook', {
      serviceToken: webhookSetupProvider.serviceToken,
      properties: {
        // Include a random value to ensure the resource runs on every deployment
        UpdateTimestamp: new Date().toISOString(),
      },
    });
    
    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });
    
    new cdk.CfnOutput(this, 'TelegramWebhookUrl', {
      value: `${api.url}telegram/${botSecret.secretValue.toString()}`,
      description: 'Telegram Webhook URL',
    });
    
    new cdk.CfnOutput(this, 'SlackInteractionsUrl', {
      value: `${api.url}slack/interactions`,
      description: 'Slack Interactions URL',
    });
  }
  
  private createOrImportSecret(secretName: string, secretValue?: string): secretsmanager.ISecret {
    if (secretValue) {
      return new secretsmanager.Secret(this, secretName, {
        secretName: `teledesk/${secretName}`,
        description: `Teledesk ${secretName}`,
        secretStringValue: new cdk.SecretValue(secretValue),
      });
    } else {
      // Import existing secret if value not provided
      return secretsmanager.Secret.fromSecretNameV2(this, secretName, `teledesk/${secretName}`);
    }
  }
}