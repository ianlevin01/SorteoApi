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
  chanceTiers: z.array(chanceTier).min(1, 'Cargá al menos una opción de chances'),
  totalNumbers: z.number().int().positive().max(10_000_000),
  status: z.enum(['draft', 'active', 'paused', 'finished']).optional(),
  featured: z.boolean().optional(),
  drawDate: z.string().datetime().optional(),
});

export const createRaffleSchema = {
  body: baseRaffle,
};

export const updateRaffleSchema = {
  body: baseRaffle.partial(),
};
