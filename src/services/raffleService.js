import {
  getRaffle,
  listRafflesByStatus,
  listAllRaffles,
  createRaffle,
  updateRaffle,
} from '../repositories/raffleRepository.js';
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
    chanceTiers: (r.chanceTiers || []).slice().sort((a, b) => a.chances - b.chances),
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

// ---------------- Admin ----------------

export async function adminListRaffles() {
  return listAllRaffles();
}

export async function adminGetRaffle(raffleId) {
  const r = await getRaffle(raffleId);
  if (!r) throw notFound('Sorteo no encontrado');
  return r;
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
    chanceTiers: input.chanceTiers,
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
