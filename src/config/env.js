import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Carga backend/.env sin importar desde donde se ejecute el proceso.
loadDotenv({ path: path.resolve(__dirname, '../../.env') });

const list = (value) =>
  (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  corsOrigin: list(process.env.CORS_ORIGIN).length
    ? list(process.env.CORS_ORIGIN)
    : ['http://localhost:5173'],

  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  adminDnis: list(process.env.ADMIN_DNIS),

  aws: {
    region: process.env.AWS_REGION || 'sa-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || undefined,
    sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
  },

  dynamo: {
    tablePrefix: process.env.DYNAMO_TABLE_PREFIX || 'sorteo_dev_',
    endpoint: process.env.DYNAMO_ENDPOINT || undefined,
  },

  s3: {
    bucket: process.env.S3_BUCKET || undefined,
    receiptsPrefix: process.env.S3_RECEIPTS_PREFIX || 'receipts/',
  },

  payment: {
    alias: process.env.PAYMENT_ALIAS || '',
    cbu: process.env.PAYMENT_CBU || '',
    holder: process.env.PAYMENT_HOLDER || '',
    bank: process.env.PAYMENT_BANK || '',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || undefined,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 45000),
  },

  // Verificacion automatica del comprobante de transferencia.
  receiptCheck: {
    enabled: (process.env.RECEIPT_CHECK_ENABLED ?? 'true') !== 'false',
    autoApprove: (process.env.RECEIPT_CHECK_AUTOAPPROVE ?? 'true') !== 'false',
    minConfidence: Number(process.env.RECEIPT_CHECK_MIN_CONFIDENCE || 0.7),
    maxAttempts: Number(process.env.RECEIPT_CHECK_MAX_ATTEMPTS || 3),
    maxAgeDays: Number(process.env.RECEIPT_CHECK_MAX_AGE_DAYS || 10),
  },
};

export const isProd = env.nodeEnv === 'production';

/**
 * Valida que esten las variables imprescindibles. Se usa en los scripts
 * y al arrancar el server. `needBucket` se exige solo cuando la operacion
 * toca S3.
 */
export function assertConfigured({ needBucket = false } = {}) {
  const missing = [];
  if (!env.aws.region) missing.push('AWS_REGION');

  const hasExplicitCreds = env.aws.accessKeyId && env.aws.secretAccessKey;
  if (!hasExplicitCreds && !env.dynamo.endpoint) {
    // Sin credenciales explicitas dependemos de la cadena por defecto de AWS
    // (aws configure, SSO, roles). Lo avisamos pero no rompemos.
    console.warn(
      '[env] No hay AWS_ACCESS_KEY_ID/SECRET en .env; se usara la cadena de credenciales por defecto de AWS.',
    );
  }

  if (needBucket && !env.s3.bucket) missing.push('S3_BUCKET');

  if (isProd) {
    if (env.jwtSecret === 'dev-insecure-secret') missing.push('JWT_SECRET');
    if (!env.s3.bucket) missing.push('S3_BUCKET');
    if (!env.payment.alias) missing.push('PAYMENT_ALIAS');
    if (!env.corsOrigin.length || env.corsOrigin.some((o) => o.includes('localhost'))) {
      missing.push('CORS_ORIGIN (dominio real del frontend)');
    }
  }

  if (missing.length) {
    throw new Error(
      `Faltan variables de entorno obligatorias: ${missing.join(', ')}. Revisá backend/.env`,
    );
  }
}
