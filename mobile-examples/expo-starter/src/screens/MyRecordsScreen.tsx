/**
 * My Records screen (Phase 8.3) — lists the patient's medical record references.
 *
 * © 2025-2026 Trustware. MediChain Health ID System.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { apiClient } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface RecordRef {
  record_id?: string;
  id?: string;
  record_type?: string;
  title?: string;
  created_at?: string;
}

export function MyRecordsScreen() {
  const { logout, unlockWithBiometrics } = useAuth();
  const [records, setRecords] = useState<RecordRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // /api/my-records returns the patient profile; records may live under a field.
      const data = await apiClient.get<{ medical_records?: RecordRef[] }>('/api/my-records');
      setRecords(Array.isArray(data.medical_records) ? data.medical_records : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0f766e" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={records}
        keyExtractor={(item, i) => item.record_id ?? item.id ?? String(i)}
        ListEmptyComponent={<Text style={styles.muted}>No records yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{item.title ?? item.record_type ?? 'Record'}</Text>
            {item.created_at ? <Text style={styles.rowDate}>{item.created_at}</Text> : null}
          </View>
        )}
      />
      <View style={styles.footer}>
        <TouchableOpacity style={styles.secondary} onPress={unlockWithBiometrics}>
          <Text style={styles.secondaryText}>Re-verify identity</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.logout} onPress={logout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  row: { backgroundColor: '#fff', marginHorizontal: 12, marginTop: 12, padding: 16, borderRadius: 12 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  rowDate: { fontSize: 13, color: '#64748b', marginTop: 4 },
  muted: { textAlign: 'center', color: '#94a3b8', marginTop: 40 },
  error: { color: '#dc2626', margin: 12 },
  footer: { padding: 12 },
  secondary: { padding: 14, alignItems: 'center' },
  secondaryText: { color: '#0f766e', fontWeight: '600' },
  logout: { padding: 14, alignItems: 'center' },
  logoutText: { color: '#dc2626', fontWeight: '600' },
});
