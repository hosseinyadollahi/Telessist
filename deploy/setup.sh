#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "----------------------------------------------------------------"
echo "Starting Telegram Clone Automated Setup..."
echo "----------------------------------------------------------------"

# 1. Update System
echo ">>> Updating system packages..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential nginx ufw postgresql postgresql-contrib

# 2. Install Node.js 20 (LTS)
echo ">>> Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "Node.js is already installed."
fi

# 3. Configure PostgreSQL
echo ">>> Configuring PostgreSQL..."
# Create user if not exists
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='telegram'" | grep -q 1 || sudo -u postgres psql -c "CREATE USER telegram WITH PASSWORD 'secure_pass';"
# Create DB if not exists
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='telegram_db'" | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE telegram_db OWNER telegram;"
# Grant privileges
sudo -u postgres psql -c "ALTER USER telegram CREATEDB;"

# 4. Project Dependencies & Build
echo ">>> Setting up project..."
# Get the project root directory (assuming script is run from project root or deploy folder)
# We assume the user is inside the project folder when running this
PROJECT_ROOT=$(pwd)
if [[ "$PROJECT_ROOT" == */deploy ]]; then
    cd ..
    PROJECT_ROOT=$(pwd)
fi

echo "Installing NPM dependencies..."
npm install

echo "Building Frontend..."
npm run build

# 5. PM2 Setup
echo ">>> Setting up PM2 Process Manager..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
fi

echo "Starting services..."
pm2 start deploy/ecosystem.config.cjs
pm2 save

# 6. Nginx Setup
echo ">>> Configuring Nginx..."
# Update the root path in nginx.conf dynamically to current directory
sed -i "s|root /var/www/telegram-app/dist|root $PROJECT_ROOT/dist|g" deploy/nginx.conf

# Remove default site if exists
if [ -f /etc/nginx/sites-enabled/default ]; then
    sudo rm /etc/nginx/sites-enabled/default
fi

# Copy config and enable
sudo cp deploy/nginx.conf /etc/nginx/sites-available/telegram-app
sudo ln -sf /etc/nginx/sites-available/telegram-app /etc/nginx/sites-enabled/

# Test and restart
echo "Testing Nginx configuration..."
sudo nginx -t
sudo systemctl restart nginx

# 7. Firewall
echo ">>> Configuring Firewall..."
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
# Note: We do not run 'ufw enable' automatically to avoid locking you out of SSH. 
# Please run 'sudo ufw enable' manually if firewall is not active.

echo "----------------------------------------------------------------"
echo "SETUP COMPLETE!"
echo "----------------------------------------------------------------"
echo "1. Your app services are running via PM2."
echo "2. Nginx is configured to serve the app."
echo "3. Database 'telegram_db' is ready."
echo ""
echo "IMPORTANT:"
echo "- Please edit '/etc/nginx/sites-available/telegram-app' to set your correct domain name."
echo "- Change the database password 'secure_pass' in 'deploy/ecosystem.config.cjs' and database for production."
echo "----------------------------------------------------------------"
