module.exports = {
  apps: [
    {
      name: 'auth-service',
      script: './server/auth-service/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        // UPDATE THIS LINE: postgres://USER:PASSWORD@localhost:5432/DB_NAME
        DATABASE_URL: 'postgres://telegram:secure_pass@localhost:5432/telegram_db'
      }
    },
    {
      name: 'chat-service',
      script: './server/chat-service/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        // UPDATE THIS LINE: postgres://USER:PASSWORD@localhost:5432/DB_NAME
        DATABASE_URL: 'postgres://telegram:secure_pass@localhost:5432/telegram_db'
      }
    }
  ]
};