import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketPolicyCommand,
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
    if (status === 403) return true;
    throw err;
  }
}

export async function createMediaBucket() {
  const Bucket = env.media.bucket;
  if (!Bucket) throw new Error('Configurá MEDIA_BUCKET en backend/.env');

  console.log(`S3 · bucket público de imágenes: ${Bucket}`);

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

  // Permitimos políticas públicas (pero NO ACLs públicas).
  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false,
      },
    }),
  );

  // Lectura pública SOLO del prefijo de imágenes.
  const prefix = env.media.prefix.replace(/^\/+|\/+$/g, '');
  await s3.send(
    new PutBucketPolicyCommand({
      Bucket,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'PublicReadImages',
            Effect: 'Allow',
            Principal: '*',
            Action: 's3:GetObject',
            Resource: `arn:aws:s3:::${Bucket}/${prefix}/*`,
          },
        ],
      }),
    }),
  );
  console.log(`  lectura pública habilitada para  ${prefix}/*`);

  await s3.send(
    new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedMethods: ['GET'],
            AllowedOrigins: ['*'],
            AllowedHeaders: ['*'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  console.log('  CORS configurado');
  console.log(
    `\nURL base de las imágenes:\n  https://${Bucket}.s3.${env.aws.region}.amazonaws.com/${prefix}/...\n`,
  );
}

if (isMain(import.meta.url)) {
  createMediaBucket().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
