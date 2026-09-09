# SorteoApi

API de la plataforma de sorteos. Node.js + Express + DynamoDB + S3.

El frontend está en un repo aparte: **SorteoFront** (deploy en Vercel).

## Requisitos

- Node.js >= 20 (probado con 22)
- Una cuenta de AWS con acceso a DynamoDB y S3 (`sa-east-1`)
- (Opcional) API key de OpenAI para la verificación automática de comprobantes

## Desarrollo

```bash
npm install
cp .env.example .env          # completar AWS_*, S3_BUCKET, JWT_SECRET, etc.

npm run setup:aws             # crea tablas de DynamoDB + bucket S3 (idempotente)
npm run seed                  # (opcional) sorteos de ejemplo
npm run dev                   # http://localhost:4001
```

Para producción, `DYNAMO_TABLE_PREFIX=sorteo_prod_` usa un set de tablas separado.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Server con `--watch` |
| `npm start` | Server (lo usa PM2 en prod) |
| `npm test` | Tests (`node --test`) |
| `npm run setup:aws` | Crea tablas + bucket |
| `npm run create-tables` / `create-bucket` | Por separado |
| `npm run seed` | Sorteos de ejemplo |
| `npm run seed-demo` | Usuario demo con participaciones en varios estados |
| `npm run wipe-data` / `reset` | Vacía / vacía + siembra |
| `npm run make-admin -- <dni>` | Marca un usuario como admin |

## Estructura

```
src/
  config/        env, clientes AWS/OpenAI, nombres de tabla
  lib/           helpers (errores, validación, provincias, checks de comprobante)
  middleware/    auth, rate limit, manejo de errores
  repositories/  acceso a DynamoDB por entidad
  services/      lógica de negocio (auth, sorteos, órdenes, tickets, verificación)
  routes/        endpoints HTTP
  app.js / server.js
scripts/         creación de infra, seeds, deploy
docs/            AWS, verificación de comprobantes, deploy
```

## Modelo de datos (DynamoDB)

| Tabla | PK | SK | GSI |
|---|---|---|---|
| `<prefix>users` | `dni` | — | `email-index` |
| `<prefix>raffles` | `raffleId` | — | `status-index` |
| `<prefix>tickets` | `raffleId` | `number` | `owner-index`, `code-index` |
| `<prefix>orders` | `orderId` | — | `buyer-index`, `status-index` |

- Los números son **correlativos desde 0**, por sorteo, asignados al crear la orden con
  un contador atómico. Nunca se repiten.
- El estado del ticket se deriva del estado de la orden.

## Deploy

Ver [`docs/deploy/README.md`](docs/deploy/README.md) — EC2 + PM2 + Nginx.

## Documentación

- [`docs/aws-setup.md`](docs/aws-setup.md) — configuración de AWS
- [`docs/verificacion-comprobantes.md`](docs/verificacion-comprobantes.md) — cómo se verifican los comprobantes
- [`docs/deploy/README.md`](docs/deploy/README.md) — puesta en producción
