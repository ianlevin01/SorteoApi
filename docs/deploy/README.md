# Deploy de la API en EC2 (Ubuntu + PM2 + Nginx)

Guía para poner a correr `SorteoApi` en una instancia EC2. Todo esto se hace **en el
servidor**, por SSH.

Referencias:
- Nginx: [`nginx-api.conf`](./nginx-api.conf)
- Variables: [`../../.env.example`](../../.env.example)
- Actualizar el deploy más adelante: [`../../scripts/deploy.sh`](../../scripts/deploy.sh)

---

## 0. Requisitos en AWS

- Instancia EC2 **Ubuntu 22.04 o 24.04**, mínimo **t3.small** (2 GB RAM).
- Una **Elastic IP** asociada a la instancia (para que no cambie la IP al reiniciar).
- **Security Group** con inbound:
  | Puerto | Origen | Para |
  |---|---|---|
  | 22 | tu IP (`x.x.x.x/32`) | SSH |
  | 80 | `0.0.0.0/0` | HTTP (Let's Encrypt + redirección) |
  | 443 | `0.0.0.0/0` | HTTPS |
- Las tablas `sorteo_prod_*` y el bucket S3 de prod ya creados (lo hace el otro paso, desde la notebook).

---

## 1. Instalar Node 22, PM2 y Nginx

```bash
# Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2
sudo npm install -g pm2

# Nginx + certbot
sudo apt-get install -y nginx
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot

node -v   # v22.x
```

---

## 2. Traer el código (deploy key de solo lectura)

En el servidor:

```bash
ssh-keygen -t ed25519 -C "ec2-sorteo-api" -f ~/.ssh/sorteo_api_deploy -N ""
cat ~/.ssh/sorteo_api_deploy.pub
```

Copiá esa clave pública y agregala en GitHub:
**Repo SorteoApi → Settings → Deploy keys → Add deploy key** (sin permiso de escritura).

Configurá SSH para usar esa clave con GitHub:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-sorteo-api
  HostName github.com
  User git
  IdentityFile ~/.ssh/sorteo_api_deploy
  IdentitiesOnly yes
EOF

git clone git@github-sorteo-api:ianlevin01/SorteoApi.git ~/sorteo-api
cd ~/sorteo-api
npm ci --omit=dev
```

---

## 3. Configurar el `.env`

```bash
cp .env.example .env
nano .env
```

Completá (ver `.env.example` para la lista completa):

```ini
NODE_ENV=production
PORT=4001
CORS_ORIGIN=https://TU-DOMINIO-FRONT.com

JWT_SECRET=<pegar el que te paso, largo y aleatorio>
JWT_EXPIRES_IN=30d
ADMIN_DNIS=<tu DNI>

AWS_REGION=sa-east-1
AWS_ACCESS_KEY_ID=<...>
AWS_SECRET_ACCESS_KEY=<...>

DYNAMO_TABLE_PREFIX=sorteo_prod_

S3_BUCKET=<bucket de prod>
S3_RECEIPTS_PREFIX=receipts/

PAYMENT_ALIAS=<alias real>
PAYMENT_CBU=<cbu real>
PAYMENT_HOLDER=<titular>
PAYMENT_BANK=<banco>

OPENAI_API_KEY=<...>
OPENAI_MODEL=gpt-4o
```

`chmod 600 .env`

---

## 4. Arrancar con PM2

```bash
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 logs sorteo-api --lines 30      # verificá que arranque sin errores

pm2 save                             # guarda la lista de procesos
pm2 startup                          # imprime UN comando con sudo -> copialo y corrélo
pm2 save
```

Probá local:

```bash
curl -s http://localhost:4001/health
# {"ok":true,...}
```

---

## 5. Nginx + HTTPS

```bash
sudo cp ~/sorteo-api/docs/deploy/nginx-api.conf /etc/nginx/sites-available/sorteo-api
sudo nano /etc/nginx/sites-available/sorteo-api      # reemplazar api.TU-DOMINIO.com
sudo ln -s /etc/nginx/sites-available/sorteo-api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

> Antes de certbot, el A record del dominio de la API tiene que estar apuntando a la
> Elastic IP (paso de DNS).

```bash
sudo certbot --nginx -d api.TU-DOMINIO.com --redirect -m tu-email@ejemplo.com --agree-tos -n
```

Probá desde afuera:

```bash
curl -s https://api.TU-DOMINIO.com/health
```

---

## 6. Actualizar más adelante

```bash
cd ~/sorteo-api
./scripts/deploy.sh
```

(hace `git pull` + `npm ci` + `pm2 reload` sin downtime)

---

## Troubleshooting

| Síntoma | Revisar |
|---|---|
| `pm2 logs` muestra "Faltan variables de entorno" | Falta algo en `.env` (en prod se exige JWT_SECRET, S3_BUCKET, PAYMENT_ALIAS, CORS_ORIGIN real). |
| 502 Bad Gateway | La app no está corriendo (`pm2 status`) o el puerto no coincide con `nginx-api.conf`. |
| 413 Request Entity Too Large | Falta `client_max_body_size 12M;` en el server block de Nginx. |
| CORS error en el navegador | `CORS_ORIGIN` en `.env` tiene que ser exactamente el dominio del front (con `https://`). Reiniciar con `pm2 reload`. |
| `ResourceNotFoundException` | Faltan las tablas `sorteo_prod_*`. Se crean desde la notebook. |
