import { z } from 'zod';

export const createOrderSchema = {
  body: z.object({
    raffleId: z.string().min(1, 'Falta el sorteo'),
    tierId: z.string().min(1, 'Elegí una cantidad de chances'),
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
