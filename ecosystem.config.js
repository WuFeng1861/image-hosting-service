// 日志目录由部署脚本通过 PM_LOG_DIR 注入；改了 --home / --run-user 也不会写错地方
const path = require('path');
const LOG_DIR = process.env.PM_LOG_DIR || '/home/nodeapp/logs';

module.exports = {
  apps: [
    {
      name: 'image-hosting-server',
      cwd: __dirname,
      script: 'dist/main.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 3000,
      // 上传是流式落盘，占用不高；给到 512M 留余量
      max_memory_restart: '512M',
      kill_timeout: 5000,
      listen_timeout: 15000,

      node_args: '--max-old-space-size=448',

      env: {
        NODE_ENV: 'production',
      },

      out_file: path.join(LOG_DIR, 'image-hosting-server-out.log'),
      error_file: path.join(LOG_DIR, 'image-hosting-server-error.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
