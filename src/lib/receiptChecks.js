/**
 * Funciones puras para comparar los datos extraidos de un comprobante contra
 * lo que esperamos. NO llaman a ningun servicio externo.
 */

const stripAccents = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function nameTokens(value) {
  return stripAccents(value)
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Match laxo de nombres: comparten >=2 tokens, o todos los del mas corto. */
export function nameMatches(a, b) {
  const ta = new Set(nameTokens(a));
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.length === 0) return false;
  const common = tb.filter((t) => ta.has(t)).length;
  return common >= 2 || common === Math.min(ta.size, tb.length);
}

/** Normaliza alias / CBU / CVU para comparar (saca espacios, puntos, guiones). */
export const accountKey = (s) => String(s ?? '').toLowerCase().replace(/[\s.\-_]/g, '');

/** Del CUIT/CUIL saca el DNI (los 8 digitos del medio). Devuelve null si no aplica. */
export function dniFromTaxId(taxId) {
  const digits = String(taxId ?? '').replace(/\D/g, '');
  if (digits.length === 11) return String(Number(digits.slice(2, 10)));
  if (digits.length === 7 || digits.length === 8) return String(Number(digits));
  return null;
}

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export function parseReceiptDate(input) {
  if (!input) return null;
  const s = String(input).trim();

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  m = s.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m.map(Number);
    if (y < 100) y += 2000;
    return new Date(y, mo - 1, d);
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Corre los chequeos. Devuelve { checks, issues, verdict }.
 * - checks[x] = { pass: bool, hard?: bool, detail: string }
 *   `hard` = problema claro y verificable -> habilita rechazo automatico.
 * - verdict = 'pass' | 'reject' | 'review'
 */
export function evaluateReceipt({ extracted, order, user, payment, config, now = new Date() }) {
  const checks = {};
  const e = extracted || {};

  // --- 1. Es un comprobante genuino ---
  const notReceipt = e.documentType && e.documentType !== 'transfer_receipt';
  const edited = e.looksAuthentic === false;
  checks.document = {
    pass: !notReceipt && !edited,
    hard: Boolean(notReceipt || edited),
    detail: notReceipt
      ? 'El archivo no parece un comprobante de transferencia.'
      : edited
        ? 'El comprobante presenta signos de edición.'
        : 'Comprobante de transferencia válido.',
  };

  // --- 2. Monto exacto ---
  const got = typeof e.amount === 'number' ? Math.round(e.amount) : null;
  const want = Math.round(order.amount);
  checks.amount = {
    pass: got === want,
    hard: got != null && got !== want,
    detail:
      got == null
        ? 'No se pudo leer el monto transferido.'
        : got === want
          ? 'El monto coincide con el total.'
          : `El monto transferido ($${got.toLocaleString('es-AR')}) no coincide con el total ($${want.toLocaleString('es-AR')}).`,
  };

  // --- 3. Destinatario = nuestra cuenta ---
  const aliasOk = e.recipientAlias && payment.alias && accountKey(e.recipientAlias) === accountKey(payment.alias);
  const cbuOk = e.recipientCbu && payment.cbu && accountKey(e.recipientCbu) === accountKey(payment.cbu);
  const recipientNameOk = e.recipientName && payment.holder && nameMatches(e.recipientName, payment.holder);
  const readRecipient = Boolean(e.recipientAlias || e.recipientCbu || e.recipientName);
  checks.recipient = {
    pass: Boolean(aliasOk || cbuOk || recipientNameOk),
    hard: readRecipient && !aliasOk && !cbuOk && !recipientNameOk,
    detail:
      aliasOk || cbuOk
        ? 'La transferencia fue a nuestra cuenta.'
        : recipientNameOk
          ? 'El destinatario coincide con el titular de nuestra cuenta.'
          : readRecipient
            ? 'La transferencia no fue a la cuenta indicada.'
            : 'No se pudo confirmar el destinatario de la transferencia.',
  };

  // --- 4. Emisor = titular de la cuenta del usuario ---
  const buyerName = `${user.firstName} ${user.lastName}`;
  const senderNameOk = e.senderName && nameMatches(e.senderName, buyerName);
  const senderDni = dniFromTaxId(e.senderTaxId);
  const senderDniOk = senderDni && senderDni === String(Number(user.dni));
  const senderDniMismatch = Boolean(senderDni && !senderDniOk);
  const senderNameMismatch = Boolean(e.senderName && !senderNameOk && !senderDniOk);
  checks.sender = {
    pass: Boolean(senderNameOk || senderDniOk) && !senderDniMismatch,
    hard: senderDniMismatch || senderNameMismatch,
    detail: senderDniMismatch
      ? 'El DNI/CUIL de la cuenta que hizo la transferencia no coincide con el de tu cuenta.'
      : senderNameOk || senderDniOk
        ? 'La transferencia salió de una cuenta a tu nombre.'
        : e.senderName
          ? `La transferencia salió de una cuenta a nombre de "${e.senderName}", que no coincide con tu cuenta.`
          : 'No se pudo confirmar que la transferencia haya salido de tu cuenta.',
  };

  // --- 5. Fecha ---
  const date = parseReceiptDate(e.dateIso || e.dateText);
  const reservedAt = startOfDay(order.createdAt);
  const tooOld = config.maxAgeDays && date && now - date > config.maxAgeDays * 86400000;
  const beforeReserve = date && date < reservedAt;
  checks.date = {
    pass: Boolean(date) && !beforeReserve && !tooOld,
    hard: Boolean(beforeReserve),
    detail: !date
      ? 'No se pudo leer la fecha del comprobante.'
      : beforeReserve
        ? 'La fecha del comprobante es anterior a tu compra.'
        : tooOld
          ? 'El comprobante es de hace demasiado tiempo.'
          : 'La fecha del comprobante es correcta.',
  };

  const allPass = Object.values(checks).every((c) => c.pass);
  const anyHard = Object.values(checks).some((c) => c.hard);
  const confident = (e.confidence ?? 0) >= config.minConfidence;

  const issues = Object.values(checks)
    .filter((c) => !c.pass)
    .map((c) => c.detail);

  let verdict = 'review';
  if (allPass && confident) verdict = 'pass';
  else if (anyHard) verdict = 'reject';

  return { checks, issues, verdict };
}
