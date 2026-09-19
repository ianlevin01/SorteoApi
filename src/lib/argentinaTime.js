/**
 * Utilidades de fecha/hora para Argentina (UTC-3 fijo todo el año — nunca
 * tiene horario de verano, así que un offset constante alcanza y sobra).
 *
 * Por qué existe este archivo: un bug real (2026-09-19) rechazaba pagos
 * válidos porque el código comparaba "día calendario" usando el huso
 * horario AMBIENTE del proceso de Node (que en el servidor real corre en
 * UTC) en vez de la hora de Argentina. La lección: para cualquier
 * comparación de fecha/hora que tenga que ver con "cuándo es de noche/de
 * día para el negocio" (revisión de comprobantes, cierre de ventas, etc.)
 * hay que usar SIEMPRE estas funciones — nunca `new Date(y,m,d)`,
 * `.setHours(...)`, `.getHours()`, ni parsear un string "sin huso horario"
 * con `new Date(string)` directamente, porque esos métodos dependen del
 * huso horario del entorno donde corre el código (navegador o servidor) y
 * ESE nunca es una garantía de que sea el de Argentina.
 */

export const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * "Día calendario" en Argentina de un instante cualquiera, como valor
 * comparable (epoch de la medianoche UTC de ese Y-M-D). No es un instante
 * real — es solo una etiqueta de día, pero compararla contra otra hecha
 * con esta misma función sirve para saber "mismo día en Argentina o no"
 * sin que importe en qué huso horario corre el proceso.
 */
export function arCalendarDay(d) {
  const shifted = new Date(d.getTime() - AR_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/**
 * Convierte un string tipo <input type="datetime-local"> ("YYYY-MM-DDTHH:mm",
 * sin huso horario) a un instante UTC real, INTERPRETANDO esa hora como
 * hora de Argentina — sin importar en qué huso horario esté el navegador
 * del admin que lo cargó ni el servidor que lo procesa. Devuelve null si
 * el string no tiene ese formato (o es vacío/null).
 */
export function argentinaWallClockToUtc(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, 0, 0) + AR_OFFSET_MS);
}

/** Componentes de la hora de Argentina (para mostrar mensajes) de un instante UTC real. */
export function argentinaWallClockParts(d) {
  const shifted = new Date(d.getTime() - AR_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

/** "HH:mm del DD/MM" en hora de Argentina, para mensajes al usuario. */
export function formatArgentinaDateTime(d) {
  const { day, month, hours, minutes } = argentinaWallClockParts(new Date(d));
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${pad2(hours)}:${pad2(minutes)}hs del ${pad2(day)}/${pad2(month)}`;
}
