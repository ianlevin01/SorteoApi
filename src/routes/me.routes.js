import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import * as authService from '../services/authService.js';
import * as orderService from '../services/orderService.js';
import * as ticketService from '../services/ticketService.js';

export const meRouter = Router();
meRouter.use(requireAuth);

// Datos del usuario logueado
meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { user } = await authService.checkDni(req.user.dni);
    res.json(user);
  }),
);

// Mis compras
meRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    res.json(await orderService.listMyOrders(req.user.dni));
  }),
);

meRouter.get(
  '/orders/:orderId',
  asyncHandler(async (req, res) => {
    res.json(await orderService.getMyOrder({ dni: req.user.dni, orderId: req.params.orderId }));
  }),
);

// "Mis números": resumen por sorteo
meRouter.get(
  '/numbers',
  asyncHandler(async (req, res) => {
    res.json(await ticketService.getMyRaffleGroups(req.user.dni));
  }),
);

// "Mis números": colección de tickets de un sorteo
meRouter.get(
  '/numbers/:raffleId',
  asyncHandler(async (req, res) => {
    res.json(await ticketService.getMyRaffleTickets(req.user.dni, req.params.raffleId));
  }),
);

// Detalle de un ticket puntual (para abrir el ticket digital)
meRouter.get(
  '/tickets/:raffleId/:number',
  asyncHandler(async (req, res) => {
    res.json(
      await ticketService.openTicket(req.user.dni, req.params.raffleId, req.params.number),
    );
  }),
);
