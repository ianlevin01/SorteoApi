import { Router } from 'express';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { badRequest } from '../lib/errors.js';
import * as chatService from '../services/chatService.js';
import * as inquiryService from '../services/inquiryService.js';
import { uploadChatImageFromDataUrl } from '../services/storageService.js';
import { getUserByDni } from '../repositories/userRepository.js';

export const chatRouter = Router();

// Un turno de chat con el asistente. Nunca se guarda nada acá: el cliente
// manda todo el historial que tiene en su localStorage cada vez.
chatRouter.post(
  '/message',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const user = req.user ? await getUserByDni(req.user.dni) : null;
    const result = await chatService.reply({
      history: Array.isArray(req.body?.history) ? req.body.history : [],
      message: req.body?.message,
      imageDataUrl: req.body?.imageDataUrl,
      user,
    });
    res.json(result);
  }),
);

// La IA (o el usuario) decidió pasar a un asesor humano. Recién acá arranca
// a guardarse algo en la base.
chatRouter.post(
  '/escalate',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { summary, firstMessage, imageDataUrl } = req.body || {};
    if (!summary?.trim()) throw badRequest('Falta el resumen de la conversación');
    const user = await getUserByDni(req.user.dni);
    if (!user) throw badRequest('No encontramos tu usuario');

    let imageKey = null;
    if (imageDataUrl) {
      const uploaded = await uploadChatImageFromDataUrl({ dni: user.dni, dataUrl: imageDataUrl });
      imageKey = uploaded.key;
    }

    const result = await inquiryService.escalate({
      dni: user.dni,
      name: `${user.firstName} ${user.lastName}`.trim(),
      whatsapp: user.whatsapp,
      email: user.email,
      summary: summary.trim(),
      firstMessage: firstMessage?.trim() || null,
      imageKey,
    });

    res.status(201).json(result);
  }),
);

// Polling del comprador: estado + mensajes de SU consulta ya escalada.
chatRouter.get(
  '/inquiries/:inquiryId',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await inquiryService.getMyInquiry({ inquiryId: req.params.inquiryId, dni: req.user.dni }));
  }),
);

// El comprador manda un mensaje nuevo en el chat en vivo (ya escalado).
chatRouter.post(
  '/inquiries/:inquiryId/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { text, imageDataUrl } = req.body || {};
    if (!text?.trim() && !imageDataUrl) throw badRequest('Escribí un mensaje');
    let imageKey = null;
    if (imageDataUrl) {
      const uploaded = await uploadChatImageFromDataUrl({ dni: req.user.dni, dataUrl: imageDataUrl });
      imageKey = uploaded.key;
    }
    const message = await inquiryService.addCustomerMessage({
      inquiryId: req.params.inquiryId,
      dni: req.user.dni,
      text: text?.trim() || null,
      imageKey,
    });
    res.status(201).json(message);
  }),
);
