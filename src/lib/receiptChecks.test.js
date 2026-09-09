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
