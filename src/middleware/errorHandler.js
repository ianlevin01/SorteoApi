import { ApiError } from '../lib/errors.js';
import { isProd } from '../config/env.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'Ruta no encontrada' } });
}

// eslint-disable-next-line no-unused-vars -- Express detecta el errorHandler por los 4 args
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  const name = err?.name || '';

  if (name === 'ConditionalCheckFailedException') {
    return res.status(409).json({
      error: { code: 'conflict', message: 'El recurso cambió o ya existía. Reintentá.' },
    });
  }
  if (name === 'ResourceNotFoundException') {
    return res.status(503).json({
      error: {
        code: 'db_not_ready',
        message: 'Faltan crear las tablas de DynamoDB. Corré: npm run setup:aws',
      },
    });
  }
  if (name === 'TransactionCanceledException') {
    return res.status(409).json({
      error: { code: 'number_conflict', message: 'Conflicto al asignar números. Reintentá la aprobación.' },
    });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: { code: 'file_too_large', message: 'El archivo supera el máximo de 8 MB' },
    });
  }

  console.error('[error]', err);
  return res.status(500).json({
    error: {
      code: 'internal',
      message: isProd ? 'Error interno del servidor' : String(err?.message || err),
    },
  });
}
