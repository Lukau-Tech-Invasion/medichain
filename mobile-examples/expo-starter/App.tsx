import React, { useState, useCallback, useEffect } from 'react';
import {
  SafeAreaView,
  ScrollView,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  StatusBar
} from 'react-native';
import Constants from 'expo-constants';

/**
 * MediChain Connection Tester
 * 
 * Comprehensive diagnostic app for testing connectivity between
 * React Native/Expo mobile apps and MediChain backend services.
 * 
 * Tests:
 * - REST API connectivity (Actix-web server on :8080)
 * - Substrate node WebSocket (on :9944)
 * - Authentication flow
 * - Request timing and latency
 * 
 * Usage:
 * 1. Start MediChain API: cd medichain && cargo run -p medichain-api
 * 2. Find your machine's LAN IP (ipconfig / ip addr)
 * 3. Create .env file with EXPO_PUBLIC_API_URL and EXPO_PUBLIC_SUBSTRATE_WS_URL
 * 4. Run this app on device/emulator
 * 
 * Environment Variables (see .env.example):
 * - EXPO_PUBLIC_API_URL: API server URL (e.g., http://192.168.1.100:8080)
 * - EXPO_PUBLIC_SUBSTRATE_WS_URL: WebSocket URL (e.g., ws://192.168.1.100:9944)
 * 
 * © 2025-2026 Trustware. MediChain Health ID System.
 */

// ============================================================================
// Configuration from Environment Variables
// ============================================================================

/**
 * Get API URL from environment or detect automatically
 * Priority: Env var → Android emulator special IP → Fallback
 */
function getDefaultApiUrl(): string {
  // 1. Check environment variable
  const envUrl = Constants.expoConfig?.extra?.apiUrl || 
                 process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) return envUrl;
  
  // 2. Android emulator uses special IP to reach host
  if (Platform.OS === 'android') {
    // Check if running in emulator (common pattern)
    return 'http://10.0.2.2:8080';
  }
  
  // 3. iOS simulator can use localhost
  if (Platform.OS === 'ios') {
    return 'http://127.0.0.1:8080';
  }
  
  // 4. Fallback - user must configure
  return 'http://YOUR_COMPUTER_IP:8080';
}

/**
 * Get WebSocket URL from environment or detect automatically
 */
function getDefaultWsUrl(): string {
  const envUrl = Constants.expoConfig?.extra?.wsUrl || 
                 process.env.EXPO_PUBLIC_SUBSTRATE_WS_URL;
  if (envUrl) return envUrl;
  
  if (Platform.OS === 'android') {
    return 'ws://10.0.2.2:9944';
  }
  
  if (Platform.OS === 'ios') {
    return 'ws://127.0.0.1:9944';
  }
  
  return 'ws://YOUR_COMPUTER_IP:9944';
}

// Sample wallet address for testing (from MediChain demo data)
const SAMPLE_WALLET = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

