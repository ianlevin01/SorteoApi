import { env } from '../config/env.js';
import { badRequest } from '../lib/errors.js';
import { newOrderId } from '../lib/ids.js';
import { getPickRaffleForPurchase, getPickRaffle } from './raffleService.js';
import { createOrder } from '../repositories/orderRepository.js';
import {
  reserveNumber,
  releaseReservation,
  listUnavailableInRange,
  listMyActiveReservations,
  blockNumbers,
  assignNumbersToDni,
  releaseConfirmedNumbers,
} from '../repositories/ticketRepository.js';

const MAX_RANGE = 500; // no dejamos pedir rangos gigantes de una

function assertNumberInRange(raffle, number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 0 || n >= raffle.totalNumbers) {
    throw badRequest(`El número tiene que estar entre 0 y ${raffle.totalNumbers - 1}`);
  }
  return n;
}

/** Números NO disponibles (tomados o reservados) en [from, to] de un sorteo "elegí tu número". */
export async function getAvailability(raffleId, from, to) {
  const raffle = await getPickRaffleForPurchase(raffleId).catch(() => null);
  const max = raffle?.totalNumbers ?? to + 1;
  const f = Math.max(0, Number(from) || 0);
  const t = Math.min(max - 1, f + MAX_RANGE, Number(to) || f);
  if (t < f) throw badRequest('Rango inválido');
  const unavailable = await listUnavailableInRange(raffleId, f, t);
  return { from: f, to: t, unavailable };
}

/** Reserva un número para el usuario logueado. */
export async function reserveNumberForUser({ raffleId, number, dni, holderName }) {
  const raffle = await getPickRaffleForPurchase(raffleId);
  const n = assertNumberInRange(raffle, number);
  const ticket = await reserveNumber({
    raffleId,
    number: n,
    dni,
    holderName,
    minutes: env.pickReservationMinutes,
  });
  return { number: n, reservedUntil: ticket.reservedUntil };
}

const MAX_RANDOM = 20; // tope por pedido, para no permitir un abuso

/**
 * Reserva `count` números al azar entre los disponibles. Prueba candidatos al
 * azar y reintenta ante un choque (número ya tomado/reservado) — con un
 * sorteo recién lanzado esto acierta casi siempre a la primera; si ya está
 * muy vendido, puede devolver menos de los pedidos (nunca falla del todo si
 * consiguió al menos uno).
 */
export async function reserveRandomNumbersForUser({ raffleId, count, dni, holderName }) {
  const raffle = await getPickRaffleForPurchase(raffleId);
  const n = Math.max(1, Math.min(MAX_RANDOM, Number(count) || 1));
  if (n > raffle.totalNumbers) {
    throw badRequest('Este sorteo no tiene tantos números.');
  }

  const reserved = [];
  const tried = new Set();
  const maxAttempts = Math.max(30, n * 30);
  let attempts = 0;

  while (reserved.length < n && attempts < maxAttempts) {
    attempts += 1;
    const candidate = Math.floor(Math.random() * raffle.totalNumbers);
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    try {
      // eslint-disable-next-line no-await-in-loop
      const ticket = await reserveNumber({
        raffleId,
        number: candidate,
        dni,
        holderName,
        minutes: env.pickReservationMinutes,
      });
      reserved.push({ number: candidate, reservedUntil: ticket.reservedUntil });
    } catch (err) {
      if (err.status !== 409) throw err; // otro problema real: no lo tragamos
      // 409 = ese número ya no está libre; probamos otro candidato
    }
  }

  if (reserved.length === 0) {
    throw badRequest('No pudimos encontrar números libres al azar. Probá elegir manualmente.');
  }

  return { reserved: reserved.sort((a, b) => a.number - b.number), requested: n };
}

/** Libera (deselecciona) un número reservado por el propio usuario. */
export async function releaseNumberForUser({ raffleId, number, dni }) {
  const released = await releaseReservation({ raffleId, number: Number(number), dni });
  if (!released) {
    throw badRequest('Ese número no está reservado por vos (o ya se convirtió en una compra).');
  }
}

const MAX_BLOCK_PER_CALL = 5000;

/**
 * Admin: da de alta números ya vendidos FUERA del sistema (sorteo que ya
 * estaba en marcha antes de migrarlo, ventas en persona/WhatsApp, etc.), sin
 * datos de comprador reales. Quedan tomados para siempre, igual que una
 * venta real, pero nunca pisa un número que ya tiene una compra o reserva
 * real vigente (esos vuelven en `skipped`).
 */
