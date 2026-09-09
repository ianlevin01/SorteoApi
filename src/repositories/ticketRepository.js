import {
  GetCommand,
  QueryCommand,
  BatchWriteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb } from '../config/aws.js';
import { TABLES, INDEXES } from '../config/tables.js';
import { newVerificationCode } from '../lib/ids.js';

// 'number' es palabra reservada en DynamoDB -> siempre via alias #n en expresiones.
const OWNER_SORT_WIDTH = 12;

const ownerSortKey = (raffleId, number) =>
  `${raffleId}#${String(number).padStart(OWNER_SORT_WIDTH, '0')}`;

/**
 * Arma los items de ticket para el bloque [start, end].
 * El estado del ticket NO se guarda: se deriva del estado de la orden al leer.
 */
export function buildTicketItems({ raffleId, dni, holderName, orderId, start, end }) {
  const createdAt = new Date().toISOString();
  const items = [];
  for (let n = start; n <= end; n += 1) {
    items.push({
      raffleId,
      number: n,
      dni,
      holderName: holderName || null,
      orderId,
      verificationCode: newVerificationCode(),
      gsi1sk: ownerSortKey(raffleId, n),
      createdAt,
    });
  }
  return items;
}

async function putTicketsBatch(items) {
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    let unprocessed = {
      [TABLES.tickets]: chunk.map((Item) => ({ PutRequest: { Item } })),
    };
    let attempt = 0;
    while (unprocessed[TABLES.tickets]?.length && attempt < 8) {
      // eslint-disable-next-line no-await-in-loop
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: unprocessed }));
      unprocessed = res.UnprocessedItems || {};
      attempt += 1;
      if (unprocessed[TABLES.tickets]?.length) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
    }
    if (unprocessed[TABLES.tickets]?.length) {
      throw new Error('No se pudieron escribir todos los tickets tras varios reintentos');
    }
  }
}

/**
 * Escribe los tickets del bloque. Con <=100 usa una transaccion con condicion
 * `attribute_not_exists` por ticket: garantia dura de que dos compras cercanas
 * nunca comparten numeros. Con bloques mas grandes cae a BatchWrite.
 */
export async function putTickets(items) {
  if (items.length === 0) return;
  if (items.length > 100) {
    await putTicketsBatch(items);
    return;
  }
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: items.map((Item) => ({
        Put: {
          TableName: TABLES.tickets,
          Item,
          ConditionExpression: 'attribute_not_exists(raffleId)',
        },
      })),
    }),
  );
}

export async function getTicket(raffleId, number) {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: TABLES.tickets, Key: { raffleId, number } }),
  );
  return Item || null;
}

export async function getTicketByCode(verificationCode) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLES.tickets,
      IndexName: INDEXES.ticketsByCode,
      KeyConditionExpression: 'verificationCode = :c',
      ExpressionAttributeValues: { ':c': verificationCode },
      Limit: 1,
    }),
  );
  return Items?.[0] || null;
}

export async function listTicketsByOwner(dni, raffleId = null) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLES.tickets,
      IndexName: INDEXES.ticketsByOwner,
      KeyConditionExpression: raffleId
        ? 'dni = :d AND begins_with(gsi1sk, :r)'
        : 'dni = :d',
      ExpressionAttributeValues: raffleId
        ? { ':d': dni, ':r': `${raffleId}#` }
        : { ':d': dni },
    }),
  );
  return Items || [];
}

export async function listTicketsByRaffle(raffleId) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLES.tickets,
      KeyConditionExpression: 'raffleId = :r',
      ExpressionAttributeValues: { ':r': raffleId },
    }),
  );
  return Items || [];
}
