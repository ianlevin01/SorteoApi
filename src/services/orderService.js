import { env } from '../config/env.js';
import { badRequest, notFound, forbidden, conflict } from '../lib/errors.js';
import { newOrderId } from '../lib/ids.js';
import { getRaffleForPurchase } from './raffleService.js';
import { getUserByDni } from '../repositories/userRepository.js';
import { reserveNumberBlock, bumpConfirmedChances } from '../repositories/raffleRepository.js';
import {
  buildTicketItems,
  putTickets,
  listMyActiveReservations,
  attachReservationsToOrder,
  confirmReservedNumbers,
  expireReservedNumbers,
  holdReservedNumbers,
  releaseConfirmedNumbers,
} from '../repositories/ticketRepository.js';
import {
  createOrder,
  getOrder,
  updateOrder,
  listOrdersByBuyer,
  listOrdersByStatus,
} from '../repositories/orderRepository.js';
import * as receiptVerification from './receiptVerificationService.js';

export const ORDER_STATUS = {
  PENDING: 'pending_payment', // orden creada, numeros asignados, falta pagar
  SUBMITTED: 'receipt_submitted', // comprobante cargado, en revision manual
  RECEIPT_REJECTED: 'receipt_rejected', // comprobante rechazado en la verificacion; se puede pedir revision
  APPROVED: 'approved', // pago confirmado -> numeros activos
  REJECTED: 'rejected', // rechazado definitivamente por un admin
  CANCELLED: 'cancelled',
  EXPIRED: 'expired', // (solo "elegí tu número") se venció el tiempo para pagar; numero liberado
  FAILED: 'failed', // fallo al asignar tickets (raro)
};

const CAN_ATTACH_RECEIPT = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.RECEIPT_REJECTED,
  ORDER_STATUS.REJECTED,
];
const CAN_APPROVE = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.RECEIPT_REJECTED,
];
const CAN_REQUEST_REVIEW = [ORDER_STATUS.RECEIPT_REJECTED];

/** true si la orden es de un sorteo "elegí tu número" (numeros.list en vez de numeros.start/end). */
function isPickOrder(order) {
  return order.mode === 'pick' || Array.isArray(order.numbers?.list);
}

function orderNumberList(order) {
  return order.numbers?.list || [];
}

/**
 * Si es una orden "elegí tu número" que sigue `pending_payment` y ya pasó su
 * `reservedUntil` (los 30 min para pagar), la vence: libera los números en la
 * tabla de tickets y marca la orden como `expired`. Se resuelve "perezosamente"
 * -acá, no con un job- la primera vez que alguien vuelve a mirar la orden.
 */
async function expireOrderIfNeeded(order) {
  if (!order || order.status !== ORDER_STATUS.PENDING) return order;
  if (!isPickOrder(order)) return order;
  if (!order.reservedUntil || order.reservedUntil > new Date().toISOString()) return order;

  await expireReservedNumbers({
    raffleId: order.raffleId,
    numbers: orderNumberList(order),
    orderId: order.orderId,
  }).catch(() => {});

  return updateOrder(order.orderId, {
    status: ORDER_STATUS.EXPIRED,
    rejectionReason: 'Se venció el tiempo de 30 minutos para pagar y el número quedó liberado.',
  }).catch(() => order);
}

const CHECK_LABELS = {
  document: 'Comprobante',
  amount: 'Monto',
  recipient: 'Destinatario',
  sender: 'Tu cuenta',
  date: 'Fecha',
};

export function paymentInstructions() {
  return {
    alias: env.payment.alias,
    cbu: env.payment.cbu,
    holder: env.payment.holder,
    bank: env.payment.bank,
  };
}

function publicChecks(checks) {
  if (!checks) return [];
  return Object.entries(CHECK_LABELS)
    .filter(([key]) => checks[key])
    .map(([key, label]) => ({ key, label, pass: checks[key].pass, detail: checks[key].detail }));
}

function publicVerification(order) {
  const v = order.verification;
  if (!v) return null;
  return {
    outcome: v.verdict, // 'pass' | 'reject' | 'review'
    issues: v.issues || [],
    checks: publicChecks(v.checks),
    attempts: v.attempts || 0,
    reviewRequested: Boolean(order.reviewRequestedAt),
  };
}

