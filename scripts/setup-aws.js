import { createTables } from './create-tables.js';
import { createBucket } from './create-bucket.js';
import { createMediaBucket } from './create-media-bucket.js';
import { env } from '../src/config/env.js';

async function main() {
  await createTables();

  if (env.s3.bucket) await createBucket();
  else console.warn('\nS3_BUCKET sin configurar: se omite el bucket de comprobantes.');

  if (env.media.bucket) await createMediaBucket();
  else console.warn('\nMEDIA_BUCKET sin configurar: se omite el bucket de imágenes.');

  console.log('\n✔ AWS listo.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