export async function blockNumbersForAdmin({ raffleId, numbers, note }) {
  const raffle = await getPickRaffle(raffleId);
  if (!Array.isArray(numbers) || !numbers.length) {
    throw badRequest('Mandá al menos un número');
  }
  const clean = [...new Set(numbers.map((n) => Number(n)))];
  if (clean.length > MAX_BLOCK_PER_CALL) {
    throw badRequest(`No se puede cargar más de ${MAX_BLOCK_PER_CALL} números de una vez`);
  }
  const invalid = clean.filter((n) => !Number.isInteger(n) || n < 0 || n >= raffle.totalNumbers);
  if (invalid.length) {
    throw badRequest(
      `Hay números fuera de rango (0 a ${raffle.totalNumbers - 1}): ${invalid.slice(0, 10).join(', ')}${invalid.length > 10 ? '…' : ''}`,
    );
  }
  const { blocked, skipped } = await blockNumbers({ raffleId, numbers: clean, note });
  return {
    blocked: blocked.sort((a, b) => a - b),
    skipped: skipped.sort((a, b) => a - b),
  };
}

const MAX_ASSIGN_PER_CALL = 100; // DynamoDB permite hasta 100 items por transacción

/**
 * Admin: asigna números puntuales a un DNI real (esté o no registrado
 * todavía) — regalo, corrección, venta que sí tiene datos del comprador. A
 * diferencia de `blockNumbersForAdmin` (venta offline sin comprador real),
 * acá se crea una orden real (status `approved`, monto $0 porque no hubo
 * cobro por la plataforma) para que la persona vea sus números en "Mis
 * números" apenas se registre con ese DNI — no hace falta crearle el
 * usuario. Es TODO O NADA: si algún número ya no está completamente
 * disponible, no se asigna ninguno.
 */
export async function assignNumbersForAdmin({ raffleId, numbers, dni, name, note }) {
  const raffle = await getPickRaffle(raffleId);

  const cleanDni = String(dni || '').replace(/\D/g, '');
  if (!/^\d{7,8}$/.test(cleanDni)) {
    throw badRequest('DNI inválido (7 u 8 dígitos)');
  }
  if (!Array.isArray(numbers) || !numbers.length) {
    throw badRequest('Mandá al menos un número');
  }
  const clean = [...new Set(numbers.map((n) => Number(n)))].sort((a, b) => a - b);
  if (clean.length > MAX_ASSIGN_PER_CALL) {
    throw badRequest(`No se puede asignar más de ${MAX_ASSIGN_PER_CALL} números de una vez`);
  }
  const invalid = clean.filter((n) => !Number.isInteger(n) || n < 0 || n >= raffle.totalNumbers);
  if (invalid.length) {
    throw badRequest(
      `Hay números fuera de rango (0 a ${raffle.totalNumbers - 1}): ${invalid.slice(0, 10).join(', ')}${invalid.length > 10 ? '…' : ''}`,
    );
  }

  const orderId = newOrderId();
  const now = new Date().toISOString();

  // Atómico entre sí (todo o nada): si alguno no está disponible, no
  // asigna ninguno y tira un error claro con cuáles son.
  await assignNumbersToDni({ raffleId, numbers: clean, dni: cleanDni, holderName: name || null, orderId });

  const order = {
    orderId,
    dni: cleanDni,
    buyerName: name || null,
    raffleId,
    raffleTitle: raffle.title,
    mode: 'pick',
    tierId: null,
    chances: clean.length,
    amount: 0,
    currency: 'ARS',
    status: 'approved',
    numbers: { list: clean, count: clean.length },
    receipt: null,
    approvedBy: 'admin',
    adminAssigned: true,
    note: note || null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await createOrder(order);
  } catch (err) {
    // Rarísimo (falla de red/AWS justo acá): los números ya quedaron
    // asignados pero la orden no se pudo crear. Los liberamos para no dejar
    // "números fantasma" confirmados sin ninguna orden detrás.
    await releaseConfirmedNumbers({ raffleId, numbers: clean, orderId }).catch(() => {});
    throw err;
  }

  return { orderId, dni: cleanDni, numbers: clean };
}

/** Selección activa del usuario (números reservados, sin orden todavía). */
export async function getMySelection(dni, raffleId) {
  const reservations = await listMyActiveReservations(dni, raffleId);
  return reservations
    .map((t) => ({ number: t.number, reservedUntil: t.reservedUntil }))
    .sort((a, b) => a.number - b.number);
}
