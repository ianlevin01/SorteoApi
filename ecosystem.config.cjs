// Configuración de PM2 para la API de Sorteo.
//   pm2 start ecosystem.config.cjs
//   pm2 reload ecosystem.config.cjs   (recarga sin downtime)
//   pm2 logs sorteo-api
//
// Las variables sensibles van en backend/.env (NO acá). El server las carga
// con dotenv al arrancar.
module.exports = {
  apps: [
    {
      name: 'sorteo-api',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '400M',
      kill_timeout: 8000, // deja terminar los requests en curso
      env: {
        NODE_ENV: 'production',
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
