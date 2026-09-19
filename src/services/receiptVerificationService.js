import { getOpenAI } from '../config/openai.js';
import { env } from '../config/env.js';
import { evaluateReceipt } from '../lib/receiptChecks.js';

export function isEnabled() {
  return env.receiptCheck.enabled && Boolean(env.openai.apiKey);
}

const NULLABLE_STRING = { type: ['string', 'null'] };

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    documentType: { type: 'string', enum: ['transfer_receipt', 'other', 'unreadable'] },
    looksAuthentic: { type: 'boolean' },
    authenticityNotes: NULLABLE_STRING,
    confidence: { type: 'number' },
    amount: { type: ['number', 'null'] },
    currency: NULLABLE_STRING,
    recipientName: NULLABLE_STRING,
    recipientAlias: NULLABLE_STRING,
    recipientCbu: NULLABLE_STRING,
    senderName: NULLABLE_STRING,
    senderTaxId: NULLABLE_STRING,
    senderAccount: NULLABLE_STRING,
    dateText: NULLABLE_STRING,
    dateIso: NULLABLE_STRING,
    operationId: NULLABLE_STRING,
    bank: NULLABLE_STRING,
  },
  required: [
    'documentType',
    'looksAuthentic',
    'authenticityNotes',
    'confidence',
    'amount',
    'currency',
    'recipientName',
    'recipientAlias',
    'recipientCbu',
    'senderName',
    'senderTaxId',
    'senderAccount',
    'dateText',
    'dateIso',
    'operationId',
    'bank',
  ],
};

const SYSTEM_PROMPT = `Sos un extractor de datos de comprobantes de transferencia bancaria de Argentina
(bancos y billeteras: Mercado Pago, Ualá, Naranja X, Brubank, MODO, etc.).
Te paso la imagen o PDF de UN comprobante. Devolvé SOLO datos que puedas leer con certeza.
Si un dato no está visible o no lo podés leer con seguridad, devolvé null.
NUNCA inventes ni completes datos por contexto.

- amount: importe transferido como número, sin símbolo ni separador de miles (ej: 16000).
- currency: 'ARS', 'USD', etc.
- recipientName / recipientAlias / recipientCbu: datos de QUIEN RECIBE el dinero (a quién se le
  transfirió). senderName / senderTaxId / senderAccount: datos de QUIEN ENVÍA (de la cuenta desde
  la que salió la plata). senderTaxId es el CUIT/CUIL del emisor.

  OJO, ESTO ES LO QUE MÁS SE CONFUNDE — prestá especial atención a no invertir estos dos roles:
  · En Mercado Pago suele decir arriba de todo "Le enviaste $X a [Nombre]" o "Transferiste a
    [Nombre]": ESE nombre es el RECIPIENT, nunca el sender, aunque después en la parte de abajo
    del comprobante aparezcan más datos (CVU/CBU, cuenta) que a veces están agrupados de forma
    confusa cerca de otro nombre.
  · En bancos suele haber dos bloques separados, uno "Origen" o "Cuenta débito" (=sender) y otro
    "Destino" o "Cuenta crédito" (=recipient) — fijate bien cuál etiqueta acompaña a cada nombre,
    no asumas por la posición en la imagen.
  · Regla práctica: la cuenta emisora es SIEMPRE la de la persona que hizo/mandó la transferencia
    (normalmente coincide con el nombre de quien compró el comprobante o su titular de cuenta);
    la receptora es la del comercio al que le llegó la plata. Si texto y CUIT/nombre de una
    persona aparecen junto a la palabra "recibiste"/"te transfirieron"/similar en vez de
    "enviaste"/"transferiste", esa persona es el RECEPTOR, no el emisor.
  · Antes de responder, releé una vez más cuál nombre está pegado a cada rol — es el error más
    común y más grave que podés cometer acá, porque invierte todo el resultado de la verificación.
- dateText: fecha y hora tal cual aparece. dateIso: esa fecha como YYYY-MM-DD si podés.
- operationId: número de operación / comprobante / referencia / código.
- documentType: 'transfer_receipt' si es un comprobante de transferencia; 'other'; o 'unreadable'.
- looksAuthentic: false si hay signos de edición/montaje (texto desalineado, fuentes mezcladas,
  artefactos de compresión sospechosos, montos pegados); true si parece genuino.
- confidence: 0 a 1, qué tan seguro estás de haber leído bien los datos clave (monto, partes, fecha).`;

function buildImagePart(fileBuffer, mimeType, filename) {
  const b64 = fileBuffer.toString('base64');
  if (mimeType === 'application/pdf') {
    return {
      type: 'file',
      file: { filename: filename || 'comprobante.pdf', file_data: `data:application/pdf;base64,${b64}` },
    };
  }
  return {
    type: 'image_url',
    image_url: { url: `data:${mimeType};base64,${b64}`, detail: 'high' },
  };
}

async function extractFromReceipt({ fileBuffer, mimeType, filename }) {
  const client = getOpenAI();
  const completion = await client.chat.completions.create({
    model: env.openai.model,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extraé los datos de este comprobante.' },
          buildImagePart(fileBuffer, mimeType, filename),
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'receipt_extraction', strict: true, schema: EXTRACTION_SCHEMA },
    },
  });

  const raw = completion.choices?.[0]?.message?.content;
  return JSON.parse(raw);
}

/**
 * Verifica el comprobante de una orden.
 * Devuelve un objeto `verification` para guardar en la orden. Nunca tira:
 * ante cualquier problema devuelve verdict 'review'.
 */
export async function verify({ order, user, fileBuffer, mimeType, filename }) {
  const base = {
    runAt: new Date().toISOString(),
    model: env.openai.model,
  };

  if (!isEnabled()) {
    return { ...base, verdict: 'review', reason: 'disabled', extracted: null, checks: null, issues: [] };
  }

  let extracted;
  try {
    extracted = await extractFromReceipt({ fileBuffer, mimeType, filename });
  } catch (err) {
    console.error('[receiptVerification] extraction failed:', err?.message || err);
    return {
      ...base,
      verdict: 'review',
      reason: 'extraction_error',
      error: String(err?.message || err).slice(0, 300),
      extracted: null,
      checks: null,
      issues: [],
    };
  }

  if (extracted.documentType === 'unreadable') {
    return { ...base, verdict: 'review', reason: 'unreadable', extracted, checks: null, issues: [] };
  }

  const { checks, issues, verdict } = evaluateReceipt({
    extracted,
    order,
    user,
    payment: env.payment,
    config: env.receiptCheck,
  });

  return {
    ...base,
    verdict: env.receiptCheck.autoApprove ? verdict : verdict === 'pass' ? 'review' : verdict,
    autoApproveEnabled: env.receiptCheck.autoApprove,
    aiConfidence: extracted.confidence ?? null,
    extracted,
    checks,
    issues,
  };
}
