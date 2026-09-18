import { GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../config/aws.js';
import { TABLES, INDEXES } from '../config/tables.js';

/** Todos los usuarios (admin: buscador de clientes). La tabla es chica, un Scan alcanza. */
export async function listAllUsers() {
  const items = [];
  let ExclusiveStartKey;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await ddb.send(new ScanCommand({ TableName: TABLES.users, ExclusiveStartKey }));
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export async function getUserByDni(dni) {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: TABLES.users, Key: { dni } }),
  );
  return Item || null;
}

export async function getUserByEmail(email) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLES.users,
      IndexName: INDEXES.usersByEmail,
      KeyConditionExpression: 'email = :e',
      ExpressionAttributeValues: { ':e': email },
      Limit: 1,
    }),
  );
  return Items?.[0] || null;
}

/** Crea el usuario. Falla con ConditionalCheckFailed si el DNI ya existe. */
export async function createUser(user) {
  await ddb.send(
    new PutCommand({
      TableName: TABLES.users,
      Item: user,
      ConditionExpression: 'attribute_not_exists(dni)',
    }),
  );
  return user;
}

export async function updateUserRole(dni, role) {
  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: TABLES.users,
      Key: { dni },
      UpdateExpression: 'SET #role = :r, updatedAt = :now',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':r': role, ':now': new Date().toISOString() },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return Attributes;
}
