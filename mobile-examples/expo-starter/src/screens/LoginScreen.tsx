/**
 * Sign-in screen (Phase 8.3): username and password, plus the authenticator
 * code when the account has one.
 *
 * A patient who has not activated yet does so once, in the patient app or at
 * their clinic, with the one-time code the clinic gave them.
 *
 * © 2025-2026 Lukau Invasion (Pty) Ltd. MediChain Health ID System.
 */

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '../auth/AuthContext';

export function LoginScreen() {
  const { login, loading, error, mfaRequired } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const ready = username.trim() !== '' && password !== '' && (!mfaRequired || code.trim() !== '');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MediChain</Text>
      <Text style={styles.subtitle}>National Health ID</Text>

      <Text style={styles.label}>Username</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
        value={username}
        onChangeText={setUsername}
      />

      <Text style={[styles.label, styles.gap]}>Password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
        value={password}
        onChangeText={setPassword}
      />

      {mfaRequired ? (
        <>
          <Text style={[styles.label, styles.gap]}>Authentication code</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            value={code}
            onChangeText={setCode}
          />
        </>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, (loading || !ready) && styles.buttonDisabled]}
        disabled={loading || !ready}
        onPress={async () => {
          const ok = await login(username, password, mfaRequired ? code.trim() : undefined);
          setCode('');
          if (!ok) setPassword('');
        }}
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
  gap: { marginTop: 16 },
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
