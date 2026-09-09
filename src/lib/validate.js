import { badRequest } from './errors.js';

/**
 * Middleware de validacion con Zod. Recibe { body, query, params } opcionales.
 * El resultado ya parseado/normalizado queda en req.valid.
 */
export function validate(schemas = {}) {
  return (req, _res, next) => {
    try {
      req.valid = {
        body: schemas.body ? schemas.body.parse(req.body ?? {}) : req.body,
        query: schemas.query ? schemas.query.parse(req.query ?? {}) : req.query,
        params: schemas.params ? schemas.params.parse(req.params ?? {}) : req.params,
      };
      next();
    } catch (err) {
      if (err?.issues) {
        return next(
          badRequest(
            'Datos invalidos',
            err.issues.map((i) => ({
              campo: i.path.join('.') || '(raiz)',
              mensaje: i.message,
            })),
          ),
        );
      }
      next(err);
    }
  };
}
