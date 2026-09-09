import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3';
import { s3 } from '../src/config/aws.js';
import { env } from '../src/config/env.js';
import { isMain } from './_runAsMain.js';

async function bucketExists(name) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: name }));
    return true;
  } catch (err) {
    const status = err.$metadata?.httpStatusCode;
    if (status === 404 || err.name === 'NotFound') return false;
    if (status === 403) {
      console.warn('  El bucket existe pero pertenece a otra cuenta o no hay acceso.');
      return true;
    }
    throw err;
  }
}

export async function createBucket() {
  const Bucket = env.s3.bucket;
  if (!Bucket) throw new Error('Configurá S3_BUCKET en backend/.env');

  console.log(`S3 · bucket ${Bucket}`);

  if (await bucketExists(Bucket)) {
    console.log('  = bucket ya existe');
  } else {
    await s3.send(
      new CreateBucketCommand({
        Bucket,
        ...(env.aws.region !== 'us-east-1'
          ? { CreateBucketConfiguration: { LocationConstraint: env.aws.region } }
          : {}),
      }),
    );
    console.log('  + bucket creado');
  }

  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    }),
  );
  console.log('  acceso público bloqueado (los comprobantes se ven con URL firmada)');

  await s3.send(
    new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedMethods: ['GET', 'PUT'],
            AllowedOrigins: env.corsOrigin,
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    }),
  );
  console.log('  CORS configurado');
  console.log('S3 listo.');
}

if (isMain(import.meta.url)) {
  createBucket().catch((err) => {
    console.error('Error configurando el bucket:', err);
    process.exit(1);
  });
}
