import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
  BatchWriteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb } from '../config/aws.js';
import { TABLES, INDEXES } from '../config/tables.js';
import { newVerificationCode } from '../lib/ids.js';
import { conflict } from '../lib/errors.js';

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

// ==================== Sorteos "elegí tu número" ====================
//
// Cada número se reserva individualmente al tocarlo, con una condición
// atómica: solo se puede "pisar" un ticket si no existe, o si existe pero
// no está confirmado (pagado) Y su reserva ya venció. Eso da la garantía
// dura de que dos personas nunca terminan con el mismo número, sin
// necesitar ningún job de limpieza (la expiración se resuelve sola en el
// momento en que alguien intenta reservar de nuevo ese número).

/** Reserva UN número para `dni` por `minutes` minutos. Tira `conflict` si no se puede. */
export async function reserveNumber({ raffleId, number, dni, holderName, minutes }) {
  const now = new Date();
  const reservedUntil = new Date(now.getTime() + minutes * 60000).toISOString();
  const item = {
    raffleId,
    number,
    dni,
    holderName: holderName || null,
    verificationCode: newVerificationCode(),
    confirmed: false,
    reservedUntil,
    gsi1sk: ownerSortKey(raffleId, number),
    createdAt: now.toISOString(),
    // `orderId` se agrega recien cuando se confirma la compra (buildOrderFromReservations).
  };
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLES.tickets,
        Item: item,
        ConditionExpression:
          'attribute_not_exists(raffleId) OR (confirmed = :false AND reservedUntil < :now)',
        ExpressionAttributeValues: { ':false': false, ':now': now.toISOString() },
      }),
    );
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      throw conflict('Ese número ya no está disponible. Elegí otro.');
    }
    throw err;
  }
  return item;
}

/** Libera una reserva propia (el usuario deselecciona el número antes de pagar). */
export async function releaseReservation({ raffleId, number, dni }) {
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLES.tickets,
        Key: { raffleId, number },
        ConditionExpression:
          'dni = :dni AND confirmed = :false AND attribute_not_exists(orderId)',
        ExpressionAttributeValues: { ':dni': dni, ':false': false },
      }),
    );
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

/** Números tomados (confirmados o reservados y vigentes) en un rango [from, to]. */
export async function listUnavailableInRange(raffleId, from, to) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLES.tickets,
      KeyConditionExpression: 'raffleId = :r AND #n BETWEEN :from AND :to',
      ExpressionAttributeNames: { '#n': 'number' },
      ExpressionAttributeValues: { ':r': raffleId, ':from': from, ':to': to },
    }),
  );
  const nowIso = new Date().toISOString();
  return (Items || [])
    .filter((t) => t.confirmed || (t.reservedUntil && t.reservedUntil > nowIso))
    .map((t) => t.number);
}

/** Reservas "crudas" (sin orden todavía) que sigue teniendo `dni` en un sorteo. */
export async function listMyActiveReservations(dni, raffleId) {
  const tickets = await listTicketsByOwner(dni, raffleId);
  const nowIso = new Date().toISOString();
  return tickets.filter((t) => !t.orderId && !t.confirmed && t.reservedUntil > nowIso);
}

/**
 * Convierte las reservas sueltas de `numbers` en parte de una orden.
 * Atómico: si alguna ya no es válida (venció / la tomó otra persona), no se
 * confirma ninguna.
 */
export async function attachReservationsToOrder({ raffleId, numbers, dni, orderId }) {
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: numbers.map((number) => ({
          Update: {
            TableName: TABLES.tickets,
            Key: { raffleId, number },
            UpdateExpression: 'SET orderId = :orderId',
            ConditionExpression:
              'dni = :dni AND confirmed = :false AND attribute_not_exists(orderId) AND reservedUntil > :now',
            ExpressionAttributeValues: {
              ':orderId': orderId,
              ':dni': dni,
              ':false': false,
              ':now': now,
            },
          },
        })),
      }),
    );
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      throw conflict(
        'Uno o más números que elegiste ya no están reservados para vos. Volvé a elegir.',
      );
    }
    throw err;
  }
}

/** Marca como pagados los números de una orden (aprobación). */
export async function confirmReservedNumbers({ raffleId, numbers, orderId }) {
  if (!numbers.length) return;
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: numbers.map((number) => ({
        Update: {
          TableName: TABLES.tickets,
          Key: { raffleId, number },
          UpdateExpression: 'SET confirmed = :true',
          ConditionExpression: 'orderId = :orderId',
          ExpressionAttributeValues: { ':true': true, ':orderId': orderId },
        },
      })),
    }),
  );
}

/** Libera de inmediato los números de una orden (rechazo o vencimiento): quedan disponibles ya. */
export async function expireReservedNumbers({ raffleId, numbers, orderId }) {
  if (!numbers.length) return;
  const now = new Date().toISOString();
  await Promise.all(
    numbers.map((number) =>
      ddb
        .send(
          new UpdateCommand({
            TableName: TABLES.tickets,
            Key: { raffleId, number },
            UpdateExpression: 'SET reservedUntil = :now',
            ConditionExpression: 'orderId = :orderId AND confirmed = :false',
            ExpressionAttributeValues: { ':now': now, ':orderId': orderId, ':false': false },
          }),
        )
        .catch((err) => {
          if (err.name !== 'ConditionalCheckFailedException') throw err;
        }),
    ),
  );
}

