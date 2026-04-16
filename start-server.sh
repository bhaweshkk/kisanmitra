#!/bin/bash

# KisanMitra Startup Script for Linux/Mac
# This script ensures the server runs reliably

echo "========================================"
echo "    🌾 KisanMitra Server Startup"
echo "========================================"
echo

# Get script directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$DIR"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed or not in PATH"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Check if server.js exists
if [ ! -f "server.js" ]; then
    echo "❌ server.js not found in current directory"
    exit 1
fi

# Kill any existing node processes on our ports
echo "🔄 Checking for port conflicts..."

# Kill processes on port 3000
PIDS_3000=$(lsof -ti:3000 2>/dev/null)
if [ ! -z "$PIDS_3000" ]; then
    echo "Killing processes using port 3000: $PIDS_3000"
    kill -9 $PIDS_3000 2>/dev/null
fi

# Kill processes on port 3443
PIDS_3443=$(lsof -ti:3443 2>/dev/null)
if [ ! -z "$PIDS_3443" ]; then
    echo "Killing processes using port 3443: $PIDS_3443"
    kill -9 $PIDS_3443 2>/dev/null
fi

# Wait a moment for ports to be freed
sleep 2

echo "✅ Starting KisanMitra server..."
echo
echo "Server will be available at: http://localhost:3000"
echo "Admin panel at: http://localhost:3000/admin"
echo
echo "Press Ctrl+C to stop the server"
echo

# Start the server
node server.js

echo
echo "Server stopped. Press Enter to exit."
read
