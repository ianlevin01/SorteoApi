/**
 * Normaliza una fecha de nacimiento a 'YYYY-MM-DD'.
 * Acepta 'YYYY-MM-DD' o 'DD/MM/YYYY'. Devuelve null si es invalida o inexistente.
 */
export function normalizeBirthDate(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  let y;
  let m;
  let d;

  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    [, y, m, d] = match;
  } else if ((match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    [, d, m, y] = match;
  } else {
    return null;
  }

  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null; // ej. 31/02/2000
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Edad en anios cumplidos a partir de una fecha ISO 'YYYY-MM-DD'. */
export function ageInYears(birthISO, ref = new Date()) {
  const b = new Date(`${birthISO}T00:00:00Z`);
  let age = ref.getUTCFullYear() - b.getUTCFullYear();
  const monthDiff = ref.getUTCMonth() - b.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getUTCDate() < b.getUTCDate())) {
    age -= 1;
  }
  return age;
}
