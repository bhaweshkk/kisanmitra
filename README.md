# KisanMitra Server

A robust and stable Node.js server for the KisanMitra agricultural platform.

## 🚀 Quick Start

### Option 1: Simple Startup (Recommended)
```bash
# Windows
start-server.bat

# Linux/Mac
./start-server.sh
```

### Option 2: Direct Node Execution
```bash
node server.js
```

### Option 3: Process Manager (Auto-restart)
```bash
node process-manager.js
```

## 🌐 Server URLs

Once started, the server will be available at:
- **Main Website**: http://localhost:3000 (or next available port)
- **Admin Panel**: http://localhost:3000/admin
- **Health Check**: http://localhost:3000/api/health
- **API Documentation**: http://localhost:3000/api/plugins

## ⚙️ Configuration

Server configuration is managed through the `.env` file:

```env
# API Keys
GROQ_API_KEY=your_groq_api_key
AUTH_SECRET=your_auth_secret

# Admin
ADMIN_PASSWORD=admin123

# Server Settings
PORT=3000
HOST=0.0.0.0
MAX_REQ_PER_MIN=120
MAX_CONNECTIONS=1000
REQUEST_TIMEOUT=30000
KEEP_ALIVE_TIMEOUT=65000
```

## 🛡️ Security Features

- **Hidden Admin Password**: Admin credentials stored securely in `.env`
- **Rate Limiting**: 120 requests per minute per IP
- **Connection Limits**: Maximum 1000 concurrent connections
- **Request Timeouts**: 30-second timeout for requests
- **Input Validation**: Comprehensive validation for all endpoints
- **Secure Headers**: CORS, security headers, and XSS protection

## 🔧 Stability Features

### Automatic Port Resolution
- Automatically finds available ports if default ports are in use
- No more "EADDRINUSE" errors

### Connection Management
- Connection pooling and limits
- Graceful connection handling
- Memory monitoring and alerts

### Error Recovery
- Comprehensive error logging
- Graceful shutdown handling
- Process monitoring and auto-restart (with process-manager.js)

### Health Monitoring
- Real-time health checks
- Memory usage monitoring
- Connection count monitoring
- Slow request detection

## 📊 Monitoring

### Health Check Endpoint
```bash
curl http://localhost:3000/api/health
```

Returns server status including:
- Uptime
- Memory usage
- Connection count
- Server version

### Logs
Server logs are stored in the `logs/` directory:
- `logs/server.log` - Main server logs
- `logs/process-manager.log` - Process manager logs

## 🛠️ Troubleshooting

### Server Won't Start
1. Check if ports 3000/3443 are available
2. Run `start-server.bat` (Windows) to auto-resolve port conflicts
3. Check logs in `logs/` directory

### High Memory Usage
- Server monitors memory usage automatically
- Alerts logged when heap usage > 500MB
- Consider increasing system memory or optimizing code

### Connection Issues
- Check `MAX_CONNECTIONS` setting in `.env`
- Monitor connection count via health endpoint
- Server automatically manages connection limits

### Slow Performance
- Check slow request logs
- Monitor memory usage
- Consider increasing `REQUEST_TIMEOUT` if needed

## 🔄 Process Management

### Using Process Manager
The `process-manager.js` provides:
- Automatic restart on crashes
- Maximum restart attempts (10)
- 5-second delay between restarts
- Comprehensive logging

### Manual Management
```bash
# Start
node server.js

# Stop (Ctrl+C)
# Server performs graceful shutdown
```

## 📁 Project Structure

```
kisan-mitra/
├── server.js              # Main server file
├── process-manager.js     # Auto-restart manager
├── start-server.bat       # Windows startup script
├── .env                   # Environment configuration
├── lib/                   # Server modules
│   ├── auth.js           # Authentication
│   ├── db.js             # Database operations
│   ├── routes.js         # API routes
│   └── ...
├── public/               # Static files
│   ├── index.html        # Main website
│   └── kisanmitra-registration.html
├── logs/                 # Log files
└── data/                 # Database files (auto-created)
```

## 🚨 Emergency Stop

If the server becomes unresponsive:
```bash
# Find process
tasklist | findstr node

# Kill process (replace PID)
taskkill /f /pid <PID>
```

## 📞 Support

For issues:
1. Check server logs in `logs/` directory
2. Verify `.env` configuration
3. Test health endpoint: `http://localhost:3000/api/health`
4. Restart using `start-server.bat`

The server is now designed for maximum stability and reliability! 🌾✨
