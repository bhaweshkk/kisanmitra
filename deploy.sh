#!/bin/bash
# deploy.sh — Deploy KisanMitra to a Linux VPS
# Usage: bash deploy.sh
# Tested on Ubuntu 20.04 / 22.04

set -e

echo "🌾 KisanMitra Deployment Script"
echo "================================"

# ── 1. Check Node.js ──────────────────────────
if ! command -v node &> /dev/null; then
  echo "📦 Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "✅ Node.js $(node -v)"

# ── 2. Create app directory ──────────────────
APP_DIR="/opt/kisanmitra"
sudo mkdir -p "$APP_DIR"
sudo chown $USER:$USER "$APP_DIR"

# ── 3. Copy files ────────────────────────────
echo "📁 Copying files to $APP_DIR..."
cp -r . "$APP_DIR/"
cd "$APP_DIR"

# ── 4. Create .env if missing ────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "⚠️  Please edit $APP_DIR/.env and add your ANTHROPIC_API_KEY"
  echo "    Then run: sudo systemctl restart kisanmitra"
fi

# ── 5. Create systemd service ────────────────
echo "⚙️  Creating systemd service..."
sudo tee /etc/systemd/system/kisanmitra.service > /dev/null <<EOF
[Unit]
Description=KisanMitra Web Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
EnvironmentFile=$APP_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable kisanmitra
sudo systemctl start kisanmitra

echo ""
echo "✅ KisanMitra is running!"
echo "   Status: sudo systemctl status kisanmitra"
echo "   Logs:   sudo journalctl -u kisanmitra -f"
echo "   URL:    http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_SERVER_IP'):3000"
