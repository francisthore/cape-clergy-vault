// REVIEW TEMPLATE ONLY. Proposed paths/UIDs; do not run on the existing VPS.
// Launch under a dedicated application account after separate provisioning approval.
// Secret environments are injected by protected per-process launchers, never PM2's
// shared daemon environment/dump. Do not use one PM2 daemon for all credentials.
module.exports = {
  apps: [
    {
      name: "cape-vault-web",
      cwd: "/srv/cape-vault/current",
      script: ".output/server/index.mjs",
      interpreter: "/usr/bin/node",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production", HOST: "127.0.0.1", PORT: "3300", TZ: "UTC" },
      autorestart: true,
      exp_backoff_restart_delay: 1000,
      min_uptime: "15s",
      max_restarts: 10,
      kill_timeout: 200000,
      max_memory_restart: "768M",
      time: true,
      out_file: "/var/log/cape-vault/web.log",
      error_file: "/var/log/cape-vault/web-error.log",
    },
  ],
};
// Workers: one protected supervisor per credential, running:
// node scripts/worker-loop.mjs scanner|approval|reviewer
// No cron or systemd timer in addition to these loops. ClamAV/FreshClam/Postgres/
// Nginx remain separately managed dependencies; never managed by this template.
