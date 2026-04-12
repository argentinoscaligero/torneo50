module.exports = {
  apps: [{
    name: 'torneo50',
    script: 'server.js',
    cwd: '/var/www/html/torneo50/backend',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    restart_delay: 3000,       // esperar 3s antes de reiniciar
    max_restarts: 20,
    min_uptime: '10s',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/pm2/torneo50-error.log',
    out_file:   '/var/log/pm2/torneo50-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
