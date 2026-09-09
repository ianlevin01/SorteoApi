import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import {
  getUserByDni,
  getUserByEmail,
  createUser,
  updateUserRole,
} from '../repositories/userRepository.js';
import { conflict, notFound } from '../lib/errors.js';

function roleForDni(dni) {
  return env.adminDnis.includes(dni) ? 'admin' : 'user';
}

export function issueToken(user) {
  return jwt.sign(
    {
      sub: user.dni,
      role: user.role || 'user',
      name: `${user.firstName} ${user.lastName}`.trim(),
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
}

/** Campos del usuario que se pueden devolver al frontend. */
export function publicUser(user) {
  if (!user) return null;
  const {
    dni,
    firstName,
    lastName,
    email,
    whatsapp,
    address,
    city,
    province,
    postalCode,
    birthDate,
    role,
    createdAt,
  } = user;
  return {
    dni,
    firstName,
    lastName,
    email,
    whatsapp,
    address,
    city,
    province,
    postalCode,
    birthDate,
    role: role || 'user',
    createdAt,
  };
}

export async function checkDni(dni) {
  const user = await getUserByDni(dni);
  return { exists: Boolean(user), user: publicUser(user) };
}

export async function login(dni) {
  const user = await getUserByDni(dni);
  if (!user) {
    throw notFound('No encontramos ese DNI. Registrate para participar.');
  }

  // ADMIN_DNIS solo promueve (nunca degrada). Para hacer admin a mano:
  // `npm run make-admin -- <dni>`.
  const effective =
    env.adminDnis.includes(dni) && user.role !== 'admin'
      ? await updateUserRole(dni, 'admin')
      : user;

  return { token: issueToken(effective), user: publicUser(effective) };
}

export async function register(input) {
  const existing = await getUserByDni(input.dni);
  if (existing) {
    throw conflict('Ese DNI ya está registrado. Ingresá con tu DNI.');
  }

  const emailOwner = await getUserByEmail(input.email);
  if (emailOwner) {
    throw conflict('Ese email ya está en uso con otro DNI.');
  }

  const now = new Date().toISOString();
  const user = {
    ...input,
    role: roleForDni(input.dni),
    createdAt: now,
    updatedAt: now,
  };

  try {
    await createUser(user); // condicion attribute_not_exists(dni) -> evita carrera
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      throw conflict('Ese DNI ya está registrado. Ingresá con tu DNI.');
    }
    throw err;
  }

  return { token: issueToken(user), user: publicUser(user) };
}
