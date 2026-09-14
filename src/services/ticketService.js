import {
  listTicketsByOwner,
  listTicketsByRaffle,
  getTicket,
  getTicketByCode,
} from '../repositories/ticketRepository.js';
import { listOrdersByBuyer, getOrder } from '../repositories/orderRepository.js';
import { getRaffle } from '../repositories/raffleRepository.js';
import { publicRaffle } from './raffleService.js';
import { maskName } from '../lib/ids.js';
import { notFound } from '../lib/errors.js';

/** Estado visible del ticket, derivado del estado de la orden. */
const TICKET_STATUS_BY_ORDER = {
  pending_payment: 'pending',
  receipt_submitted: 'in_review',
  receipt_rejected: 'rejected',
  approved: 'confirmed',
  rejected: 'rejected',
  cancelled: 'void',
  expired: 'void', // (solo "elegí tu número") se venció el tiempo para pagar
  failed: 'void',
};

export function ticketStatusFromOrder(orderStatus) {
  return TICKET_STATUS_BY_ORDER[orderStatus] || 'pending';
}

function bucketOf(status) {
  if (status === 'confirmed') return 'confirmed';
  if (status === 'rejected' || status === 'void') return 'rejected';
  return 'pending';
}

/**
 * Resumen para "Mis números": una entrada por sorteo con los conteos y las
 * órdenes. Se construye solo con las órdenes (rápido, 1 query + los sorteos).
 */
export async function getMyRaffleGroups(dni) {
  const orders = (await listOrdersByBuyer(dni)).filter(
    (o) => o.numbers && o.status !== 'failed',
  );
  if (orders.length === 0) return [];

  const byRaffle = new Map();
  for (const o of orders) {
    if (!byRaffle.has(o.raffleId)) byRaffle.set(o.raffleId, []);
    byRaffle.get(o.raffleId).push(o);
  }

  const raffleIds = [...byRaffle.keys()];
  const raffles = await Promise.all(raffleIds.map((id) => getRaffle(id)));

  return raffleIds
    .map((id, i) => {
      const raffleOrders = byRaffle.get(id);
      const counts = { total: 0, confirmed: 0, pending: 0, rejected: 0 };
      for (const o of raffleOrders) {
        const bucket = bucketOf(ticketStatusFromOrder(o.status));
        counts[bucket] += o.numbers.count;
        counts.total += o.numbers.count;
      }
      return {
        raffle: publicRaffle(raffles[i]) || { raffleId: id, title: 'Sorteo' },
        counts,
        orders: raffleOrders
          .map((o) => ({
            orderId: o.orderId,
            status: o.status,
            chances: o.chances,
            amount: o.amount,
            numbers: o.numbers,
            createdAt: o.createdAt,
          }))
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      };
    })
    .sort((a, b) =>
      String(b.raffle.createdAt || '').localeCompare(String(a.raffle.createdAt || '')),
    );
}

/** Todos los tickets del usuario en un sorteo, como colección para la billetera. */
export async function getMyRaffleTickets(dni, raffleId) {
  const [tickets, orders, raffle] = await Promise.all([
    listTicketsByOwner(dni, raffleId),
    listOrdersByBuyer(dni),
    getRaffle(raffleId),
  ]);
  if (!raffle) throw notFound('Sorteo no encontrado');

  const statusByOrder = new Map(orders.map((o) => [o.orderId, o.status]));

  return {
    raffle: publicRaffle(raffle),
    tickets: tickets
      // En sorteos "elegí tu número" cada tap crea un ticket suelto sin
      // `orderId` (reserva temporal, todavía no es una compra). No es un
      // número "mío" para la billetera hasta que forma parte de una orden.
      .filter((t) => t.orderId)
      .map((t) => ({
        number: t.number,
        verificationCode: t.verificationCode,
        status: ticketStatusFromOrder(statusByOrder.get(t.orderId) || 'pending_payment'),
        orderId: t.orderId,
        createdAt: t.createdAt,
      }))
      .sort((a, b) => a.number - b.number),
  };
}

/** Detalle de un ticket puntual (para abrir el ticket digital). */
export async function openTicket(dni, raffleId, number) {
  const ticket = await getTicket(raffleId, Number(number));
  if (!ticket || ticket.dni !== dni) throw notFound('Ticket no encontrado');

  const [raffle, order] = await Promise.all([
    getRaffle(raffleId),
    getOrder(ticket.orderId),
  ]);

  return {
    number: ticket.number,
    verificationCode: ticket.verificationCode,
    status: ticketStatusFromOrder(order?.status || 'pending_payment'),
    holder: ticket.holderName || order?.buyerName || null,
    raffle: publicRaffle(raffle),
    order: order
      ? { orderId: order.orderId, status: order.status, createdAt: order.createdAt }
      : null,
    createdAt: ticket.createdAt,
  };
}

/** Verificación pública por código (no expone datos completos del titular). */
export async function verifyByCode(code) {
  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized) return { found: false };

  const ticket = await getTicketByCode(normalized);
  if (!ticket) return { found: false };

  const [raffle, order] = await Promise.all([
    getRaffle(ticket.raffleId),
    getOrder(ticket.orderId),
  ]);
  const status = ticketStatusFromOrder(order?.status || 'pending_payment');

  return {
    found: true,
    valid: status === 'confirmed',
    status,
    number: ticket.number,
    holder: maskName(ticket.holderName || order?.buyerName),
    raffle: raffle
      ? {
          title: raffle.title,
          prizeTitle: raffle.prizeTitle || raffle.title,
          drawDate: raffle.drawDate || null,
          status: raffle.status,
        }
      : null,
    purchasedAt: ticket.createdAt,
  };
}

// ---------------- Admin ----------------

export async function adminRaffleTickets(raffleId) {
  const tickets = await listTicketsByRaffle(raffleId);
  return tickets.sort((a, b) => a.number - b.number);
}
