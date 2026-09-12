import { env } from '../config/env.js';
import { badRequest } from '../lib/errors.js';
import { getPickRaffleForPurchase } from './raffleService.js';
import {
  reserveNumber,
  releaseReservation,
  listUnavailableInRange,
  listMyActiveReservations,
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

/** Libera (deselecciona) un número reservado por el propio usuario. */
export async function releaseNumberForUser({ raffleId, number, dni }) {
  const released = await releaseReservation({ raffleId, number: Number(number), dni });
  if (!released) {
    throw badRequest('Ese número no está reservado por vos (o ya se convirtió en una compra).');
  }
}

/** Selección activa del usuario (números reservados, sin orden todavía). */
export async function getMySelection(dni, raffleId) {
  const reservations = await listMyActiveReservations(dni, raffleId);
  return reservations
    .map((t) => ({ number: t.number, reservedUntil: t.reservedUntil }))
    .sort((a, b) => a.number - b.number);
}
