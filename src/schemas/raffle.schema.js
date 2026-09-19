import { z } from 'zod';

const chanceTier = z.object({
  id: z.string().min(1),
  chances: z.number().int().positive(),
  price: z.number().nonnegative(),
  label: z.string().max(60).optional(),
  popular: z.boolean().optional(),
});

const baseRaffle = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().max(4000).optional(),
  prizeTitle: z.string().max(160).optional(),
  prizeDescription: z.string().max(4000).optional(),
  images: z.array(z.string().url()).max(20).optional(),
  coverImage: z.string().url().optional(),
  // 'sequential' (default, numeros correlativos por tanda) | 'pick' (el
  // comprador elige el número puntual dentro de totalNumbers).
  mode: z.enum(['sequential', 'pick']).optional(),
  chanceTiers: z.array(chanceTier).optional(),
  pricePerNumber: z.number().positive().optional(), // solo 'pick'
  totalNumbers: z.number().int().positive().max(10_000_000),
  status: z.enum(['draft', 'active', 'paused', 'finished']).optional(),
  featured: z.boolean().optional(),
  // "YYYY-MM-DDTHH:mm" tal cual lo manda un <input type="datetime-local">:
  // se interpreta como hora de Argentina en el servicio, nunca la del
  // navegador ni la del servidor (ver lib/argentinaTime.js).
  drawDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Formato de fecha/hora inválido'), z.null()])
    .optional(),
  // Número ganador (una vez que se hizo el sorteo). null para borrarlo.
  winningNumber: z.number().int().nonnegative().nullable().optional(),
  // Horario de cierre de ventas, tal cual lo manda un <input
  // type="datetime-local"> ("YYYY-MM-DDTHH:mm"): se interpreta como hora de
  // Argentina en el servicio (ver lib/argentinaTime.js), nunca como la hora
  // del navegador ni la del servidor. null para sacar el cierre.
  closesAt: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Formato de fecha/hora inválido'), z.null()])
    .optional(),
});

function checkModeFields(v, ctx) {
  const mode = v.mode || 'sequential';
  if (mode === 'sequential' && !(v.chanceTiers && v.chanceTiers.length)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['chanceTiers'],
      message: 'Cargá al menos una opción de chances',
    });
  }
  if (mode === 'pick' && !v.pricePerNumber) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pricePerNumber'],
      message: 'Definí el precio por número',
    });
  }
}

export const createRaffleSchema = {
  body: baseRaffle.superRefine(checkModeFields),
};

export const updateRaffleSchema = {
  body: baseRaffle.partial(),
};
