import { Router } from 'express';
import multer from 'multer';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { notFound, badRequest } from '../lib/errors.js';
import { createRaffleSchema, updateRaffleSchema } from '../schemas/raffle.schema.js';
import { rejectOrderSchema } from '../schemas/order.schema.js';
import * as raffleService from '../services/raffleService.js';
import * as orderService from '../services/orderService.js';
import * as ticketService from '../services/ticketService.js';
import * as pickService from '../services/pickService.js';
import * as inquiryService from '../services/inquiryService.js';
import { receiptViewUrl, uploadMedia, IMAGE_MIME_TYPES } from '../services/storageService.js';

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIME_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(badRequest('La imagen debe ser JPG, PNG o WEBP'));
  },
});

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// ---- Imágenes (premios / ganadores) ----
adminRouter.post(
  '/media',
  imageUpload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Adjuntá una imagen');
    res.status(201).json(await uploadMedia({ file: req.file, folder: req.query.folder }));
  }),
);

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

adminRouter.delete(
  '/raffles/:raffleId',
  asyncHandler(async (req, res) => {
    await raffleService.adminDeleteRaffle(req.params.raffleId);
    res.status(204).end();
  }),
);

adminRouter.get(
  '/raffles/:raffleId/stats',
  asyncHandler(async (req, res) => {
    res.json(await raffleService.adminRaffleStats(req.params.raffleId));
  }),
);

adminRouter.get(
  '/raffles/:raffleId/tickets',
  asyncHandler(async (req, res) => {
    res.json(await ticketService.adminRaffleTickets(req.params.raffleId));
  }),
);

// Dar de alta números ya vendidos fuera del sistema (sorteo "elegí tu
// número" que ya estaba en marcha antes de migrarlo). Sin comprador real.
adminRouter.post(
  '/raffles/:raffleId/numbers/block',
  asyncHandler(async (req, res) => {
    const result = await pickService.blockNumbersForAdmin({
      raffleId: req.params.raffleId,
      numbers: req.body?.numbers,
      note: req.body?.note,
    });
    res.status(201).json(result);
  }),
);

// Asigna números puntuales a un DNI real (esté o no registrado). A
// diferencia de /numbers/block, crea una orden real para que la persona
// vea sus números en "Mis números" si se registra después.
adminRouter.post(
  '/raffles/:raffleId/numbers/assign',
  asyncHandler(async (req, res) => {
    const result = await pickService.assignNumbersForAdmin({
      raffleId: req.params.raffleId,
      numbers: req.body?.numbers,
      dni: req.body?.dni,
      name: req.body?.name,
      note: req.body?.note,
    });
    res.status(201).json(result);
  }),
);

// ---- Ordenes ----
adminRouter.get(
  '/orders-summary',
  asyncHandler(async (_req, res) => {
    res.json(await orderService.adminOrdersSummary());
  }),
);

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

// ---- Consultas (derivadas del chat con el asistente) ----

adminRouter.get(
  '/inquiries',
  asyncHandler(async (req, res) => {
    res.json(await inquiryService.adminListInquiries(req.query.status || 'open'));
  }),
);

adminRouter.get(
  '/inquiries/:inquiryId',
  asyncHandler(async (req, res) => {
    res.json(await inquiryService.adminGetInquiry(req.params.inquiryId));
  }),
);

adminRouter.post(
  '/inquiries/:inquiryId/messages',
  asyncHandler(async (req, res) => {
    const message = await inquiryService.adminReply({
      inquiryId: req.params.inquiryId,
      adminDni: req.user.dni,
      text: req.body?.text,
    });
    res.status(201).json(message);
  }),
);

adminRouter.post(
  '/inquiries/:inquiryId/close',
  asyncHandler(async (req, res) => {
    res.json(await inquiryService.adminCloseInquiry(req.params.inquiryId));
  }),
);
