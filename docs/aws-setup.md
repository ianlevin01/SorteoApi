# Configuración de AWS

El backend necesita acceso a **DynamoDB** y **S3** en la región `sa-east-1`.

## 1. Usuario IAM dedicado

Creá un usuario IAM sólo para este proyecto (no uses la cuenta root ni tu usuario
principal). Ejemplo: `sorteo-backend-dev`.

Adjuntale la política de [`aws-iam-policy.json`](./aws-iam-policy.json) reemplazando:

- `ACCOUNT_ID` → el ID de tu cuenta (12 dígitos)
- `NOMBRE_DEL_BUCKET` → el bucket que uses para los comprobantes

> Si preferís crear el bucket a mano desde la consola, podés quitar del policy las
> acciones `s3:CreateBucket`, `s3:PutBucketPublicAccessBlock`, `s3:PutBucketCORS`.

## 2. Darle las credenciales al backend

### Opción A — perfil de la AWS CLI (recomendada, las claves no pasan por el chat)

```bash
aws configure --profile sorteo
#   AWS Access Key ID     : <de la key del usuario IAM>
#   AWS Secret Access Key : <...>
#   Default region name   : sa-east-1
#   Default output format  : json
```

En `backend/.env`:

```
AWS_PROFILE=sorteo
# dejar AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY vacíos
```

### Opción B — claves explícitas

En `backend/.env`:

```
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

Conviene **rotar / borrar** esa access key cuando termine el setup inicial.

## 3. Crear tablas y bucket

```bash
# S3_BUCKET debe estar seteado en backend/.env
npm run setup:aws
```

Crea (idempotente) las tablas `sorteo_dev_users`, `sorteo_dev_raffles`,
`sorteo_dev_tickets`, `sorteo_dev_orders` y el bucket con acceso público bloqueado.
