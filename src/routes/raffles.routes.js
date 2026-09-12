import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import * as raffleService from '../services/raffleService.js';
import * as pickService from '../services/pickService.js';

export const rafflesRouter = Router();

// GET /api/raffles           -> sorteos activos
// GET /api/raffles?status=all -> activos + pausados + finalizados
rafflesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const raffles =
      req.query.status === 'all'
        ? await raffleService.listPublicRaffles()
        : await raffleService.listActiveRaffles();
    res.json(raffles);
  }),
);

rafflesRouter.get(
  '/:raffleId',
  asyncHandler(async (req, res) => {
    res.json(await raffleService.getPublicRaffle(req.params.raffleId));
  }),
);

// ============ Sorteos "elegí tu número" ============

// Disponibilidad por rango (pública, sin login): números tomados/reservados
// entre `from` y `to`. Nunca devuelve más de ~500 de una (ver pickService).
rafflesRouter.get(
  '/:raffleId/numbers',
  asyncHandler(async (req, res) => {
    const from = Number(req.query.from ?? 0);
    const to = Number(req.query.to ?? from + 99);
    res.json(await pickService.getAvailability(req.params.raffleId, from, to));
  }),
);

// Mi selección vigente (números que reservé y todavía no vencieron).
rafflesRouter.get(
  '/:raffleId/numbers/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await pickService.getMySelection(req.user.dni, req.params.raffleId));
  }),
);

// Reservo un número puntual por PICK_RESERVATION_MINUTES (30 min por defecto).
rafflesRouter.post(
  '/:raffleId/numbers/:number/reserve',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pickService.reserveNumberForUser({
      raffleId: req.params.raffleId,
      number: req.params.number,
      dni: req.user.dni,
      holderName: req.user.name,
    });
    res.status(201).json(result);
  }),
);

// Deselecciono un número que había reservado (antes de pagar).
rafflesRouter.delete(
  '/:raffleId/numbers/:number/reserve',
  requireAuth,
  asyncHandler(async (req, res) => {
    await pickService.releaseNumberForUser({
      raffleId: req.params.raffleId,
      number: req.params.number,
      dni: req.user.dni,
    });
    res.status(204).end();
  }),
);