interface LogEntry {
  time: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

export default function App() {
  // Configuration - initialize from environment
  const [apiUrl, setApiUrl] = useState(getDefaultApiUrl());
  const [wsUrl, setWsUrl] = useState(getDefaultWsUrl());
  const [walletAddress, setWalletAddress] = useState(SAMPLE_WALLET);
  
  // State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Show initial configuration on mount
  useEffect(() => {
    log(`Platform: ${Platform.OS}`, 'info');
    log(`API URL: ${apiUrl}`, 'info');
    log(`WebSocket URL: ${wsUrl}`, 'info');
    if (apiUrl.includes('YOUR_COMPUTER_IP')) {
      log('⚠️ Please update API URL with your machine\'s IP address', 'warning');
      log('   Find IP: Windows=ipconfig, Mac/Linux=ifconfig', 'warning');
    }
  }, []);

  // Logging helper
  const log = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [{ time, message, type }, ...prev.slice(0, 49)]);
  }, []);

  // Clear logs
  const clearLogs = () => setLogs([]);

  // ============================================================================
  // TEST 1: API Health Check
  // ============================================================================
  const testApiHealth = async () => {
    log('Testing API health endpoint...', 'info');
    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const res = await fetch(`${apiUrl}/api/health`, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      const latency = Date.now() - startTime;
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      log(`✅ API Health OK (${latency}ms)`, 'success');
      log(`   Response: ${JSON.stringify(data)}`, 'info');
      return true;
    } catch (err: any) {
      const latency = Date.now() - startTime;
      
      if (err.name === 'AbortError') {
        log(`❌ API Health TIMEOUT after ${latency}ms`, 'error');
      } else if (err.message === 'Network request failed') {
        log(`❌ Network request failed - check URL and server`, 'error');
        log(`   Tip: Use your machine's LAN IP, not localhost`, 'warning');
      } else {
        log(`❌ API Health FAILED: ${err.message}`, 'error');
      }
      return false;
    }
  };

  // ============================================================================
  // TEST 2: Authentication Check
  // ============================================================================
  const testAuth = async () => {
    log('Testing authentication with wallet address...', 'info');
    
    // Validate wallet address format first
    if (!walletAddress || walletAddress.length !== 48 || !walletAddress.startsWith('5')) {
      log(`❌ Invalid wallet address format`, 'error');
      log(`   Expected: 48 chars starting with "5" (SS58)`, 'warning');
      log(`   Got: ${walletAddress.length} chars, starts with "${walletAddress[0]}"`, 'warning');
      return false;
    }
    
    try {
      const res = await fetch(`${apiUrl}/api/auth/me`, {
        headers: {
          'X-User-Id': walletAddress,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await res.json();
      
      if (res.ok) {
        log(`✅ Auth OK - User found`, 'success');
        log(`   Role: ${data.role || 'unknown'}`, 'info');
        log(`   Name: ${data.name || data.username || 'N/A'}`, 'info');
        return true;
      } else {
        log(`⚠️ Auth response: ${res.status}`, 'warning');
        log(`   ${data.error || JSON.stringify(data)}`, 'warning');
        return false;
      }
    } catch (err: any) {
      log(`❌ Auth FAILED: ${err.message}`, 'error');
      return false;
    }
  };

  // ============================================================================
  // TEST 3: List Patients (RBAC test)
  // ============================================================================
  const testPatients = async () => {
    log('Testing /api/patients endpoint (requires auth)...', 'info');
    
    try {
      const res = await fetch(`${apiUrl}/api/patients`, {
        headers: {
          'X-User-Id': walletAddress,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await res.json();
      
      if (res.ok) {
        const count = data.patients?.length ?? data.length ?? 0;
        log(`✅ Patients endpoint OK`, 'success');
        log(`   Found ${count} patient(s)`, 'info');
        return true;
      } else {
        log(`❌ Patients endpoint failed: ${res.status}`, 'error');
        log(`   ${data.error || 'Check user role permissions'}`, 'warning');
        return false;
      }
    } catch (err: any) {
      log(`❌ Patients FAILED: ${err.message}`, 'error');
      return false;
    }
  };

  // ============================================================================
  // TEST 4: Substrate WebSocket
  // ============================================================================
  const testWebSocket = async (): Promise<boolean> => {
    return new Promise((resolve) => {
      log('Testing Substrate WebSocket connection...', 'info');
      log(`   Connecting to ${wsUrl}`, 'info');
      
      try {
        const ws = new WebSocket(wsUrl);
        let resolved = false;
        
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            ws.close();
            log(`❌ WebSocket TIMEOUT after 10s`, 'error');
            resolve(false);
          }
        }, 10000);
        
        ws.onopen = () => {
          log(`✅ WebSocket connected`, 'success');
          
          // Send RPC request
          const msg = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'system_health',
            params: []
          });
          ws.send(msg);
          log(`   Sent system_health request`, 'info');
        };
        
        ws.onmessage = (event) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            
            try {
              const data = JSON.parse(event.data);
              log(`✅ WebSocket response received`, 'success');
              log(`   Peers: ${data.result?.peers ?? 'N/A'}`, 'info');
              log(`   Syncing: ${data.result?.isSyncing ?? 'N/A'}`, 'info');
            } catch {
              log(`   Raw response: ${event.data.substring(0, 100)}`, 'info');
            }
            
            ws.close();
            resolve(true);
          }
        };
        
        ws.onerror = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            log(`❌ WebSocket error`, 'error');
            log(`   Check if Substrate node is running on ${wsUrl}`, 'warning');
            resolve(false);
          }
        };
        
        ws.onclose = (event) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            log(`⚠️ WebSocket closed (code: ${event.code})`, 'warning');
            resolve(false);
          }
        };
        
      } catch (err: any) {
        log(`❌ WebSocket exception: ${err.message}`, 'error');
        resolve(false);
      }
    });
  };

  // ============================================================================
  // RUN ALL TESTS
  // ============================================================================
  const runAllTests = async () => {
    if (isRunning) return;
    
    setIsRunning(true);
    clearLogs();
    
    log('═══════════════════════════════════════', 'info');
    log('MediChain Connection Diagnostics', 'info');
    log(`Platform: ${Platform.OS}`, 'info');
    log(`API URL: ${apiUrl}`, 'info');
    log('═══════════════════════════════════════', 'info');
    
    let passed = 0;
    let total = 4;
    
    // Test 1: API Health
    log('\n📡 TEST 1: API Health Check', 'info');
    if (await testApiHealth()) passed++;
    
    // Small delay between tests
    await new Promise(r => setTimeout(r, 500));
    
    // Test 2: Auth
    log('\n🔐 TEST 2: Authentication', 'info');
    if (await testAuth()) passed++;
    
    await new Promise(r => setTimeout(r, 500));
    
    // Test 3: Data endpoint
    log('\n📋 TEST 3: Data Endpoint (Patients)', 'info');
    if (await testPatients()) passed++;
    
    await new Promise(r => setTimeout(r, 500));
    
    // Test 4: WebSocket
    log('\n🔌 TEST 4: Substrate WebSocket', 'info');
    if (await testWebSocket()) passed++;
    
    // Summary
    log('\n═══════════════════════════════════════', 'info');
    const allPassed = passed === total;
    log(
      allPassed 
        ? `🎉 ALL TESTS PASSED (${passed}/${total})` 
        : `⚠️ ${passed}/${total} tests passed`,
      allPassed ? 'success' : 'warning'
    );
    log('═══════════════════════════════════════', 'info');
    
    setIsRunning(false);
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>🔧 MediChain Connectivity</Text>
        <Text style={styles.subtitle}>Connection Diagnostic Tool</Text>
        
        {/* Configuration */}
        <View style={styles.section}>
          <Text style={styles.label}>REST API URL</Text>
          <TextInput
            style={styles.input}
            value={apiUrl}
            onChangeText={setApiUrl}
            placeholder="http://192.168.1.100:8080"
            autoCapitalize="none"
            autoCorrect={false}
          />
          
          <Text style={styles.label}>Substrate WebSocket URL</Text>
          <TextInput
            style={styles.input}
            value={wsUrl}
            onChangeText={setWsUrl}
            placeholder="ws://192.168.1.100:9944"
            autoCapitalize="none"
            autoCorrect={false}
          />
          
          <Text style={styles.label}>Test Wallet Address (SS58)</Text>
          <TextInput
            style={[styles.input, styles.monoInput]}
            value={walletAddress}
            onChangeText={setWalletAddress}
            placeholder="5Grw..."
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        
        {/* Actions */}
        <View style={styles.buttonRow}>
          <TouchableOpacity 
            style={[styles.button, styles.primaryButton, isRunning && styles.disabledButton]}
            onPress={runAllTests}
            disabled={isRunning}
          >
            <Text style={styles.buttonText}>
              {isRunning ? '⏳ Running...' : '▶️ Run All Tests'}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.button, styles.secondaryButton]}
            onPress={clearLogs}
          >
            <Text style={styles.secondaryButtonText}>Clear</Text>
          </TouchableOpacity>
        </View>
        
        {/* Individual test buttons */}
        <View style={styles.smallButtonRow}>
          <TouchableOpacity style={styles.smallButton} onPress={testApiHealth}>
            <Text style={styles.smallButtonText}>Health</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={testAuth}>
            <Text style={styles.smallButtonText}>Auth</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={testPatients}>
            <Text style={styles.smallButtonText}>Patients</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={testWebSocket}>
            <Text style={styles.smallButtonText}>WebSocket</Text>
          </TouchableOpacity>
        </View>
        
        {/* Logs */}
        <View style={styles.logsContainer}>
          <Text style={styles.logsHeader}>📜 Diagnostic Logs</Text>
          {logs.length === 0 ? (
            <Text style={styles.logsPlaceholder}>
              Press "Run All Tests" to start diagnostics...
            </Text>
          ) : (
            logs.map((entry, i) => (
              <Text 
                key={i} 
                style={[
                  styles.logLine,
                  entry.type === 'success' && styles.logSuccess,
                  entry.type === 'error' && styles.logError,
                  entry.type === 'warning' && styles.logWarning,
                ]}
              >
                <Text style={styles.logTime}>{entry.time}</Text> {entry.message}
              </Text>
            ))
          )}
        </View>
        
        {/* Tips */}
        <View style={styles.tips}>
          <Text style={styles.tipsTitle}>💡 Troubleshooting Tips</Text>
          <Text style={styles.tipText}>• Use your machine's LAN IP, not localhost</Text>
          <Text style={styles.tipText}>• Ensure API server is running (cargo run -p medichain-api)</Text>
          <Text style={styles.tipText}>• For Android HTTP, enable cleartext in AndroidManifest</Text>
          <Text style={styles.tipText}>• Wallet address must be 48 chars starting with "5"</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  scroll: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a2e',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  section: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
  },
  monoInput: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  button: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#4CAF50',
  },
  secondaryButton: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  disabledButton: {
    backgroundColor: '#9e9e9e',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  secondaryButtonText: {
    color: '#666',
    fontWeight: '600',
  },
  smallButtonRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 16,
  },
  smallButton: {
    flex: 1,
    backgroundColor: '#2196F3',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  smallButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  logsContainer: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    minHeight: 250,
  },
  logsHeader: {
    color: '#aaa',
    fontSize: 12,
    marginBottom: 12,
    fontWeight: '600',
  },
  logsPlaceholder: {
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 40,
  },
  logLine: {
    color: '#e0e0e0',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    marginBottom: 3,
    lineHeight: 16,
  },
  logTime: {
    color: '#888',
  },
  logSuccess: {
    color: '#4CAF50',
  },
  logError: {
    color: '#f44336',
  },
  logWarning: {
    color: '#ff9800',
  },
  tips: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#fff3e0',
    borderRadius: 12,
    marginBottom: 32,
  },
  tipsTitle: {
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#e65100',
  },
  tipText: {
    fontSize: 12,
    color: '#bf360c',
    marginBottom: 4,
  },
});
