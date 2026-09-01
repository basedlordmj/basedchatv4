module.exports = {
  apps: [
    {
      name: 'basedchat-backend',
      script: 'src/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '400M',
    },
  ],
};
