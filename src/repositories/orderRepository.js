import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb } from '../config/aws.js';
import { TABLES, INDEXES } from '../config/tables.js';
import { buildUpdateExpression } from '../lib/dynamoUpdate.js';

export async function getOrder(orderId) {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: TABLES.orders, Key: { orderId } }),
  );
  return Item || null;
}

export async function createOrder(order) {
  await ddb.send(
    new PutCommand({
      TableName: TABLES.orders,
      Item: order,
      ConditionExpression: 'attribute_not_exists(orderId)',
    }),
  );
  return order;
}

/**
 * Actualiza una orden. `expectedStatus` agrega una condicion optimista
 * (la orden debe estar en ese estado) para evitar transiciones pisadas.
 */
export async function updateOrder(orderId, patch, { expectedStatus } = {}) {
  const expr = buildUpdateExpression(patch);
  const names = { ...expr.ExpressionAttributeNames };
  const values = { ...(expr.ExpressionAttributeValues || {}) };
  let condition = 'attribute_exists(orderId)';
  if (expectedStatus) {
    names['#currentStatus'] = 'status';
    values[':expectedStatus'] = expectedStatus;
    condition += ' AND #currentStatus = :expectedStatus';
  }
  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: TABLES.orders,
      Key: { orderId },
      UpdateExpression: expr.UpdateExpression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
      ConditionExpression: condition,
      ReturnValues: 'ALL_NEW',
    }),
  );
  return Attributes;
}

export async function listOrdersByBuyer(dni) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLES.orders,
      IndexName: INDEXES.ordersByBuyer,
      KeyConditionExpression: 'dni = :d',
      ExpressionAttributeValues: { ':d': dni },
      ScanIndexForward: false,
    }),
  );
  return Items || [];
}

export async function listOrdersByStatus(status) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLES.orders,
      IndexName: INDEXES.ordersByStatus,
      KeyConditionExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': status },
      ScanIndexForward: false,
    }),
  );
  return Items || [];
}
