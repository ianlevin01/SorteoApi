import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized, forbidden } from '../lib/errors.js';

function readToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

function decode(token) {
  const payload = jwt.verify(token, env.jwtSecret);
  return { dni: payload.sub, role: payload.role || 'user', name: payload.name };
}

/** No obliga a estar logueado, pero si hay token valido lo adjunta. */
export function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (token) {
    try {
      req.user = decode(token);
    } catch {
      /* token invalido: se ignora */
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  const token = readToken(req);
  if (!token) return next(unauthorized('Ingresá con tu DNI para continuar'));
  try {
    req.user = decode(token);
    next();
  } catch {
    next(unauthorized('Tu sesión expiró. Ingresá de nuevo.'));
  }
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (req.user.role !== 'admin') {
      return next(forbidden('Necesitás permisos de administrador'));
    }
    next();
  });
}
