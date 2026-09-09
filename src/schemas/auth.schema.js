import { z } from 'zod';
import { PROVINCES } from '../lib/argentina.js';
import { normalizeBirthDate, ageInYears } from '../lib/dates.js';

const dni = z
  .string({ required_error: 'Ingresá tu DNI' })
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => /^\d{7,8}$/.test(v), 'DNI inválido (7 u 8 dígitos)');

export const checkDniSchema = {
  body: z.object({ dni }),
};

export const loginSchema = {
  body: z.object({ dni }),
};

export const registerSchema = {
  body: z.object({
    dni,
    firstName: z.string().trim().min(2, 'Ingresá tu nombre').max(60),
    lastName: z.string().trim().min(2, 'Ingresá tu apellido').max(60),
    birthDate: z
      .string({ required_error: 'Ingresá tu fecha de nacimiento' })
      .transform((v, ctx) => {
        const iso = normalizeBirthDate(v);
        if (!iso) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Fecha inválida. Usá DD/MM/AAAA' });
          return z.NEVER;
        }
        return iso;
      })
      .refine((iso) => ageInYears(iso) >= 18, 'Debés ser mayor de 18 años para participar')
      .refine((iso) => ageInYears(iso) <= 119, 'Revisá la fecha de nacimiento'),
    email: z.string().trim().toLowerCase().email('Email inválido').max(120),
    whatsapp: z
      .string({ required_error: 'Ingresá tu WhatsApp' })
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => /^\d{8,15}$/.test(v), 'WhatsApp inválido. Solo números, con código de país (ej: 5491112345678)'),
    address: z.string().trim().min(3, 'Ingresá tu dirección').max(120),
    city: z.string().trim().min(2, 'Ingresá tu localidad').max(80),
    province: z.string().refine((v) => PROVINCES.includes(v), 'Elegí una provincia'),
    postalCode: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .refine(
        (v) => /^\d{4}$/.test(v) || /^[A-Z]\d{4}[A-Z]{3}$/.test(v),
        'Código postal inválido (ej: 1414 o C1414ABC)',
      ),
  }),
};
