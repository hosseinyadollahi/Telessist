#!/bin/bash

# Telegram Web Clone - Server Setup Script
# This script should be run on your VPS (Ubuntu/Debian)
# Usage: sudo ./setup.sh

set -e

echo ">>> Starting Telegram Web Clone Server Setup..."

# 1. Update System
echo "--- Updating System ---"
apt-get update && apt-get upgrade -y
apt-get install -y curl git build-essential nginx ufw

# 2. Install Node.js (LTS)
echo "--- Installing Node.js ---"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 3. Install PostgreSQL
echo "--- Installing PostgreSQL ---"
apt-get install -y postgresql postgresql-contrib

# 4. Configure PostgreSQL (Default: user=telegram, pass=secure_pass, db=telegram_db)
# WARNING: Change 'secure_pass' to a strong password in production!
echo "--- Configuring Database ---"
sudo -u postgres psql -c "CREATE USER telegram WITH PASSWORD 'secure_pass';" || true
sudo -u postgres psql -c "CREATE DATABASE telegram_db OWNER telegram;" || true
sudo -u postgres psql -c "ALTER USER telegram CREATEDB;" || true

# 5. Install PM2 globally
echo "--- Installing PM2 ---"
npm install -g pm2

# 6. Setup Project
# Assuming the repo is cloned to /var/www/telegram-app
APP_DIR="/var/www/telegram-app"

if [ -d "$APP_DIR" ]; then
    echo "--- Project directory found at $APP_DIR ---"
    cd $APP_DIR
    
    # Install dependencies
    echo "--- Installing Project Dependencies ---"
    npm install

    # Build Frontend
    echo "--- Building Frontend ---"
    npm run build

    # Start Services with PM2
    echo "--- Starting Microservices with PM2 ---"
    pm2 start deploy/ecosystem.config.js
    pm2 save
    pm2 startup
else
    echo "!!! WARNING: Project directory $APP_DIR not found. Skipping build step."
    echo "!!! Please clone the repo to /var/www/telegram-app or update this script."
fi

# 7. Configure Nginx
echo "--- Configuring Nginx ---"
# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Copy our config (Assuming script is running from deploy folder or we cat it)
# In a real scenario, you would copy the deploy/nginx.conf to /etc/nginx/sites-available/telegram
# Here we just check if the file exists in the repo
if [ -f "$APP_DIR/deploy/nginx.conf" ]; then
    cp $APP_DIR/deploy/nginx.conf /etc/nginx/sites-available/telegram
    ln -s /etc/nginx/sites-available/telegram /etc/nginx/sites-enabled/
    nginx -t
    systemctl restart nginx
else
    echo "!!! Nginx config file not found in $APP_DIR/deploy/nginx.conf"
fi

# 8. Setup Firewall
echo "--- Configuring Firewall ---"
ufw allow 'Nginx Full'
ufw allow OpenSSH
ufw enable

echo ">>> Setup Complete! database is ready, services are running (if code exists), and Nginx is configured."
echo ">>> Database URL: postgres://telegram:secure_pass@localhost:5432/telegram_db"
