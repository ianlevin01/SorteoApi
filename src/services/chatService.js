import { getOpenAI } from '../config/openai.js';
import { env } from '../config/env.js';
import { badRequest } from '../lib/errors.js';
import { listOrdersByBuyer } from '../repositories/orderRepository.js';
import { listTicketsByOwner } from '../repositories/ticketRepository.js';

// El asistente puede decir abiertamente que es un asistente/bot — eso es
// normal y esperado. Lo que NUNCA debe salir de acá (ni acá ni en ningún
// otro lado del sitio) es que el comprobante de transferencia se revisa con
// inteligencia artificial: eso tiene que sonar a "nuestro sistema revisa los
// datos", como si fuera una validación automática cualquiera.
const SYSTEM_PROMPT = `Sos el asistente virtual de Importadora Precios Bajos, un sitio de sorteos
online (Gualeguaychú, Argentina). Respondé siempre en español rioplatense, con
"vos", de forma breve, clara y amable. Podés decir que sos un asistente/bot
sin problema.

CÓMO FUNCIONA EL SITIO (así respondés con seguridad):
- Registro e ingreso: solo con DNI, sin contraseña. Hay que ser mayor de 18
  años y vivir en Argentina.
- Cada sorteo tiene un modo:
  · "Números correlativos": al comprar, el sistema te asigna automáticamente
    un bloque de números consecutivos. No los elegís vos.
  · "Elegí tu número": ves una grilla y elegís vos mismo el número puntual
    que querés (o usás "Elegir al azar"). Al tocar un número queda reservado
    10 minutos para que puedas pagarlo antes de que se libere para otro
    comprador. Podés elegir varios números antes de continuar.
- Pago: únicamente por transferencia bancaria. Al crear el pedido se muestra
  el alias/CBU para transferir. Después hay que subir una foto o PDF del
  comprobante desde la pantalla del pedido.
- Revisión del comprobante: nuestro sistema revisa que el monto, el
  destinatario, el nombre/DNI de quien transfiere y la fecha coincidan con lo
  esperado. Si todo coincide, el pedido se aprueba enseguida y los números
  quedan confirmados. Si hay algo que no cierra (monto distinto, cuenta de
  otra persona, etc.) se rechaza y se explica el motivo, pudiendo subir un
  comprobante corregido o pedir que una persona lo revise a mano. Si algo no
  se pudo determinar con certeza, queda en revisión manual. NUNCA digas que
  esto se hace con inteligencia artificial, IA, ChatGPT, un algoritmo o
  similar — nunca. Si preguntan cómo se revisa, hablá de "nuestro sistema" o
  "una verificación automática", sin más detalle técnico.
- Si no llegás a pagar y subir el comprobante a tiempo (dentro de los 10
  minutos, para "elegí tu número"), el número se libera solo y hay que
  elegir de nuevo.
- "Mis números": ahí ve cada usuario sus números por sorteo, con su código
  de verificación único y QR. El estado de cada número (pendiente, en
  revisión, confirmado, rechazado) depende del estado del pedido.
- El sorteo en sí se hace según lo indicado en cada sorteo (ej. Lotería
  Nacional); el resultado se publica en el sitio.

QUÉ HACER SI NO PODÉS RESOLVER ALGO VOS:
Si la persona tiene un problema puntual con SU cuenta o SU pedido que no
podés resolver con la información que tenés (un pago que no se refleja, un
reclamo, algo que necesita que alguien del equipo lo mire), NO inventes una
solución ni la dejes sin respuesta: avisale con naturalidad que la vas a
derivar con un asesor humano que la va a contactar. Antes de derivar, hacé
como máximo 1 o 2 preguntas cortas para entender bien qué le pasa (qué
sorteo, qué pedido, qué esperaba que pasara) — no derives al toque sin
entender la situación, pero tampoco alargues de más la conversación.
Cuando ya tengas el panorama, marcá shouldEscalate en true y escribí un
resumen claro y concreto para el asesor (2-4 oraciones, en tercera persona,
con los datos concretos que dio la persona).

Respondé SIEMPRE en el formato JSON pedido.`;

const CHAT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string' },
    shouldEscalate: { type: 'boolean' },
    summaryForAdvisor: { type: ['string', 'null'] },
  },
  required: ['reply', 'shouldEscalate', 'summaryForAdvisor'],
};

const MAX_HISTORY = 20;
const MAX_IMAGE_DATA_URL_LENGTH = 8 * 1024 * 1024; // ~6MB de imagen en base64

async function userContextBlock(user) {
  if (!user) return 'El visitante todavía no inició sesión (no sabés quién es).';
  const [orders, tickets] = await Promise.all([
    listOrdersByBuyer(user.dni).catch(() => []),
    listTicketsByOwner(user.dni).catch(() => []),
  ]);
  const confirmedByRaffle = new Map();
  for (const t of tickets) {
    if (!t.confirmed) continue;
    confirmedByRaffle.set(t.raffleId, (confirmedByRaffle.get(t.raffleId) || 0) + 1);
  }
  const ordersSummary = orders
    .filter((o) => o.status !== 'failed')
    .slice(0, 15)
    .map((o) => {
      const nums = o.numbers?.list
        ? o.numbers.list.join(', ')
        : o.numbers
          ? `${o.numbers.start}-${o.numbers.end}`
          : '—';
      return `· Sorteo "${o.raffleTitle}", pedido ${o.status}, ${o.chances} número(s) [${nums}], $${o.amount}${o.rejectionReason ? `, motivo: ${o.rejectionReason}` : ''}`;
    })
    .join('\n');

  return `Usuario autenticado: ${user.firstName} ${user.lastName}, DNI ${user.dni}.
Sus pedidos recientes:
${ordersSummary || '(todavía no tiene pedidos)'}`;
}

/**
 * Arma la respuesta del asistente para un turno de chat. `history` son los
 * turnos previos (nunca se guardan en el servidor: los manda el cliente
 * cada vez, desde su localStorage). `imageBuffer`/`imageMime` son de una
 * imagen recién adjuntada en este turno (opcional).
 */
export async function reply({ history = [], message, user, imageDataUrl }) {
  const client = getOpenAI();
  if (!client) {
    throw badRequest('El asistente no está disponible en este momento. Escribinos por WhatsApp.');
  }
  if (!message?.trim() && !imageDataUrl) {
    throw badRequest('Escribí un mensaje');
  }
  if (imageDataUrl && (!imageDataUrl.startsWith('data:image/') || imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH)) {
    throw badRequest('La imagen no es válida o es demasiado grande');
  }

  const context = await userContextBlock(user);
  const trimmedHistory = history.slice(-MAX_HISTORY);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: context },
    ...trimmedHistory.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];

  const userContent = [{ type: 'text', text: message || '(la persona adjuntó una imagen sin texto)' }];
  if (imageDataUrl) {
    userContent.push({ type: 'image_url', image_url: { url: imageDataUrl, detail: 'auto' } });
  }
  messages.push({ role: 'user', content: userContent });

  const completion = await client.chat.completions.create({
    model: env.openai.model,
    temperature: 0.4,
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'chat_reply', strict: true, schema: CHAT_SCHEMA },
    },
  });

  const raw = completion.choices?.[0]?.message?.content;
  const parsed = JSON.parse(raw);
  return {
    reply: parsed.reply,
    shouldEscalate: Boolean(parsed.shouldEscalate),
    summaryForAdvisor: parsed.summaryForAdvisor || null,
  };
}
