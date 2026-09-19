import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nameMatches,
  dniFromTaxId,
  accountKey,
  parseReceiptDate,
  evaluateReceipt,
} from './receiptChecks.js';

test('nameMatches - variantes', () => {
  assert.equal(nameMatches('LUCIA GOMEZ', 'Lucía Gómez'), true);
  assert.equal(nameMatches('Gómez, Lucía María', 'Lucia Gomez'), true);
  assert.equal(nameMatches('Juan Perez', 'Lucia Gomez'), false);
  assert.equal(nameMatches('', 'Lucia Gomez'), false);
});

test('dniFromTaxId', () => {
  assert.equal(dniFromTaxId('27-30111222-4'), '30111222');
  assert.equal(dniFromTaxId('20301112223'), '30111222');
  assert.equal(dniFromTaxId('30.111.222'), '30111222');
  assert.equal(dniFromTaxId('abc'), null);
});

test('accountKey normaliza', () => {
  assert.equal(accountKey('preciosbajos.sorteos'), accountKey('PRECIOSBAJOS.SORTEOS'));
  assert.equal(accountKey('000 007 65-000'), '00000765000');
});

test('parseReceiptDate', () => {
  assert.ok(parseReceiptDate('2026-09-08') instanceof Date);
  assert.ok(parseReceiptDate('08/09/2026') instanceof Date);
  assert.equal(parseReceiptDate(null), null);
});

const baseOrder = {
  amount: 16000,
  createdAt: '2026-09-08T10:00:00.000Z',
};
const baseUser = { firstName: 'Lucía', lastName: 'Gómez', dni: '30111222' };
const basePayment = {
  alias: 'preciosbajos.sorteos',
  cbu: '0000076500000012345678',
  holder: 'Importadora Precios Bajos S.R.L.',
};
const config = { minConfidence: 0.7, maxAgeDays: 10 };

const goodExtract = {
  documentType: 'transfer_receipt',
  looksAuthentic: true,
  confidence: 0.95,
  amount: 16000,
  currency: 'ARS',
  recipientName: 'Importadora Precios Bajos SRL',
  recipientAlias: 'preciosbajos.sorteos',
  recipientCbu: null,
  senderName: 'GOMEZ LUCIA',
  senderTaxId: '27-30111222-4',
  dateIso: '2026-09-09',
  dateText: '09/09/2026 14:30',
  operationId: 'OP123',
};

test('evaluateReceipt - todo ok -> pass', () => {
  const r = evaluateReceipt({
    extracted: goodExtract,
    order: baseOrder,
    user: baseUser,
    payment: basePayment,
    config,
    now: new Date('2026-09-09T15:00:00Z'),
  });
  assert.equal(r.verdict, 'pass', JSON.stringify(r.issues));
});

test('evaluateReceipt - monto distinto -> reject', () => {
  const r = evaluateReceipt({
    extracted: { ...goodExtract, amount: 15000 },
    order: baseOrder,
    user: baseUser,
    payment: basePayment,
    config,
    now: new Date('2026-09-09T15:00:00Z'),
  });
  assert.equal(r.verdict, 'reject');
  assert.match(r.issues.join(' '), /monto/i);
});

test('evaluateReceipt - DNI del emisor distinto -> reject', () => {
  const r = evaluateReceipt({
    extracted: { ...goodExtract, senderName: 'PEREZ JUAN', senderTaxId: '20-40000000-5' },
    order: baseOrder,
    user: baseUser,
    payment: basePayment,
    config,
    now: new Date('2026-09-09T15:00:00Z'),
  });
  assert.equal(r.verdict, 'reject');
  assert.match(r.issues.join(' '), /DNI|CUIL|cuenta/i);
});

test('evaluateReceipt - no se pudo leer el monto -> review', () => {
  const r = evaluateReceipt({
    extracted: { ...goodExtract, amount: null },
    order: baseOrder,
    user: baseUser,
    payment: basePayment,
    config,
    now: new Date('2026-09-09T15:00:00Z'),
  });
  assert.equal(r.verdict, 'review');
});

