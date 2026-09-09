import { ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../src/config/aws.js';
import { TABLES } from '../src/config/tables.js';
import { env } from '../src/config/env.js';
import { isMain } from './_runAsMain.js';

const KEYS = {
  [TABLES.users]: (i) => ({ dni: i.dni }),
  [TABLES.raffles]: (i) => ({ raffleId: i.raffleId }),
  [TABLES.tickets]: (i) => ({ raffleId: i.raffleId, number: i.number }),
  [TABLES.orders]: (i) => ({ orderId: i.orderId }),
};

async function wipeTable(table, keyFn) {
  let removed = 0;
  let ExclusiveStartKey;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey }));
    const items = page.Items || [];
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      // eslint-disable-next-line no-await-in-loop
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: { [table]: chunk.map((it) => ({ DeleteRequest: { Key: keyFn(it) } })) },
        }),
      );
      removed += chunk.length;
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  console.log(`  ${table}: ${removed} items borrados`);
}

export async function wipeData() {
  if (!env.dynamo.tablePrefix || env.dynamo.tablePrefix === '') {
    throw new Error('DYNAMO_TABLE_PREFIX vacío: abortando por seguridad');
  }
  if (env.nodeEnv === 'production') {
    throw new Error('wipe-data no se ejecuta en NODE_ENV=production');
  }
  console.log(`Vaciando tablas con prefijo "${env.dynamo.tablePrefix}" ...`);
  for (const [table, keyFn] of Object.entries(KEYS)) {
    // eslint-disable-next-line no-await-in-loop
    await wipeTable(table, keyFn);
  }
  console.log('Listo.');
}

if (isMain(import.meta.url)) {
  wipeData().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
