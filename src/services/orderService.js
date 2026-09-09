import { env } from '../config/env.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { newOrderId } from '../lib/ids.js';
import { getRaffleForPurchase } from './raffleService.js';
import { getUserByDni } from '../repositories/userRepository.js';
import { reserveNumberBlock, bumpConfirmedChances } from '../repositories/raffleRepository.js';
import { buildTicketItems, putTickets } from '../repositories/ticketRepository.js';
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
    chances: o.chances,
    amount: o.amount,
    currency: o.currency || 'ARS',
    status: o.status,
    numbers: o.numbers || null,
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
 * Crea la orden y le asigna en el acto sus numeros CORRELATIVOS.
 */
export async function createPendingOrder({ dni, buyerName, raffleId, tierId }) {
  const raffle = await getRaffleForPurchase(raffleId);
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
  const order = await getOrder(orderId);
  if (!order) throw notFound('Orden no encontrada');
  if (order.dni !== dni) throw forbidden('Esta orden no es tuya');
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
  const order = await getOrder(orderId);
  if (!order || order.dni !== dni) throw notFound('Orden no encontrada');
  return publicOrder(order);
}

export async function listMyOrders(dni) {
  const orders = await listOrdersByBuyer(dni);
  return orders.filter((o) => o.status !== ORDER_STATUS.FAILED).map(publicOrder);
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

  if (order.status === ORDER_STATUS.APPROVED) {
    await bumpConfirmedChances(order.raffleId, -order.chances).catch(() => {});
  }
  return updateOrder(orderId, {
    status: ORDER_STATUS.REJECTED,
    rejectionReason: reason || 'El comprobante no es válido',
    reviewedBy: adminDni,
    reviewedAt: new Date().toISOString(),
  });
}
