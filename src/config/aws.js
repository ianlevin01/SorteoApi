import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env.js';

/**
 * Devuelve credenciales explicitas si estan en el .env; si no, devuelve
 * undefined para que el SDK use la cadena por defecto (aws configure, SSO,
 * variables de entorno del sistema, roles de EC2/ECS, etc).
 */
function explicitCredentials() {
  if (env.aws.accessKeyId && env.aws.secretAccessKey) {
    return {
      accessKeyId: env.aws.accessKeyId,
      secretAccessKey: env.aws.secretAccessKey,
      ...(env.aws.sessionToken ? { sessionToken: env.aws.sessionToken } : {}),
    };
  }
  return undefined;
}

const creds = explicitCredentials();

const dynamoClient = new DynamoDBClient({
  region: env.aws.region,
  ...(env.dynamo.endpoint ? { endpoint: env.dynamo.endpoint } : {}),
  ...(creds ? { credentials: creds } : {}),
});

/** Cliente de alto nivel: trabaja con objetos JS planos en vez de AttributeValues. */
export const ddb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  },
});

/** Cliente crudo, para operaciones de administracion (crear tablas, etc). */
export const dynamoRaw = dynamoClient;

export const s3 = new S3Client({
  region: env.aws.region,
  ...(creds ? { credentials: creds } : {}),
});
