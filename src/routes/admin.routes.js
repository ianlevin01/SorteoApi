import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';
import { createRaffleSchema, updateRaffleSchema } from '../schemas/raffle.schema.js';
import { rejectOrderSchema } from '../schemas/order.schema.js';
import * as raffleService from '../services/raffleService.js';
import * as orderService from '../services/orderService.js';
import * as ticketService from '../services/ticketService.js';
import { receiptViewUrl } from '../services/storageService.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// ---- Sorteos ----
adminRouter.get(
  '/raffles',
  asyncHandler(async (_req, res) => {
    res.json(await raffleService.adminListRaffles());
  }),
);

adminRouter.post(
  '/raffles',
  validate(createRaffleSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await raffleService.adminCreateRaffle(req.valid.body));
  }),
);

adminRouter.get(
  '/raffles/:raffleId',
  asyncHandler(async (req, res) => {
    res.json(await raffleService.adminGetRaffle(req.params.raffleId));
  }),
);

adminRouter.patch(
  '/raffles/:raffleId',
  validate(updateRaffleSchema),
  asyncHandler(async (req, res) => {
    res.json(await raffleService.adminUpdateRaffle(req.params.raffleId, req.valid.body));
  }),
);

adminRouter.get(
  '/raffles/:raffleId/tickets',
  asyncHandler(async (req, res) => {
    res.json(await ticketService.adminRaffleTickets(req.params.raffleId));
  }),
);

// ---- Ordenes ----
adminRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const status = req.query.status || 'receipt_submitted';
    res.json(await orderService.adminListOrders(status));
  }),
);

adminRouter.get(
  '/orders/:orderId',
  asyncHandler(async (req, res) => {
    res.json(await orderService.adminGetOrder(req.params.orderId));
  }),
);

// URL firmada para ver el comprobante
adminRouter.get(
  '/orders/:orderId/receipt-url',
  asyncHandler(async (req, res) => {
    const order = await orderService.adminGetOrder(req.params.orderId);
    if (!order.receipt?.key) throw notFound('La orden no tiene comprobante cargado');
    res.json({ url: await receiptViewUrl(order.receipt.key), receipt: order.receipt });
  }),
);

adminRouter.post(
  '/orders/:orderId/approve',
  asyncHandler(async (req, res) => {
    res.json(
      await orderService.approveOrder({ orderId: req.params.orderId, adminDni: req.user.dni }),
    );
  }),
);

adminRouter.post(
  '/orders/:orderId/reject',
  validate(rejectOrderSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await orderService.rejectOrder({
        orderId: req.params.orderId,
        adminDni: req.user.dni,
        reason: req.valid.body.reason,
      }),
    );
  }),
);
