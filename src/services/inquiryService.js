import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { newInquiryId, newMessageId } from '../lib/ids.js';
import {
  createInquiry,
  getInquiry,
  updateInquiry,
  listInquiriesByStatus,
  addMessage,
  listMessages,
} from '../repositories/inquiryRepository.js';
import { chatImageViewUrl } from './storageService.js';

const STATUS = { OPEN: 'open', CLOSED: 'closed' };

function publicInquiry(i) {
  if (!i) return null;
  return {
    inquiryId: i.inquiryId,
    dni: i.dni,
    name: i.name,
    whatsapp: i.whatsapp || null,
    email: i.email || null,
    summary: i.summary,
    status: i.status,
    createdAt: i.createdAt,
    lastMessageAt: i.lastMessageAt,
    lastMessageFrom: i.lastMessageFrom,
  };
}

async function publicMessage(m) {
  return {
    messageId: m.messageId,
    from: m.from, // 'customer' | 'admin'
    text: m.text || null,
    imageUrl: m.imageKey ? await chatImageViewUrl(m.imageKey) : null,
    createdAt: m.createdAt,
  };
}

/** El comprador pidió (o la IA decidió) pasar a un asesor humano. Acá arranca a guardarse todo. */
export async function escalate({ dni, name, whatsapp, email, summary, firstMessage, imageKey }) {
  if (!summary) throw badRequest('Falta el resumen de la conversación');
  const now = new Date().toISOString();
  const inquiryId = newInquiryId();
  const inquiry = {
    inquiryId,
    dni,
    name: name || null,
    whatsapp: whatsapp || null,
    email: email || null,
    summary,
    status: STATUS.OPEN,
    createdAt: now,
    lastMessageAt: now,
    lastMessageFrom: 'customer',
  };
  await createInquiry(inquiry);

  if (firstMessage || imageKey) {
    await addMessage({
      inquiryId,
      messageId: newMessageId(),
      from: 'customer',
      text: firstMessage || null,
      imageKey: imageKey || null,
      createdAt: now,
    });
  }

  return { inquiryId };
}

async function assertOwnInquiry(inquiryId, dni) {
  const inquiry = await getInquiry(inquiryId);
  if (!inquiry) throw notFound('Consulta no encontrada');
  if (inquiry.dni !== dni) throw forbidden('Esta consulta no es tuya');
  return inquiry;
}

/** El comprador manda un mensaje nuevo en su consulta ya escalada. */
export async function addCustomerMessage({ inquiryId, dni, text, imageKey }) {
  const inquiry = await assertOwnInquiry(inquiryId, dni);
  if (inquiry.status === STATUS.CLOSED) {
    throw badRequest('Esta consulta ya se cerró. Iniciá una nueva desde el chat.');
  }
  const now = new Date().toISOString();
  const message = {
    inquiryId,
    messageId: newMessageId(),
    from: 'customer',
    text: text || null,
    imageKey: imageKey || null,
    createdAt: now,
  };
  await addMessage(message);
  await updateInquiry(inquiryId, { lastMessageAt: now, lastMessageFrom: 'customer' });
  return publicMessage(message);
}

/** El comprador consulta los mensajes de SU consulta (para el polling del widget). */
export async function getMyInquiry({ inquiryId, dni }) {
  const inquiry = await assertOwnInquiry(inquiryId, dni);
  const messages = await listMessages(inquiryId);
  return {
    inquiry: publicInquiry(inquiry),
    messages: await Promise.all(messages.map(publicMessage)),
  };
}

// ---------------- Admin ----------------

export async function adminListInquiries(status = STATUS.OPEN) {
  const items = await listInquiriesByStatus(status);
  return items.map(publicInquiry);
}

export async function adminGetInquiry(inquiryId) {
  const inquiry = await getInquiry(inquiryId);
  if (!inquiry) throw notFound('Consulta no encontrada');
  const messages = await listMessages(inquiryId);
  return {
    inquiry: publicInquiry(inquiry),
    messages: await Promise.all(messages.map(publicMessage)),
  };
}

export async function adminReply({ inquiryId, adminDni, text }) {
  const inquiry = await getInquiry(inquiryId);
  if (!inquiry) throw notFound('Consulta no encontrada');
  if (!text?.trim()) throw badRequest('Escribí una respuesta');
  const now = new Date().toISOString();
  const message = {
    inquiryId,
    messageId: newMessageId(),
    from: 'admin',
    text: text.trim(),
    createdAt: now,
    adminDni,
  };
  await addMessage(message);
  await updateInquiry(inquiryId, { lastMessageAt: now, lastMessageFrom: 'admin' });
  return publicMessage(message);
}

export async function adminCloseInquiry(inquiryId) {
  const inquiry = await getInquiry(inquiryId);
  if (!inquiry) throw notFound('Consulta no encontrada');
  return publicInquiry(await updateInquiry(inquiryId, { status: STATUS.CLOSED }));
}
