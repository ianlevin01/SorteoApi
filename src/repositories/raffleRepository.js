import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb } from '../config/aws.js';
import { TABLES, INDEXES } from '../config/tables.js';
import { buildUpdateExpression } from '../lib/dynamoUpdate.js';
import { notFound } from '../lib/errors.js';

export async function getRaffle(raffleId) {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: TABLES.raffles, Key: { raffleId } }),
  );
  return Item || null;
}

export async function listRafflesByStatus(status) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLES.raffles,
      IndexName: INDEXES.rafflesByStatus,
      KeyConditionExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': status },
      ScanIndexForward: false, // mas nuevos primero
    }),
  );
  return Items || [];
}

export async function listAllRaffles() {
  const { Items } = await ddb.send(new ScanCommand({ TableName: TABLES.raffles }));
  return (Items || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function createRaffle(raffle) {
  await ddb.send(
    new PutCommand({
      TableName: TABLES.raffles,
      Item: raffle,
      ConditionExpression: 'attribute_not_exists(raffleId)',
    }),
  );
  return raffle;
}

export async function updateRaffle(raffleId, patch) {
  const expr = buildUpdateExpression(patch);
  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: TABLES.raffles,
      Key: { raffleId },
      ...expr,
      ConditionExpression: 'attribute_exists(raffleId)',
      ReturnValues: 'ALL_NEW',
    }),
  );
  return Attributes;
}

/**
 * Reserva un bloque contiguo de `count` numeros de forma atomica.
 * Los numeros arrancan en 0. Devuelve { start, end } (ambos inclusive).
 *
 * El contador SOLO avanza (nunca retrocede): si una orden no se paga, esos
 * numeros quedan "quemados" e inactivos, pero nunca se reasignan. Esto es lo
 * que garantiza que dos compras cercanas jamas obtengan los mismos numeros.
 * El total del sorteo es informativo: no se bloquea la venta.
 */
export async function reserveNumberBlock(raffleId, count) {
  try {
    const { Attributes } = await ddb.send(
      new UpdateCommand({
        TableName: TABLES.raffles,
        Key: { raffleId },
        UpdateExpression:
          'SET assignedCount = if_not_exists(assignedCount, :zero) + :n, updatedAt = :now',
        ConditionExpression: 'attribute_exists(raffleId)',
        ExpressionAttributeValues: {
          ':n': count,
          ':zero': 0,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    const newCount = Attributes.assignedCount;
    return { start: newCount - count, end: newCount - 1 };
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      throw notFound('Sorteo no encontrado');
    }
    throw err;
  }
}

/** Suma (o resta, con `chances` negativo) chances confirmadas. Solo estadistica. */
export async function bumpConfirmedChances(raffleId, chances) {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLES.raffles,
      Key: { raffleId },
      UpdateExpression:
        'SET confirmedChances = if_not_exists(confirmedChances, :zero) + :n, updatedAt = :now',
      ExpressionAttributeValues: { ':n': chances, ':zero': 0, ':now': new Date().toISOString() },
    }),
  );
}
