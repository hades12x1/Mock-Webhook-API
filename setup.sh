#!/bin/bash

# Setup script for Webhook Mock API
# This script will:
# 1. Create necessary directories
# 2. Initialize SSL certificates with Certbot
# 3. Start the application with Docker Compose

# Color variables
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Function to print colored messages
print_message() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   print_message $RED "This script must be run as root (sudo)."
   exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_message $YELLOW "Docker not found. Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    usermod -aG docker $USER
    print_message $GREEN "Docker installed successfully."
else
    print_message $GREEN "Docker already installed."
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    print_message $YELLOW "Docker Compose not found. Installing Docker Compose..."
    apt-get update
    apt-get install -y docker-compose
    print_message $GREEN "Docker Compose installed successfully."
else
    print_message $GREEN "Docker Compose already installed."
fi

# Create directories
print_message $YELLOW "Creating required directories..."
mkdir -p certbot/www
mkdir -p certbot/conf
print_message $GREEN "Directories created."

# Check if .env file exists
if [ ! -f .env ]; then
    print_message $YELLOW "Creating .env file..."
    cat > .env << EOF
# Environment variables
MONGO_URI=mongodb://mongo:27017
MONGO_DB=webhook_mock
DOMAIN=webhook-api.autobot.site
SECRET_KEY=$(openssl rand -hex 32)
MAX_REQUESTS_PER_USER=100000
ADMIN_PASSWORD=admin
EOF
    print_message $GREEN ".env file created with default values. Please edit the file if needed."
else
    print_message $GREEN ".env file already exists."
fi

# Initial Nginx setup for certbot
print_message $YELLOW "Setting up temporary Nginx configuration for Certbot..."
mkdir -p docker/nginx
cat > docker/nginx/nginx.conf << EOF
server {
    listen 80;
    server_name webhook-api.autobot.site;
    server_tokens off;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF

# Start Nginx for certbot
print_message $YELLOW "Starting Nginx container for Certbot..."
cd docker && docker-compose up -d nginx
print_message $GREEN "Nginx started."

# Wait for Nginx to start
sleep 5

# Run Certbot to obtain SSL certificates
print_message $YELLOW "Obtaining SSL certificates with Certbot..."
docker run --rm \
    -v $(pwd)/../certbot/www:/var/www/certbot \
    -v $(pwd)/../certbot/conf:/etc/letsencrypt \
    certbot/certbot certonly --webroot \
    --webroot-path=/var/www/certbot \
    --agree-tos \
    --no-eff-email \
    --email admin@example.com \
    -d webhook-api.autobot.site \
    --force-renewal

# Check if certificates were obtained
if [ $? -ne 0 ]; then
    print_message $RED "Failed to obtain SSL certificates. Please check your domain DNS settings."
    print_message $YELLOW "Stopping Nginx..."
    docker-compose down
    exit 1
fi

print_message $GREEN "SSL certificates obtained successfully."

# Update Nginx configuration with SSL
print_message $YELLOW "Updating Nginx configuration with SSL settings..."
cat > nginx/nginx.conf << EOF
server {
    listen 80;
    server_name webhook-api.autobot.site;
    server_tokens off;

    # Certbot challenge location
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect all HTTP traffic to HTTPS
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name webhook-api.autobot.site;
    server_tokens off;

    # SSL certificates
    ssl_certificate /etc/letsencrypt/live/webhook-api.autobot.site/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/webhook-api.autobot.site/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Proxy settings
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    
    # Proxy WebSocket connections
    location /ws/ {
        proxy_pass http://app:8000;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # Proxy all other requests to the application
    location / {
        proxy_pass http://app:8000;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF

# Start all services
print_message $YELLOW "Starting all services..."
docker-compose down
docker-compose up -d
print_message $GREEN "All services started successfully."

# Print final instructions
print_message $YELLOW "=============================="
print_message $GREEN "Setup completed successfully!"
print_message $GREEN "Your Webhook Mock API is now running at: https://webhook-api.autobot.site"
print_message $GREEN "Default admin password: admin (change it in .env file)"
print_message $YELLOW "=============================="

# Return to original directory
cd ..