/**
 * Extiende la reserva de los números de una orden mientras se revisa el
 * comprobante (revisión manual puede tardar más que el plazo original de pago).
 * No toca `confirmed`: solo corre el vencimiento hacia adelante.
 */
export async function holdReservedNumbers({ raffleId, numbers, orderId, hours }) {
  if (!numbers.length) return;
  const until = new Date(Date.now() + hours * 3600000).toISOString();
  await Promise.all(
    numbers.map((number) =>
      ddb
        .send(
          new UpdateCommand({
            TableName: TABLES.tickets,
            Key: { raffleId, number },
            UpdateExpression: 'SET reservedUntil = :until',
            ConditionExpression: 'orderId = :orderId AND confirmed = :false',
            ExpressionAttributeValues: { ':until': until, ':orderId': orderId, ':false': false },
          }),
        )
        .catch((err) => {
          if (err.name !== 'ConditionalCheckFailedException') throw err;
        }),
    ),
  );
}

/**
 * Da de alta números que ya se vendieron FUERA del sistema (sorteo que
 * arranca a mitad de camino, venta en persona/WhatsApp) y de los que no hay
 * comprador real cargado. Quedan permanentemente tomados, igual que si se
 * hubiera pagado, pero con un `dni` placeholder (no es un DNI de verdad).
 *
 * Nunca pisa un ticket que ya tiene una compra o reserva real vigente -en
 * ese caso lo salta y lo devuelve en `skipped`- para no poder tapar por
 * error una venta genuina hecha a través del sistema.
 */
export async function blockNumbers({ raffleId, numbers, note }) {
  const now = new Date().toISOString();
  const blocked = [];
  const skipped = [];

  await Promise.all(
    numbers.map(async (number) => {
      const item = {
        raffleId,
        number,
        dni: `offline-${number}`,
        holderName: note || 'Venta previa (fuera del sistema)',
        verificationCode: newVerificationCode(),
        confirmed: true,
        reservedUntil: now,
        gsi1sk: ownerSortKey(raffleId, number),
        createdAt: now,
        offline: true,
      };
      try {
        await ddb.send(
          new PutCommand({
            TableName: TABLES.tickets,
            Item: item,
            ConditionExpression:
              'attribute_not_exists(raffleId) OR (confirmed = :false AND reservedUntil < :now)',
            ExpressionAttributeValues: { ':false': false, ':now': now },
          }),
        );
        blocked.push(number);
      } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') {
          skipped.push(number);
        } else {
          throw err;
        }
      }
    }),
  );

  return { blocked, skipped };
}

/**
 * Asigna números puntuales a un DNI real (esté o no registrado todavía) de
 * forma ATÓMICA: si alguno de los números pedidos ya no está completamente
 * disponible (reservado en este momento por alguien más, o ya confirmado),
 * no se asigna NINGUNO — a diferencia de `blockNumbers`, acá no tiene sentido
 * un éxito parcial silencioso porque es una asignación puntual a una persona
 * concreta. Se usa `orderId` para que el número quede enganchado a una orden
 * real (así aparece en "Mis números" si esa persona se registra después, ver
 * [[sorteo-pick-mode]]).
 */
export async function assignNumbersToDni({ raffleId, numbers, dni, holderName, orderId }) {
  const now = new Date().toISOString();
  const items = numbers.map((number) => ({
    raffleId,
    number,
    dni,
    holderName: holderName || null,
    orderId,
    verificationCode: newVerificationCode(),
    confirmed: true,
    reservedUntil: now,
    gsi1sk: ownerSortKey(raffleId, number),
    createdAt: now,
    adminAssigned: true,
  }));

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: items.map((Item) => ({
          Put: {
            TableName: TABLES.tickets,
            Item,
            ConditionExpression:
              'attribute_not_exists(raffleId) OR (confirmed = :false AND reservedUntil < :now)',
            ExpressionAttributeValues: { ':false': false, ':now': now },
          },
        })),
      }),
    );
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      const reasons = err.CancellationReasons || [];
      const unavailable = numbers.filter((_, i) => reasons[i]?.Code === 'ConditionalCheckFailed');
      throw conflict(
        unavailable.length
          ? `Estos números ya no están disponibles: ${unavailable.join(', ')}. No se asignó ninguno.`
          : 'Uno o más números ya no están disponibles. No se asignó ninguno.',
      );
    }
    throw err;
  }

  return items;
}

/**
 * Revierte una aprobación (admin cambia de opinión): el número deja de estar
 * confirmado y queda liberado ya mismo. Caso raro, pero sin esto un número
 * "desaprobado" quedaría bloqueado para siempre.
 */
export async function releaseConfirmedNumbers({ raffleId, numbers, orderId }) {
  if (!numbers.length) return;
  const now = new Date().toISOString();
  await Promise.all(
    numbers.map((number) =>
      ddb
        .send(
          new UpdateCommand({
            TableName: TABLES.tickets,
            Key: { raffleId, number },
            UpdateExpression: 'SET confirmed = :false, reservedUntil = :now',
            ConditionExpression: 'orderId = :orderId',
            ExpressionAttributeValues: { ':false': false, ':orderId': orderId, ':now': now },
          }),
        )
        .catch((err) => {
          if (err.name !== 'ConditionalCheckFailedException') throw err;
        }),
    ),
  );
}
