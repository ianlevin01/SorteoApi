import { adminCreateRaffle } from '../src/services/raffleService.js';

const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(21, 0, 0, 0);
  return d.toISOString();
};

// Imágenes placeholder (reemplazar por fotos reales de los premios).
const img = (seed) => `https://picsum.photos/seed/${seed}/1200/900`;

const raffles = [
  {
    title: 'Sorteo Fiat Cronos 0KM',
    description: 'Un 0KM patentado a tu nombre. Sorteo por Lotería de la Ciudad.',
    prizeTitle: 'Fiat Cronos Drive 1.3 · 0KM',
    prizeDescription:
      'Sedán 0KM, patentado y con seguro por 6 meses incluido. Entrega en concesionario ' +
      'oficial. Colores a elección según disponibilidad.',
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
  },
  {
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
  },
  {
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
  },
];

for (const input of raffles) {
  // eslint-disable-next-line no-await-in-loop
  const r = await adminCreateRaffle(input);
  console.log(`+ ${r.title}  ->  ${r.raffleId}  (${r.status}${r.featured ? ', destacado' : ''})`);
}

console.log('\nSorteos de ejemplo creados.');
