import { createTables } from './create-tables.js';
import { createBucket } from './create-bucket.js';
import { env } from '../src/config/env.js';

async function main() {
  await createTables();
  if (env.s3.bucket) {
    await createBucket();
  } else {
    console.warn('\nS3_BUCKET sin configurar: se omite la creación del bucket.');
  }
  console.log('\n✔ AWS listo.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