/** Vista de la orden para el frontend. */
export function publicOrder(o) {
  if (!o) return null;
  return {
    orderId: o.orderId,
    raffleId: o.raffleId,
    raffleTitle: o.raffleTitle,
    mode: isPickOrder(o) ? 'pick' : 'sequential',
    chances: o.chances,
    amount: o.amount,
    currency: o.currency || 'ARS',
    status: o.status,
    numbers: o.numbers || null,
    reservedUntil: o.reservedUntil || null,
    receipt: o.receipt
      ? { originalName: o.receipt.originalName, uploadedAt: o.receipt.uploadedAt }
      : null,
    rejectionReason: o.rejectionReason || null,
    verification: publicVerification(o),
    canAttachReceipt: CAN_ATTACH_RECEIPT.includes(o.status),
    canRequestReview: CAN_REQUEST_REVIEW.includes(o.status) && !o.reviewRequestedAt,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/**
 * Crea la orden pendiente de pago. Sortea por `raffle.mode`:
 * - 'sequential': le asigna en el acto un bloque de numeros CORRELATIVOS.
 * - 'pick': agrupa los numeros que el usuario ya venia reservando de a uno
 *   (ver pickService) en una única orden.
 */
export async function createPendingOrder({ dni, buyerName, raffleId, tierId, numbers }) {
  const raffle = await getRaffleForPurchase(raffleId);
  if ((raffle.mode || 'sequential') === 'pick') {
    return createPickOrder({ dni, buyerName, raffle, numbers });
  }
  return createSequentialOrder({ dni, buyerName, raffle, tierId });
}

async function createSequentialOrder({ dni, buyerName, raffle, tierId }) {
  const raffleId = raffle.raffleId;
  const tier = (raffle.chanceTiers || []).find((t) => t.id === tierId);
  if (!tier) throw badRequest('Elegí una cantidad de chances válida');

  const orderId = newOrderId();
  const now = new Date().toISOString();

  const { start, end } = await reserveNumberBlock(raffleId, tier.chances);

  const order = {
    orderId,
    dni,
    buyerName: buyerName || null,
    raffleId,
    raffleTitle: raffle.title,
    mode: 'sequential',
    tierId: tier.id,
    chances: tier.chances,
    amount: tier.price,
    currency: 'ARS',
    status: ORDER_STATUS.PENDING,
    numbers: { start, end, count: tier.chances },
    receipt: null,
    createdAt: now,
    updatedAt: now,
  };
  await createOrder(order);

  try {
    const tickets = buildTicketItems({
      raffleId,
      dni,
      holderName: buyerName,
      orderId,
      start,
      end,
    });
    await putTickets(tickets);
  } catch (err) {
    await updateOrder(orderId, {
      status: ORDER_STATUS.FAILED,
      lastError: `No se pudieron asignar los números: ${err.message}`,
    }).catch(() => {});
    throw err;
  }

  return { order: publicOrder(order), payment: paymentInstructions() };
}

async function createPickOrder({ dni, buyerName, raffle, numbers }) {
  const raffleId = raffle.raffleId;
  if (!Array.isArray(numbers) || !numbers.length) {
    throw badRequest('Elegí al menos un número');
  }
  if (!raffle.pricePerNumber) {
    throw badRequest('Este sorteo todavía no tiene un precio por número configurado');
  }

  const cleanNumbers = [...new Set(numbers.map((n) => Number(n)))].sort((a, b) => a - b);
  if (cleanNumbers.some((n) => !Number.isInteger(n) || n < 0 || n >= raffle.totalNumbers)) {
    throw badRequest('Alguno de los números elegidos no es válido');
  }

  // Traemos las reservas propias vigentes ANTES de asociarlas a la orden: una
  // vez que tienen `orderId` dejan de contar como "reserva activa suelta", asi
  // que es el único momento en que podemos leer su `reservedUntil` real.
  const myReservations = await listMyActiveReservations(dni, raffleId);
  const byNumber = new Map(myReservations.map((t) => [t.number, t]));
  const missing = cleanNumbers.find((n) => !byNumber.has(n));
  if (missing !== undefined) {
    throw conflict(
      `Ya no tenés reservado el número ${missing}. Puede haberse vencido: volvé a elegir tus números.`,
    );
  }

  const orderId = newOrderId();
  const now = new Date().toISOString();
  const reservedUntil = cleanNumbers
    .map((n) => byNumber.get(n).reservedUntil)
    .reduce((min, v) => (v < min ? v : min));

  const order = {
    orderId,
    dni,
    buyerName: buyerName || null,
    raffleId,
    raffleTitle: raffle.title,
    mode: 'pick',
    tierId: null,
    chances: cleanNumbers.length,
    amount: cleanNumbers.length * raffle.pricePerNumber,
    currency: 'ARS',
    status: ORDER_STATUS.PENDING,
    numbers: { list: cleanNumbers, count: cleanNumbers.length },
    reservedUntil,
    receipt: null,
    createdAt: now,
    updatedAt: now,
  };

  // Atómico: si alguno de estos números ya no está reservado por este dni
  // (se venció o, en teoría, ya es de otra orden) no se asocia NINGUNO.
  await attachReservationsToOrder({ raffleId, numbers: cleanNumbers, dni, orderId });

  try {
    await createOrder(order);
  } catch (err) {
    // Rarísimo: los tickets ya quedaron con este orderId pero la orden no se
    // pudo guardar. Los liberamos para no perder esos números para siempre.
    await expireReservedNumbers({ raffleId, numbers: cleanNumbers, orderId }).catch(() => {});
    throw err;
  }

  return { order: publicOrder(order), payment: paymentInstructions() };
}

async function operationAlreadyUsed(dni, operationId, currentOrderId) {
  if (!operationId) return false;
  const orders = await listOrdersByBuyer(dni);
  return orders.some(
    (o) =>
      o.orderId !== currentOrderId &&
      o.status !== ORDER_STATUS.FAILED &&
      o.verification?.extracted?.operationId &&
      String(o.verification.extracted.operationId).trim() ===
        String(operationId).trim(),
  );
}

/**
 * Adjunta el comprobante, lo verifica y decide el estado de la orden.
 * `receipt` ya viene subido a S3. `fileBuffer`/`mimeType` son para la verificacion.
 */
export async function attachReceipt({ dni, orderId, receipt, fileBuffer, mimeType, filename }) {
  let order = await getOrder(orderId);
  if (!order) throw notFound('Orden no encontrada');
  if (order.dni !== dni) throw forbidden('Esta orden no es tuya');

  order = await expireOrderIfNeeded(order);
  if (order.status === ORDER_STATUS.EXPIRED) {
    throw conflict('Se venció el tiempo de 30 minutos para pagar. Volvé a elegir tu número.');
  }
  if (!CAN_ATTACH_RECEIPT.includes(order.status)) {
    throw badRequest(`No se puede adjuntar un comprobante a una orden "${order.status}"`);
  }
  if (order.status === ORDER_STATUS.APPROVED) {
    return publicOrder(order);
  }

  const user = await getUserByDni(dni);
  const prevAttempts = order.verification?.attempts || 0;
  const now = new Date().toISOString();

  let verification;
  if (prevAttempts >= env.receiptCheck.maxAttempts) {
    verification = {
      runAt: now,
      verdict: 'review',
      reason: 'max_attempts',
      attempts: prevAttempts + 1,
      issues: [],
      checks: null,
      extracted: null,
    };
  } else {
    verification = await receiptVerification.verify({
      order,
      user,
      fileBuffer,
      mimeType,
      filename,
    });
    verification.attempts = prevAttempts + 1;

    if (
      verification.verdict !== 'reject' &&
      (await operationAlreadyUsed(dni, verification.extracted?.operationId, orderId))
    ) {
      verification.verdict = 'reject';
      verification.issues = ['Este comprobante ya fue usado en otra compra.'];
    }
  }

  let nextStatus = ORDER_STATUS.SUBMITTED;
  if (verification.verdict === 'pass') nextStatus = ORDER_STATUS.APPROVED;
  else if (verification.verdict === 'reject') nextStatus = ORDER_STATUS.RECEIPT_REJECTED;

  const patch = {
    status: nextStatus,
    receipt,
    verification,
    receiptSubmittedAt: now,
    rejectionReason:
      nextStatus === ORDER_STATUS.RECEIPT_REJECTED ? (verification.issues[0] || null) : null,
    reviewRequestedAt: null,
  };
  if (nextStatus === ORDER_STATUS.APPROVED) {
    patch.approvedBy = 'auto';
    patch.approvedAt = now;
  }

  const pick = isPickOrder(order);
  if (pick) {
    const nums = orderNumberList(order);
    if (nextStatus === ORDER_STATUS.APPROVED) {
      await confirmReservedNumbers({ raffleId: order.raffleId, numbers: nums, orderId }).catch(() => {});
    } else {
      // SUBMITTED (revisión manual) o RECEIPT_REJECTED (todavía puede pedir
      // revisión o volver a adjuntar otro comprobante): en ambos casos el
      // número sigue "en juego" para esta orden, así que NO se libera acá.
      // Solo se libera cuando la orden llega a un estado de verdad terminal
      // (rechazo definitivo del admin o vencimiento de los 30 min iniciales).
      const holdUntil = new Date(
        Date.now() + env.pickReviewHoldHours * 3600000,
      ).toISOString();
      await holdReservedNumbers({
        raffleId: order.raffleId,
        numbers: nums,
        orderId,
        hours: env.pickReviewHoldHours,
      }).catch(() => {});
      patch.reservedUntil = holdUntil;
    }
  }

  const updated = await updateOrder(orderId, patch);

  if (nextStatus === ORDER_STATUS.APPROVED) {
    await bumpConfirmedChances(order.raffleId, order.chances).catch(() => {});
  }
  return publicOrder(updated);
}

/** El usuario pide que una persona revise su comprobante rechazado. */
export async function requestReview({ dni, orderId, note }) {
  const order = await getOrder(orderId);
  if (!order || order.dni !== dni) throw notFound('Orden no encontrada');
  if (!CAN_REQUEST_REVIEW.includes(order.status)) {
    throw badRequest('Esta orden no está en un estado que permita pedir revisión');
  }
  const updated = await updateOrder(orderId, {
    status: ORDER_STATUS.SUBMITTED,
    reviewRequestedAt: new Date().toISOString(),
    reviewNote: note || null,
  });
  return publicOrder(updated);
}

export async function getMyOrder({ dni, orderId }) {
  let order = await getOrder(orderId);
  if (!order || order.dni !== dni) throw notFound('Orden no encontrada');
  order = await expireOrderIfNeeded(order);
  return publicOrder(order);
}

export async function listMyOrders(dni) {
  const orders = await listOrdersByBuyer(dni);
  const fresh = await Promise.all(orders.map(expireOrderIfNeeded));
  return fresh.filter((o) => o.status !== ORDER_STATUS.FAILED).map(publicOrder);
}

// ---------------- Admin ----------------

export async function adminListOrders(status = ORDER_STATUS.SUBMITTED) {
  return listOrdersByStatus(status);
}

export async function adminGetOrder(orderId) {
  const order = await getOrder(orderId);
  if (!order) throw notFound('Orden no encontrada');
  return order;
}

export async function approveOrder({ orderId, adminDni }) {
  const order = await getOrder(orderId);
  if (!order) throw notFound('Orden no encontrada');
  if (order.status === ORDER_STATUS.APPROVED) return order;
  if (!CAN_APPROVE.includes(order.status)) {
    throw badRequest(`No se puede aprobar una orden en estado "${order.status}"`);
  }

  if (isPickOrder(order)) {
    await confirmReservedNumbers({
      raffleId: order.raffleId,
      numbers: orderNumberList(order),
      orderId,
    }).catch(() => {});
  }

  const updated = await updateOrder(orderId, {
    status: ORDER_STATUS.APPROVED,
    approvedBy: adminDni,
    approvedAt: new Date().toISOString(),
    rejectionReason: null,
  });
  await bumpConfirmedChances(order.raffleId, order.chances).catch(() => {});
  return updated;
}

export async function rejectOrder({ orderId, adminDni, reason }) {
  const order = await getOrder(orderId);
  if (!order) throw notFound('Orden no encontrada');
  if (order.status === ORDER_STATUS.REJECTED) return order;

  const pick = isPickOrder(order);
  const nums = pick ? orderNumberList(order) : [];

  if (order.status === ORDER_STATUS.APPROVED) {
    await bumpConfirmedChances(order.raffleId, -order.chances).catch(() => {});
    // El admin revierte una aprobación previa: el número vuelve a estar libre.
    if (pick) await releaseConfirmedNumbers({ raffleId: order.raffleId, numbers: nums, orderId }).catch(() => {});
  } else if (pick) {
    // Rechazo definitivo: recién ahora, en un estado de verdad terminal, se
    // libera el número para que otra persona lo pueda elegir.
    await expireReservedNumbers({ raffleId: order.raffleId, numbers: nums, orderId }).catch(() => {});
  }

  return updateOrder(orderId, {
    status: ORDER_STATUS.REJECTED,
    rejectionReason: reason || 'El comprobante no es válido',
    reviewedBy: adminDni,
    reviewedAt: new Date().toISOString(),
  });
}