test('evaluateReceipt - fecha anterior a la reserva -> reject', () => {
  const r = evaluateReceipt({
    extracted: { ...goodExtract, dateIso: '2026-09-01', dateText: '01/09/2026' },
    order: baseOrder,
    user: baseUser,
    payment: basePayment,
    config,
    now: new Date('2026-09-09T15:00:00Z'),
  });
  assert.equal(r.verdict, 'reject');
});

test('evaluateReceipt - pedido de noche (21hs+ ART) no rechaza un comprobante del mismo día', () => {
  // Bug real (2026-09-18): pedido a las 21:52 hora Argentina -> en UTC ya es
  // 00:52 del día siguiente. El comprobante, fechado correctamente el mismo
  // día en hora local (como lo imprime el banco), quedaba marcado como
  // "anterior a la compra" si el chequeo comparaba por día calendario en el
  // huso horario del server (UTC en el EC2 real) en vez de en Argentina.
  const nightOrder = { ...baseOrder, createdAt: '2026-09-19T00:52:00.000Z' }; // 21:52 ART del 18/09
  const r = evaluateReceipt({
    extracted: { ...goodExtract, dateIso: '2026-09-18', dateText: '18/septiembre/2026 a las 21:53' },
    order: nightOrder,
    user: baseUser,
    payment: basePayment,
    config,
    now: new Date('2026-09-19T01:00:00.000Z'),
  });
  assert.equal(r.checks.date.pass, true, JSON.stringify(r.checks.date));
  assert.equal(r.verdict, 'pass', JSON.stringify(r.issues));
});

test('evaluateReceipt - emisor/receptor invertidos -> review, no reject (caso real)', () => {
  // Caso real reportado (2026-09-19, pedido de Rocío Gómez): el modelo leyó
  // el nombre del comprador como "receptor" y el nombre del titular de
  // nuestra cuenta como "emisor" — exactamente al revés. Antes esto
  // rechazaba en automático un pago válido; ahora tiene que caer a
  // revisión manual, nunca a 'reject' (y tampoco a 'pass' directo, porque
  // seguimos sin poder confirmar los datos con certeza).
  const r = evaluateReceipt({
    extracted: {
      ...goodExtract,
      senderName: 'Roberto Oscar Cornetta', // en realidad es el titular de NUESTRA cuenta
      senderTaxId: '20-27133484-3',
      recipientName: 'Rocio Marina Gomez Gimenez', // en realidad es la compradora
      recipientAlias: null,
      recipientCbu: '0000003100011057647506',
    },
    order: baseOrder,
    user: { firstName: 'Rocio', lastName: 'Gomez', dni: '36023839' },
    payment: { ...basePayment, holder: 'Roberto Oscar Cornetta' },
    config,
    now: new Date('2026-09-09T15:00:00Z'),
  });
  assert.equal(r.verdict, 'review', JSON.stringify(r.issues));
  assert.equal(r.checks.recipient.hard, false);
  assert.equal(r.checks.sender.hard, false);
});

test('evaluateReceipt - emisor realmente ajeno (no invertido) sigue rechazando', () => {
  // Control: un emisor que NO coincide ni con el comprador ni con nuestra
  // propia cuenta (un tercero cualquiera) tiene que seguir siendo un
  // rechazo duro — la detección de inversión no debe tapar un fraude real.
  const r = evaluateReceipt({
    extracted: { ...goodExtract, senderName: 'PEREZ JUAN', senderTaxId: '20-40000000-5' },
    order: baseOrder,
    user: baseUser,
    payment: basePayment,
    config,
    now: new Date('2026-09-09T15:00:00Z'),
  });
  assert.equal(r.verdict, 'reject');
  assert.equal(r.checks.sender.hard, true);
});

test('evaluateReceipt - destinatario ajeno -> reject', () => {
  const r = evaluateReceipt({
    extracted: { ...goodExtract, recipientAlias: 'otra.cuenta.mp', recipientName: 'Otro Titular' },
    order: baseOrder,
    user: baseUser,
    payment: basePayment,
    config,
    now: new Date('2026-09-09T15:00:00Z'),
  });
  assert.equal(r.verdict, 'reject');
});
