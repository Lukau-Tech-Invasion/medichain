/**
 * MediChain patient app root (Phase 8.3).
 *
 * Dependency-light navigation (no react-navigation) to keep the starter
 * self-contained: Login → biometric unlock → tabbed Emergency Card / Records.
 *
 * To make this the app entry, point `App.tsx` (or index.js) at this component:
 *   import MediChainApp from './src/MediChainApp';
 *   export default MediChainApp;
 * The existing connectivity-tester `App.tsx` is preserved for diagnostics.
 *
 * © 2025-2026 Trustware. MediChain Health ID System.
 */

import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginScreen } from './screens/LoginScreen';
import { EmergencyCardScreen } from './screens/EmergencyCardScreen';
import { MyRecordsScreen } from './screens/MyRecordsScreen';

type Tab = 'emergency' | 'records';

function Shell() {
  const { user, loading, unlocked, unlockWithBiometrics } = useAuth();
  const [tab, setTab] = useState<Tab>('emergency');

  // Prompt for biometrics once a session exists but is locked.
  useEffect(() => {
    if (user && !unlocked) {
      unlockWithBiometrics();
    }
  }, [user, unlocked, unlockWithBiometrics]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0f766e" />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (!unlocked) {
    return (
      <View style={styles.center}>
        <Text style={styles.lockTitle}>Locked</Text>
        <Text style={styles.lockHint}>Verify your identity to view medical data.</Text>
        <TouchableOpacity style={styles.unlockBtn} onPress={unlockWithBiometrics}>
          <Text style={styles.unlockText}>Unlock</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.flex}>
        {tab === 'emergency' ? <EmergencyCardScreen /> : <MyRecordsScreen />}
      </View>
      <View style={styles.tabBar}>
        <TabButton label="Emergency" active={tab === 'emergency'} onPress={() => setTab('emergency')} />
        <TabButton label="Records" active={tab === 'records'} onPress={() => setTab('records')} />
      </View>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.tab} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function MediChainApp() {
  return (
    <AuthProvider>
      <SafeAreaView style={styles.flex}>
        <StatusBar barStyle="dark-content" />
        <Shell />
      </SafeAreaView>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  lockTitle: { fontSize: 24, fontWeight: '800', color: '#0f172a' },
  lockHint: { fontSize: 15, color: '#64748b', marginTop: 8, textAlign: 'center' },
  unlockBtn: { backgroundColor: '#0f766e', borderRadius: 10, paddingHorizontal: 32, paddingVertical: 14, marginTop: 24 },
  unlockText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e2e8f0', backgroundColor: '#fff' },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
  tabTextActive: { color: '#0f766e' },
});
