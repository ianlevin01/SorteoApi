import { z } from 'zod';

export const createOrderSchema = {
  // Sorteo 'sequential' -> mandás `tierId`. Sorteo 'pick' -> mandás `numbers`
  // (los números que ya tenías reservados de a uno). El servicio valida que
  // coincida con el modo real del sorteo.
  body: z
    .object({
      raffleId: z.string().min(1, 'Falta el sorteo'),
      tierId: z.string().min(1).optional(),
      numbers: z.array(z.number().int().min(0)).min(1).max(200).optional(),
    })
    .refine((v) => Boolean(v.tierId) || Boolean(v.numbers?.length), {
      message: 'Elegí una cantidad de chances o los números que querés comprar',
      path: ['tierId'],
    }),
};

export const rejectOrderSchema = {
  body: z.object({
    reason: z.string().trim().max(300).optional(),
  }),
};

export const requestReviewSchema = {
  body: z.object({
    note: z.string().trim().max(500).optional(),
  }),
};
