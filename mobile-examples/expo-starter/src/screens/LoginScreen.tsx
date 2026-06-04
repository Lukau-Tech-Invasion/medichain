/**
 * Wallet login screen (Phase 8.3).
 *
 * © 2025-2026 Trustware. MediChain Health ID System.
 */

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '../auth/AuthContext';

export function LoginScreen() {
  const { login, loading, error } = useAuth();
  const [wallet, setWallet] = useState('');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MediChain</Text>
      <Text style={styles.subtitle}>National Health ID</Text>

      <Text style={styles.label}>Wallet address</Text>
      <TextInput
        style={styles.input}
        placeholder="5Grw..."
        autoCapitalize="none"
        autoCorrect={false}
        value={wallet}
        onChangeText={setWallet}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, (loading || !wallet) && styles.buttonDisabled]}
        disabled={loading || !wallet}
        onPress={() => login(wallet.trim())}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f8fafc' },
  title: { fontSize: 34, fontWeight: '800', color: '#0f766e', textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#475569', textAlign: 'center', marginBottom: 32 },
  label: { fontSize: 13, color: '#334155', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
    fontSize: 16,
  },
  error: { color: '#dc2626', marginTop: 12 },
  button: {
    backgroundColor: '#0f766e',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
