/**
 * Envuelve un handler async para que los errores lleguen al errorHandler de
 * Express (Express 4 no captura promesas rechazadas por si solo).
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
