import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { badRequest } from '../lib/errors.js';
import { createOrderSchema, requestReviewSchema } from '../schemas/order.schema.js';
import * as orderService from '../services/orderService.js';
import { uploadReceipt, RECEIPT_MIME_TYPES } from '../services/storageService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (RECEIPT_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(badRequest('El comprobante debe ser JPG, PNG, WEBP o PDF'));
    }
  },
});

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

// Crear orden pendiente -> devuelve datos de la transferencia
ordersRouter.post(
  '/',
  validate(createOrderSchema),
  asyncHandler(async (req, res) => {
    const result = await orderService.createPendingOrder({
      dni: req.user.dni,
      buyerName: req.user.name,
      raffleId: req.valid.body.raffleId,
      tierId: req.valid.body.tierId,
      numbers: req.valid.body.numbers,
    });
    res.status(201).json(result);
  }),
);

// Adjuntar comprobante de transferencia -> se sube a S3 y se verifica
ordersRouter.post(
  '/:orderId/receipt',
  upload.single('receipt'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Adjuntá el comprobante de la transferencia');
    const receipt = await uploadReceipt({
      orderId: req.params.orderId,
      dni: req.user.dni,
      file: req.file,
    });
    const order = await orderService.attachReceipt({
      dni: req.user.dni,
      orderId: req.params.orderId,
      receipt,
      fileBuffer: req.file.buffer,
      mimeType: req.file.mimetype,
      filename: req.file.originalname,
    });
    res.json(order);
  }),
);

// Pedir revisión de un comprobante rechazado
ordersRouter.post(
  '/:orderId/request-review',
  validate(requestReviewSchema),
  asyncHandler(async (req, res) => {
    const order = await orderService.requestReview({
      dni: req.user.dni,
      orderId: req.params.orderId,
      note: req.valid.body.note,
    });
    res.json(order);
  }),
);
