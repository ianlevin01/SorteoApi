import { randomInt } from 'node:crypto';
import { ulid } from 'ulid';

export const newOrderId = () => `ord_${ulid()}`;
export const newRaffleId = () => `raf_${ulid()}`;

// Alfabeto sin caracteres ambiguos (sin 0/O/1/I/L/U) para codigos legibles.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/** Codigo de verificacion unico por ticket (va en el QR y en "Verificar ticket"). */
export function newVerificationCode(length = 10) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/** "Juan Carlos Perez" -> "J. Perez" (para mostrar en verificacion publica). */
export function maskName(fullName) {
  if (!fullName) return null;
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0][0].toUpperCase()}. ${parts.slice(1).join(' ')}`;
}

/** 'Sorteo Moto 0KM!' -> 'sorteo-moto-0km' */
export function slugify(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}
