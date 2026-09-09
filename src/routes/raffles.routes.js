import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import * as raffleService from '../services/raffleService.js';

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
