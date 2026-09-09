/**
 * Construye un UpdateExpression dinamico a partir de un objeto de cambios.
 * - value === undefined o null  -> REMOVE del atributo
 * - resto                       -> SET
 * Agrega updatedAt automaticamente salvo que se desactive.
 */
export function buildUpdateExpression(patch, { touchUpdatedAt = true } = {}) {
  const data = { ...patch };
  if (touchUpdatedAt) data.updatedAt = new Date().toISOString();

  const names = {};
  const values = {};
  const sets = [];
  const removes = [];

  for (const [key, value] of Object.entries(data)) {
    const nameKey = `#${key}`;
    names[nameKey] = key;
    if (value === undefined || value === null) {
      removes.push(nameKey);
    } else {
      const valueKey = `:${key}`;
      values[valueKey] = value;
      sets.push(`${nameKey} = ${valueKey}`);
    }
  }

  const clauses = [];
  if (sets.length) clauses.push(`SET ${sets.join(', ')}`);
  if (removes.length) clauses.push(`REMOVE ${removes.join(', ')}`);

  return {
    UpdateExpression: clauses.join(' '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
  };
}
