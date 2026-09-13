import {
  getRaffle,
  listRafflesByStatus,
  listAllRaffles,
  createRaffle,
  updateRaffle,
  deleteRaffle,
} from '../repositories/raffleRepository.js';
import { listTicketsByRaffle } from '../repositories/ticketRepository.js';
import { notFound, badRequest } from '../lib/errors.js';
import { newRaffleId, slugify } from '../lib/ids.js';

const PUBLIC_STATUSES = new Set(['active', 'paused', 'finished']);

/** Version del sorteo que ve el publico (sin campos internos). */
export function publicRaffle(r) {
  if (!r) return null;
  return {
    raffleId: r.raffleId,
    slug: r.slug,
    title: r.title,
    description: r.description || '',
    prizeTitle: r.prizeTitle || r.title,
    prizeDescription: r.prizeDescription || '',
    images: r.images || [],
    coverImage: r.coverImage || (r.images && r.images[0]) || null,
    mode: r.mode || 'sequential', // 'sequential' (numeros correlativos) | 'pick' (elegis el numero)
    chanceTiers: (r.chanceTiers || []).slice().sort((a, b) => a.chances - b.chances),
    pricePerNumber: r.pricePerNumber ?? null, // solo aplica a mode: 'pick'
    totalNumbers: r.totalNumbers ?? null,
    numbersAssigned: r.assignedCount || 0,
    confirmedChances: r.confirmedChances || 0,
    featured: Boolean(r.featured),
    status: r.status,
    drawDate: r.drawDate || null,
    winner: r.winner || null,
    createdAt: r.createdAt,
  };
}

export async function listActiveRaffles() {
  const items = await listRafflesByStatus('active');
  return items.map(publicRaffle);
}

export async function listPublicRaffles() {
  const all = await listAllRaffles();
  return all.filter((r) => PUBLIC_STATUSES.has(r.status)).map(publicRaffle);
}

export async function getPublicRaffle(raffleId) {
  const r = await getRaffle(raffleId);
  if (!r || !PUBLIC_STATUSES.has(r.status)) {
    throw notFound('Sorteo no encontrado');
  }
  return publicRaffle(r);
}

/** Trae el sorteo crudo y valida que este recibiendo compras. */
export async function getRaffleForPurchase(raffleId) {
  const r = await getRaffle(raffleId);
  if (!r) throw notFound('Sorteo no encontrado');
  if (r.status !== 'active') {
    throw badRequest('Este sorteo no está recibiendo compras en este momento');
  }
  return r;
}

/** Igual que `getRaffleForPurchase`, pero exige que sea de tipo "elegí tu número". */
export async function getPickRaffleForPurchase(raffleId) {
  const r = await getRaffleForPurchase(raffleId);
  if ((r.mode || 'sequential') !== 'pick') {
    throw badRequest('Este sorteo no permite elegir el número');
  }
  return r;
}

// ---------------- Admin ----------------

export async function adminListRaffles() {
  return listAllRaffles();
}

export async function adminGetRaffle(raffleId) {
  const r = await getRaffle(raffleId);
  if (!r) throw notFound('Sorteo no encontrado');
  return r;
}

/** Métricas de un sorteo para el panel. */
export async function adminRaffleStats(raffleId) {
  const raffle = await getRaffle(raffleId);
  if (!raffle) throw notFound('Sorteo no encontrado');

  const mode = raffle.mode || 'sequential';
  const tickets = await listTicketsByRaffle(raffleId);

  let numbersAssigned;
  let numbersConfirmed;
  let participants;

  if (mode === 'pick') {
    // en "elegí tu número" no hay contador global: se cuenta de los tickets
    // los confirmados o con una reserva todavía vigente.
    const nowIso = new Date().toISOString();
    const held = tickets.filter((t) => t.confirmed || (t.reservedUntil && t.reservedUntil > nowIso));
    numbersAssigned = held.length;
    numbersConfirmed = held.filter((t) => t.confirmed).length;
    participants = new Set(held.map((t) => t.dni)).size;
  } else {
    numbersAssigned = raffle.assignedCount || 0; // entregados (incluye no pagados)
    numbersConfirmed = raffle.confirmedChances || 0; // con pago confirmado
    participants = new Set(tickets.map((t) => t.dni)).size;
  }

  return {
    raffleId,
    mode,
    status: raffle.status,
    totalNumbers: raffle.totalNumbers ?? null,
    numbersAssigned,
    numbersConfirmed,
    participants,
    progress: raffle.totalNumbers
      ? Math.min(100, Math.round((numbersAssigned / raffle.totalNumbers) * 100))
      : null,
  };
}

export async function adminCreateRaffle(input) {
  const now = new Date().toISOString();
  const raffleId = newRaffleId();
  const raffle = {
    raffleId,
    slug: slugify(input.title) || raffleId,
    title: input.title,
    description: input.description || '',
    prizeTitle: input.prizeTitle || input.title,
    prizeDescription: input.prizeDescription || '',
    images: input.images || [],
    coverImage: input.coverImage || (input.images && input.images[0]) || null,
    mode: input.mode || 'sequential',
    chanceTiers: input.chanceTiers || [],
    pricePerNumber: input.pricePerNumber ?? null,
    totalNumbers: input.totalNumbers,
    status: input.status || 'draft',
    featured: Boolean(input.featured),
    drawDate: input.drawDate || null,
    assignedCount: 0,
    confirmedChances: 0,
    winner: null,
    createdAt: now,
    updatedAt: now,
  };
  await createRaffle(raffle);
  return raffle;
}

/**
 * Solo se puede borrar un sorteo que todavía no tiene ninguna actividad real
 * (ni un número asignado/reservado). Si ya hay tickets de por medio, mejor
 * pausarlo o marcarlo finalizado: borrar perdería el rastro de compradores
 * reales.
 */
export async function adminDeleteRaffle(raffleId) {
  const raffle = await getRaffle(raffleId);
  if (!raffle) throw notFound('Sorteo no encontrado');
  const tickets = await listTicketsByRaffle(raffleId);
  if (tickets.length > 0) {
    throw badRequest(
      'No se puede eliminar: ya tiene números asignados o reservados. Pausalo o marcalo como finalizado en cambio.',
    );
  }
  await deleteRaffle(raffleId);
}

export async function adminUpdateRaffle(raffleId, patch) {
  const current = await getRaffle(raffleId);
  if (!current) throw notFound('Sorteo no encontrado');

  const next = { ...patch };
  if (patch.title) next.slug = slugify(patch.title) || current.slug;
  if (
    patch.totalNumbers != null &&
    patch.totalNumbers < (current.assignedCount || 0)
  ) {
    throw badRequest(
      `No se puede bajar el total a ${patch.totalNumbers}: ya se asignaron ${current.assignedCount} números`,
    );
  }
  return updateRaffle(raffleId, next);
}
