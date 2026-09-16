import {
  CreateTableCommand,
  DescribeTableCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { dynamoRaw } from '../src/config/aws.js';
import { TABLES, INDEXES } from '../src/config/tables.js';
import { env } from '../src/config/env.js';
import { isMain } from './_runAsMain.js';

const tableDefinitions = [
  {
    TableName: TABLES.users,
    AttributeDefinitions: [
      { AttributeName: 'dni', AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' },
    ],
    KeySchema: [{ AttributeName: 'dni', KeyType: 'HASH' }],
    GlobalSecondaryIndexes: [
      {
        IndexName: INDEXES.usersByEmail,
        KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    TableName: TABLES.raffles,
    AttributeDefinitions: [
      { AttributeName: 'raffleId', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
    ],
    KeySchema: [{ AttributeName: 'raffleId', KeyType: 'HASH' }],
    GlobalSecondaryIndexes: [
      {
        IndexName: INDEXES.rafflesByStatus,
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    TableName: TABLES.tickets,
    AttributeDefinitions: [
      { AttributeName: 'raffleId', AttributeType: 'S' },
      { AttributeName: 'number', AttributeType: 'N' },
      { AttributeName: 'dni', AttributeType: 'S' },
      { AttributeName: 'gsi1sk', AttributeType: 'S' },
      { AttributeName: 'verificationCode', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'raffleId', KeyType: 'HASH' },
      { AttributeName: 'number', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: INDEXES.ticketsByOwner,
        KeySchema: [
          { AttributeName: 'dni', KeyType: 'HASH' },
          { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: INDEXES.ticketsByCode,
        KeySchema: [{ AttributeName: 'verificationCode', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    TableName: TABLES.orders,
    AttributeDefinitions: [
      { AttributeName: 'orderId', AttributeType: 'S' },
      { AttributeName: 'dni', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
    ],
    KeySchema: [{ AttributeName: 'orderId', KeyType: 'HASH' }],
    GlobalSecondaryIndexes: [
      {
        IndexName: INDEXES.ordersByBuyer,
        KeySchema: [
          { AttributeName: 'dni', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: INDEXES.ordersByStatus,
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    // Consultas escaladas a un asesor (el chat con la IA nunca llega acá:
    // solo vive en el localStorage del usuario hasta que se deriva).
    TableName: TABLES.inquiries,
    AttributeDefinitions: [
      { AttributeName: 'inquiryId', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
      { AttributeName: 'lastMessageAt', AttributeType: 'S' },
    ],
    KeySchema: [{ AttributeName: 'inquiryId', KeyType: 'HASH' }],
    GlobalSecondaryIndexes: [
      {
        IndexName: INDEXES.inquiriesByStatus,
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'lastMessageAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    // Mensajes del chat EN VIVO de una consulta ya escalada (comprador <-> admin).
    TableName: TABLES.inquiryMessages,
    AttributeDefinitions: [
      { AttributeName: 'inquiryId', AttributeType: 'S' },
      { AttributeName: 'messageId', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'inquiryId', KeyType: 'HASH' },
      { AttributeName: 'messageId', KeyType: 'RANGE' },
    ],
  },
];

async function tableExists(name) {
  try {
    await dynamoRaw.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') return false;
    throw err;
  }
}

export async function createTables() {
  console.log(`DynamoDB · región ${env.aws.region}`);
  for (const def of tableDefinitions) {
    // eslint-disable-next-line no-await-in-loop
    if (await tableExists(def.TableName)) {
      console.log(`  = ${def.TableName} (ya existe)`);
      continue;
    }
    console.log(`  + creando ${def.TableName} ...`);
    // eslint-disable-next-line no-await-in-loop
    await dynamoRaw.send(new CreateTableCommand({ ...def, BillingMode: 'PAY_PER_REQUEST' }));
    // eslint-disable-next-line no-await-in-loop
    await waitUntilTableExists({ client: dynamoRaw, maxWaitTime: 180 }, { TableName: def.TableName });
    console.log(`    ${def.TableName} lista`);
  }
  console.log('DynamoDB listo.');
}

if (isMain(import.meta.url)) {
  createTables().catch((err) => {
    console.error('Error creando tablas:', err);
    process.exit(1);
  });
}
