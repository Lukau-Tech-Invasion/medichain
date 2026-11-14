/**
 * Emergency Card screen (Phase 8.3) — the headline mobile feature.
 *
 * Shows blood type, allergies, conditions and emergency contact from the
 * patient's own record (`GET /api/my-records`). Mirrors the web EmergencyCardPage.
 *
 * © 2025-2026 Lukau Invasion (Pty) Ltd. MediChain Health ID System.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, Switch } from 'react-native';
import { apiClient } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { forgetPhone, isPhoneEnrolled, refreshPhoneCard, type SavedCard } from '../lockscreen/phoneCard';
import { PhoneCardView } from '../lockscreen/PhoneCardView';

interface EmergencyInfo {
  blood_type?: string;
  allergies?: string[];
  chronic_conditions?: string[];
  current_medications?: string[];
  emergency_contact?: { name?: string; phone?: string; relationship?: string };
}

interface ProfileResponse {
  health_id?: string;
  full_name?: string;
  emergency_info?: EmergencyInfo;
}

export function EmergencyCardScreen() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiClient.get<ProfileResponse>('/api/my-records');
      setProfile(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
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

  const info = profile?.emergency_info ?? {};

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
    >
      <View style={styles.banner}>
        <Text style={styles.bannerLabel}>EMERGENCY MEDICAL CARD</Text>
        <Text style={styles.name}>{profile?.full_name ?? user?.name ?? 'Patient'}</Text>
        <Text style={styles.healthId}>{profile?.health_id ?? user?.healthId ?? ''}</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Field label="Blood Type" value={info.blood_type ?? 'Unknown'} highlight />
      <ListField label="Allergies" values={info.allergies} empty="No known allergies" />
      <ListField label="Chronic Conditions" values={info.chronic_conditions} empty="None recorded" />
      <ListField label="Current Medications" values={info.current_medications} empty="None recorded" />

      {user?.healthId ? <PhoneLockscreenSection patientId={user.healthId} /> : null}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Emergency Contact</Text>
        <Text style={styles.cardValue}>
          {info.emergency_contact?.name ?? 'Not set'}
          {info.emergency_contact?.relationship ? ` (${info.emergency_contact.relationship})` : ''}
        </Text>
        {info.emergency_contact?.phone ? (
          <Text style={styles.cardValue}>{info.emergency_contact.phone}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

/**
 * Whether this phone shows the medical ID while locked. Turning it on records
 * the patient's choice, enrols the phone and saves the card; turning it off
 * revokes the phone and deletes the card from it. While on, opening this
 * screen refreshes the saved card.
 */
function PhoneLockscreenSection({ patientId }: { patientId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState<SavedCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!(await isPhoneEnrolled(patientId))) return;
      if (active) setEnabled(true);
      try {
        const fresh = await refreshPhoneCard(patientId);
        if (active) setSaved(fresh);
      } catch {
        if (active) setMessage('Could not refresh the card; the copy on this phone is unchanged.');
      }
    })();
    return () => { active = false; };
  }, [patientId]);

  const toggle = async (next: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      if (next) {
        await apiClient.post(`/api/medical-id/${encodeURIComponent(patientId)}/preferences`, { show_when_locked: true });
        setSaved(await refreshPhoneCard(patientId));
        setEnabled(true);
      } else {
        await forgetPhone('Patient turned off the lock-screen medical ID');
        await apiClient.post(`/api/medical-id/${encodeURIComponent(patientId)}/preferences`, { show_when_locked: false });
        setSaved(null);
        setEnabled(false);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={[styles.cardLabel, styles.flex]}>Show on this phone when locked</Text>
        <Switch
          value={enabled}
          onValueChange={toggle}
          disabled={busy}
          accessibilityLabel="Show my medical ID on this phone when it is locked"
        />
      </View>
      <Text style={styles.muted}>
        A responder can read your blood type, allergies and contact without unlocking the app.
      </Text>
      {message ? <Text style={styles.error}>{message}</Text> : null}
      {saved ? <View style={styles.preview}><PhoneCardView saved={saved} /></View> : null}
    </View>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={[styles.cardValue, highlight && styles.highlight]}>{value}</Text>
    </View>
  );
}

function ListField({ label, values, empty }: { label: string; values?: string[]; empty: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      {values && values.length > 0 ? (
        values.map((v, i) => (
          <Text key={i} style={styles.cardValue}>
            • {v}
          </Text>
        ))
      ) : (
        <Text style={styles.muted}>{empty}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  banner: { backgroundColor: '#b91c1c', padding: 20 },
  bannerLabel: { color: '#fecaca', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  name: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 4 },
  healthId: { color: '#fee2e2', fontSize: 14, marginTop: 2 },
  card: { backgroundColor: '#fff', margin: 12, marginBottom: 0, padding: 16, borderRadius: 12 },
  cardLabel: { fontSize: 12, color: '#64748b', fontWeight: '700', textTransform: 'uppercase' },
  cardValue: { fontSize: 16, color: '#0f172a', marginTop: 4 },
  highlight: { fontSize: 28, fontWeight: '800', color: '#b91c1c' },
  muted: { fontSize: 15, color: '#94a3b8', marginTop: 4 },
  error: { color: '#dc2626', margin: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  preview: { marginTop: 12 },
});
