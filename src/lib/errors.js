/** Error de negocio con codigo HTTP. El errorHandler lo traduce a JSON. */
export class ApiError extends Error {
  constructor(status, message, code = 'error', details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, message, 'bad_request', details);
export const unauthorized = (message = 'No autorizado') => new ApiError(401, message, 'unauthorized');
export const forbidden = (message = 'Acceso denegado') => new ApiError(403, message, 'forbidden');
export const notFound = (message = 'No encontrado') => new ApiError(404, message, 'not_found');
export const conflict = (message, details) => new ApiError(409, message, 'conflict', details);
