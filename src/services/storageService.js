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
