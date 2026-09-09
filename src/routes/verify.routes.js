import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import * as ticketService from '../services/ticketService.js';

export const verifyRouter = Router();

// Publico: verificar la autenticidad de un ticket por su codigo.
verifyRouter.get(
  '/:code',
  asyncHandler(async (req, res) => {
    res.json(await ticketService.verifyByCode(req.params.code));
  }),
);
