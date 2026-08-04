module.exports = {
  apps: [
    {
      name: 'netrelay-mqtt-server',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      kill_timeout: 10000,
      restart_delay: 2000,
      max_restarts: 10,
      min_uptime: '10s',
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
