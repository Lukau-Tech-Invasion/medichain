# MediChain Mobile Examples

This folder contains a comprehensive Expo starter app for testing connectivity between React Native/Expo mobile apps and the MediChain backend services.

## 🚀 Quick Start

```bash
# From this folder
cd medichain/mobile-examples/expo-starter

# Install dependencies
npm install

# Start Expo development server
npm run start
```

## 📱 What This Tests

The diagnostic app tests four critical connection points:

| Test | Target | Port | Description |
|------|--------|------|-------------|
| **API Health** | REST API | 8080 | Actix-web server health check |
| **Authentication** | REST API | 8080 | Wallet-based auth with X-User-Id header |
| **Data Endpoint** | REST API | 8080 | RBAC-protected patient data access |
| **WebSocket** | Substrate Node | 9944 | Blockchain node connectivity |

## ⚙️ Configuration

Before running, update `App.tsx` with your machine's LAN IP address:

```typescript
// Replace with your machine's IP (find with: ipconfig / ip addr)
const [apiUrl, setApiUrl] = useState('http://192.168.1.100:8080');
const [wsUrl, setWsUrl] = useState('ws://192.168.1.100:9944');
```

> ⚠️ **Important:** Do NOT use `localhost` — it won't work on physical devices!

## 🔧 Prerequisites

1. **MediChain API server running:**
   ```bash
   cd medichain
   cargo run -p medichain-api
   # OR on Windows: .\run-api.bat
   ```

2. **For Substrate WebSocket tests**, the node should also be running:
   ```bash
   cargo run -p medichain-node -- --dev
   ```

3. **For Android HTTP connections**, enable cleartext traffic:
   ```json
   // app.json
   {
     "expo": {
       "android": {
         "usesCleartextTraffic": true
       }
     }
   }
   ```

## 📋 Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| "Network request failed" | Using localhost | Use machine's LAN IP |
| Works on iOS, fails on Android | Cleartext blocked | Enable `usesCleartextTraffic` |
| 401 Unauthorized | Invalid wallet address | Use 48-char SS58 starting with "5" |
| WebSocket error | Wrong protocol | Use `ws://` not `http://` |
| Connection timeout | Firewall blocking | Allow port 8080/9944 |

## 📚 Related Documentation

- [COMPREHENSIVE_CONNECTION_ANALYSIS.md](../docs/COMPREHENSIVE_CONNECTION_ANALYSIS.md) - Full technical analysis
- [CONNECTION_TROUBLESHOOTING_RUNBOOK.md](../docs/CONNECTION_TROUBLESHOOTING_RUNBOOK.md) - Quick fixes
- [BLOCKCHAIN_MOBILE_AMD.md](../docs/BLOCKCHAIN_MOBILE_AMD.md) - Blockchain-specific issues
- [MOBILE_AUTH_FLOW.md](../docs/MOBILE_AUTH_FLOW.md) - Authentication patterns

## ⚡ Polyfills for Blockchain Libraries

If you're extending this app to use `@polkadot/api` or similar libraries, you'll need polyfills:

```javascript
// index.js (MUST BE FIRST)
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
global.Buffer = Buffer;
```

```javascript
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  buffer: require.resolve('buffer/'),
  stream: require.resolve('stream-browserify'),
  events: require.resolve('events/'),
  process: require.resolve('process/browser'),
};

module.exports = config;
```

## 📦 Dependencies

The starter includes minimal dependencies:
- `expo` - Expo SDK
- `react` / `react-native` - Core React Native
- `react-native-get-random-values` - Crypto polyfill
- `buffer` - Buffer polyfill

For production apps, consider adding:
- `expo-secure-store` - Secure key storage
- `@react-native-community/netinfo` - Network state monitoring
- `expo-local-authentication` - Biometric auth

---

*© 2025-2026 Trustware. MediChain Health ID System.*

