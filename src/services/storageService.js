import { randomUUID } from 'node:crypto';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3 } from '../config/aws.js';
import { env } from '../config/env.js';

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export const RECEIPT_MIME_TYPES = Object.keys(EXT_BY_MIME);
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Sube el comprobante de una orden a S3 (privado). Devuelve metadata para guardar en la orden. */
export async function uploadReceipt({ orderId, dni, file }) {
  if (!env.s3.bucket) {
    throw new Error('S3_BUCKET no está configurado en backend/.env');
  }
  const ext = EXT_BY_MIME[file.mimetype] || 'bin';
  const key = `${env.s3.receiptsPrefix}${orderId}/${Date.now()}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: { orderId, dni },
    }),
  );

  return {
    key,
    originalName: file.originalname,
    contentType: file.mimetype,
    size: file.size,
    uploadedAt: new Date().toISOString(),
  };
}

/** URL firmada temporal para que el admin vea el comprobante. */
export async function receiptViewUrl(key, expiresInSeconds = 300) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

/**
 * Sube al bucket PRIVADO una imagen adjuntada al momento de escalar una
 * consulta a un asesor (viene como data URI desde el navegador). Mientras el
 * chat es solo con la IA no se sube ni se guarda nada de esto -la imagen se
 * manda directo a la IA desde el navegador-; recién acá, si hace falta,
 * queda una copia para que el asesor la pueda ver.
 */
export async function uploadChatImageFromDataUrl({ dni, dataUrl }) {
  if (!env.s3.bucket) {
    throw new Error('S3_BUCKET no está configurado en backend/.env');
  }
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Imagen inválida');
  const [, mimetype, b64] = match;
  const buffer = Buffer.from(b64, 'base64');
  const ext = EXT_BY_MIME[mimetype] || 'bin';
  const key = `chat/${dni || 'anon'}/${Date.now()}-${randomUUID()}.${ext}`;
  await s3.send(
    new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: buffer, ContentType: mimetype }),
  );
  return { key, contentType: mimetype, size: buffer.length };
}

/** URL firmada para que el admin vea una imagen adjuntada en una consulta escalada. */
export async function chatImageViewUrl(key, expiresInSeconds = 300) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

function mediaPublicUrl(key) {
  const base =
    env.media.publicBaseUrl ||
    `https://${env.media.bucket}.s3.${env.aws.region}.amazonaws.com`;
  return `${base.replace(/\/+$/, '')}/${key}`;
}

/**
 * Sube una imagen al bucket PUBLICO (premios, ganadores).
 * Devuelve { url } listo para guardar en el sorteo.
 */
export async function uploadMedia({ file, folder = 'raffles' }) {
  if (!env.media.bucket) {
    throw new Error('MEDIA_BUCKET no está configurado en backend/.env');
  }
  const ext = EXT_BY_MIME[file.mimetype] || 'jpg';
  const safeFolder = String(folder).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'raffles';
  const key = `${env.media.prefix}${safeFolder}/${randomUUID()}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: env.media.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return { key, url: mediaPublicUrl(key), size: file.size, contentType: file.mimetype };
}
