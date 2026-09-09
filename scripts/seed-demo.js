/*
 * Datos de demo para ver "Mis números" con contenido:
 * wipe + seed de sorteos + un usuario con 3 órdenes en distintos estados.
 * Imprime un token para usar en el navegador.
 */
import { wipeData } from './wipe-data.js';
import { adminCreateRaffle } from '../src/services/raffleService.js';
import { register, issueToken } from '../src/services/authService.js';
import { createPendingOrder, attachReceipt, approveOrder } from '../src/services/orderService.js';

const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(21, 0, 0, 0);
  return d.toISOString();
};
const img = (s) => `https://picsum.photos/seed/${s}/1200/900`;

await wipeData();

const cronos = await adminCreateRaffle({
  title: 'Sorteo Fiat Cronos 0KM',
  description: 'Un 0KM patentado a tu nombre. Sorteo por Lotería de la Ciudad.',
  prizeTitle: 'Fiat Cronos Drive 1.3 · 0KM',
  prizeDescription: 'Sedán 0KM, patentado y con seguro por 6 meses incluido.',
  images: [img('cronos1'), img('cronos2'), img('cronos3')],
  chanceTiers: [
    { id: 't1', chances: 1, price: 2000 },
    { id: 't5', chances: 5, price: 9000 },
    { id: 't10', chances: 10, price: 16000, popular: true },
    { id: 't20', chances: 20, price: 28000 },
    { id: 't50', chances: 50, price: 60000 },
  ],
  totalNumbers: 100000,
  status: 'active',
  featured: true,
  drawDate: daysFromNow(28),
});

const moto = await adminCreateRaffle({
  title: 'Sorteo Moto 0KM',
  description: 'Una moto 0KM lista para andar.',
  prizeTitle: 'Motomel 150cc · 0KM',
  prizeDescription: 'Patentada, con casco y seguro por 6 meses.',
  images: [img('moto1'), img('moto2')],
  chanceTiers: [
    { id: 't1', chances: 1, price: 1000 },
    { id: 't5', chances: 5, price: 4500, popular: true },
    { id: 't10', chances: 10, price: 8000 },
    { id: 't25', chances: 25, price: 18000 },
  ],
  totalNumbers: 50000,
  status: 'active',
  drawDate: daysFromNow(14),
});

await adminCreateRaffle({
  title: 'Sorteo $2.000.000 en efectivo',
  description: 'Dos millones de pesos, transferencia directa.',
  prizeTitle: '$2.000.000 en efectivo',
  prizeDescription: 'Se transfieren a la cuenta bancaria del ganador dentro de las 72 horas.',
  images: [img('cash1')],
  chanceTiers: [
    { id: 't1', chances: 1, price: 1500 },
    { id: 't10', chances: 10, price: 12000, popular: true },
    { id: 't30', chances: 30, price: 30000 },
  ],
  totalNumbers: 30000,
  status: 'active',
  drawDate: daysFromNow(7),
});

// Usuario demo
const { token, user } = await register({
  dni: '30111222',
  firstName: 'Lucía',
  lastName: 'Gómez',
  birthDate: '1992-05-12',
  email: 'lucia.demo@preciosbajos.test',
  whatsapp: '5491133334444',
  address: 'San Martín 550',
  city: 'Rosario',
  province: 'Santa Fe',
  postalCode: '2000',
});

const fakeFile = { buffer: Buffer.from('demo'), mimetype: 'image/png', originalname: 'comprobante.png', size: 4 };

// Orden 1: aprobada (10 números confirmados en Cronos)
const o1 = await createPendingOrder({ dni: user.dni, buyerName: 'Lucía Gómez', raffleId: cronos.raffleId, tierId: 't10' });
await attachReceipt({ dni: user.dni, orderId: o1.order.orderId, receipt: { key: 'demo', originalName: 'c.png', contentType: 'image/png', size: 4, uploadedAt: new Date().toISOString() } });
await approveOrder({ orderId: o1.order.orderId, adminDni: 'demo' });

// Orden 2: comprobante enviado, en revisión (5 números en Cronos)
const o2 = await createPendingOrder({ dni: user.dni, buyerName: 'Lucía Gómez', raffleId: cronos.raffleId, tierId: 't5' });
await attachReceipt({ dni: user.dni, orderId: o2.order.orderId, receipt: { key: 'demo', originalName: 'c.png', contentType: 'image/png', size: 4, uploadedAt: new Date().toISOString() } });

// Orden 3: pendiente de pago (5 números en Moto)
await createPendingOrder({ dni: user.dni, buyerName: 'Lucía Gómez', raffleId: moto.raffleId, tierId: 't5' });

// Orden 4: comprobante rechazado en la verificación (10 números en Moto)
const o4 = await createPendingOrder({ dni: user.dni, buyerName: 'Lucía Gómez', raffleId: moto.raffleId, tierId: 't10' });
const { updateOrder } = await import('../src/repositories/orderRepository.js');
await updateOrder(o4.order.orderId, {
  status: 'receipt_rejected',
  receipt: { key: 'demo', originalName: 'comprobante.jpg', contentType: 'image/jpeg', size: 4, uploadedAt: new Date().toISOString() },
  receiptSubmittedAt: new Date().toISOString(),
  rejectionReason: 'El monto transferido ($6.000) no coincide con el total ($8.000).',
  verification: {
    runAt: new Date().toISOString(),
    model: 'demo',
    verdict: 'reject',
    aiConfidence: 0.9,
    attempts: 1,
    issues: [
      'El monto transferido ($6.000) no coincide con el total ($8.000).',
      'La transferencia salió de una cuenta a nombre de "Carlos Gómez", que no coincide con tu cuenta.',
    ],
    checks: {
      document: { pass: true, detail: 'Comprobante de transferencia válido.' },
      amount: { pass: false, hard: true, detail: 'El monto transferido ($6.000) no coincide con el total ($8.000).' },
      recipient: { pass: true, detail: 'La transferencia fue a nuestra cuenta.' },
      sender: { pass: false, hard: true, detail: 'La transferencia salió de una cuenta a nombre de "Carlos Gómez", que no coincide con tu cuenta.' },
      date: { pass: true, detail: 'La fecha del comprobante es correcta.' },
    },
    extracted: { operationId: 'DEMO-4' },
  },
});

console.log('\n=== DEMO LISTA ===');
console.log('Usuario: Lucía Gómez  ·  DNI 30111222');
console.log(`\nlocalStorage.setItem('sorteo.token', ${JSON.stringify(token)})`);
console.log(`localStorage.setItem('sorteo.user', ${JSON.stringify(JSON.stringify(user))})`);
console.log('\nTOKEN:', token);
void fakeFile;
