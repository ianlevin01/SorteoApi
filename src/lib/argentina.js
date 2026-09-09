/** Las 24 jurisdicciones argentinas (23 provincias + CABA). */
export const PROVINCES = [
  'Buenos Aires',
  'Ciudad Autonoma de Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Cordoba',
  'Corrientes',
  'Entre Rios',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquen',
  'Rio Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucuman',
];

/** Deja solo digitos. '20.123.456' -> '20123456' */
export const normalizeDni = (input) => String(input ?? '').replace(/\D/g, '');

/** Deja solo digitos para el numero de WhatsApp. */
export const normalizeWhatsapp = (input) => String(input ?? '').replace(/\D/g, '');

export const isValidDni = (dni) => /^\d{7,8}$/.test(dni);
