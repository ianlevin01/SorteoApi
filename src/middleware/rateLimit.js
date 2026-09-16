import rateLimit from 'express-rate-limit';

const message = {
  error: { code: 'rate_limited', message: 'Demasiados intentos. Probá de nuevo en unos minutos.' },
};

/** Limite para endpoints sensibles de auth (evita enumeracion de DNIs / spam). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});

/** Limite general suave para toda la API. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});

/** El chat con la IA cuesta plata real por mensaje: límite más estricto. */
export const chatLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});
