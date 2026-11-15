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
import { deriveAuthProof } from './src/auth/proof';

/**
 * MediChain Connection Tester
 * 
 * Comprehensive diagnostic app for testing connectivity between
 * React Native/Expo mobile apps and MediChain backend services.
 * 
 * Tests:
 * - REST API connectivity (Actix-web server on :8080)
 * - Authentication flow
 * - Request timing and latency
 * 
 * Usage:
 * 1. Start MediChain API: cd medichain && cargo run -p medichain-api
 * 2. Find your machine's LAN IP (ipconfig / ip addr)
 * 3. Create .env file with EXPO_PUBLIC_API_URL
 * 4. Run this app on device/emulator
 * 
 * Environment Variables (see .env.example):
 * - EXPO_PUBLIC_API_URL: API server URL (e.g., http://192.168.1.100:8080)
 * 
 * © 2025-2026 Lukau Invasion (Pty) Ltd. MediChain Health ID System.
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

interface LogEntry {
  time: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

export default function App() {
  // Configuration - initialize from environment
  const [apiUrl, setApiUrl] = useState(getDefaultApiUrl());
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  // Held in memory for this diagnostics session only.
  const [accessToken, setAccessToken] = useState<string | undefined>(undefined);
  
  // State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Show initial configuration on mount
  useEffect(() => {
    log(`Platform: ${Platform.OS}`, 'info');
    log(`API URL: ${apiUrl}`, 'info');
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
    log('Testing sign-in with a username and password...', 'info');

    if (!loginId.trim() || !password) {
      log('❌ Enter a username and password first', 'error');
      return false;
    }

    try {
      // The proof, never the password, is what is sent.
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: loginId.trim(),
          auth_proof: deriveAuthProof(password, loginId),
        }),
      });

      const data = await res.json();

      if (res.ok && data.access_token) {
        setAccessToken(data.access_token);
        log(`✅ Sign-in OK`, 'success');
        log(`   Role: ${data.user?.role || 'unknown'}`, 'info');
        log(`   Name: ${data.user?.name || 'N/A'}`, 'info');
        return true;
      } else if (data.mfa_required) {
        log('⚠️ This account needs an authenticator code; use the app sign-in screen', 'warning');
        return false;
      } else {
        log(`⚠️ Sign-in response: ${res.status}`, 'warning');
        log(`   ${data.error?.message || data.error || JSON.stringify(data)}`, 'warning');
        return false;
      }
    } catch (err: any) {
      log(`❌ Sign-in FAILED: ${err.message}`, 'error');
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
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
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
    let total = 3;
    
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
          
          <Text style={styles.label}>Test username</Text>
          <TextInput
            style={styles.input}
            value={loginId}
            onChangeText={setLoginId}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Test password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
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
          <Text style={styles.tipText}>• Sign-in needs an activated account (username and password)</Text>
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
