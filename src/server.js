import { createApp } from './app.js';
import { env, assertConfigured, isProd } from './config/env.js';

try {
  assertConfigured();
} catch (err) {
  console.error(`\n[config] ${err.message}\n`);
  if (isProd) process.exit(1);
}

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`API escuchando en http://localhost:${env.port}  (${env.nodeEnv})`);
  console.log(`AWS region: ${env.aws.region} | prefijo de tablas: ${env.dynamo.tablePrefix}`);
  if (!env.s3.bucket) console.warn('Aviso: S3_BUCKET sin configurar (subida de comprobantes deshabilitada)');
  if (!env.payment.alias) console.warn('Aviso: PAYMENT_ALIAS sin configurar');
  if (!env.openai.apiKey) console.warn('Aviso: OPENAI_API_KEY sin configurar (comprobantes van a revisión manual)');
});

// Apagado ordenado (PM2 reload / SIGTERM): dejamos terminar los requests en curso.
function shutdown(signal) {
  console.log(`\n${signal} recibido, cerrando...`);
  server.close(() => {
    console.log('Servidor cerrado.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
