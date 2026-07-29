/**
 * Family screen (Phase 8.3) — QR-based family account linking.
 *
 * The mobile app is patient-only (wallet self-login, no provider role), so QR
 * scanning here is scoped to what a patient-only app actually needs: viewing/
 * sharing your OWN medical-id QR, and a family group's primary contact
 * scanning ANOTHER patient's own QR to add them to the group. This is
 * deliberately NOT the web NFCTapSimulator's provider-only emergency-access
 * QR flow (that requires a Doctor/Nurse role this app doesn't have) — see
 * docs/NEXT_WEEK_TODO.md for the scope decision.
 *
 * Reuses the existing `GET /api/medical-id/{patient_id}/qr` endpoint (already
 * RBAC'd to "view your own QR only") for both the display and the payload
 * scanned back off of it — no new backend contract needed.
 *
 * © 2025-2026 Lukau Invasion (Pty) Ltd. MediChain Health ID System.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { apiClient } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface FamilyMemberDto {
  patient_id: string;
  relationship: string;
  access_level: string;
}

interface FamilyGroupDto {
  family_id: string;
  family_name: string;
  primary_account_id: string;
  members: FamilyMemberDto[];
}

interface MedicalIdQrResponse {
  patient_id: string;
  qr_image_base64: string;
}

interface ScannedMedicalId {
  type: string;
  patient_id: string;
}

const RELATIONSHIPS = ['Spouse', 'Child', 'Parent', 'Sibling', 'Other'];
// These are the literal strings AddFamilyMemberRequest.access_level accepts
// (api/src/clinical_endpoints/engagement/family.rs) — distinct from the
// FamilyAccessLevel enum's own Serialize output used when *reading* a group.
const ACCESS_LEVELS = ['Full', 'ViewOnly', 'Limited', 'AppointmentsOnly', 'EmergencyOnly'];

type Pane = 'list' | 'myQr' | 'scan' | 'confirm' | 'createGroup';

export function FamilyScreen() {
  const { user } = useAuth();
  const [pane, setPane] = useState<Pane>('list');
  const [groups, setGroups] = useState<FamilyGroupDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [myQr, setMyQr] = useState<MedicalIdQrResponse | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [scanTargetGroupId, setScanTargetGroupId] = useState<string | null>(null);
  const [scanned, setScanned] = useState<ScannedMedicalId | null>(null);
  const [relationship, setRelationship] = useState(RELATIONSHIPS[0]);
  const [accessLevel, setAccessLevel] = useState(ACCESS_LEVELS[0]);
  const [newGroupName, setNewGroupName] = useState('');

  const loadGroups = useCallback(async () => {
    setError(null);
    try {
      const resp = await apiClient.get<{ groups: FamilyGroupDto[] }>('/api/family/groups');
      setGroups(Array.isArray(resp.groups) ? resp.groups : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load family groups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const openMyQr = useCallback(async () => {
    if (!user) return;
    setPane('myQr');
    setError(null);
    if (myQr) return;
    try {
      const resp = await apiClient.get<MedicalIdQrResponse>(`/api/medical-id/${user.walletAddress}/qr`);
      setMyQr(resp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your QR code');
    }
  }, [user, myQr]);

  const openScanner = useCallback(async (groupId: string) => {
    setScanTargetGroupId(groupId);
    setScanned(null);
    setError(null);
    const { status } = await BarCodeScanner.requestPermissionsAsync();
    setHasCameraPermission(status === 'granted');
    setPane('scan');
  }, []);

  const handleBarCodeScanned = useCallback(({ data }: { data: string }) => {
    try {
      const parsed = JSON.parse(data) as ScannedMedicalId;
      if (parsed.type !== 'medichain_medical_id' || !parsed.patient_id) {
        setError('That QR code is not a MediChain medical ID.');
        return;
      }
      setScanned(parsed);
      setPane('confirm');
    } catch {
      setError('Could not read that QR code.');
    }
  }, []);

  const confirmAddMember = useCallback(async () => {
    if (!scanTargetGroupId || !scanned) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/family/groups/${scanTargetGroupId}/members`, {
        patient_id: scanned.patient_id,
        relationship,
        access_level: accessLevel,
      });
      setPane('list');
      setScanned(null);
      setScanTargetGroupId(null);
      await loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add family member');
    } finally {
      setBusy(false);
    }
  }, [scanTargetGroupId, scanned, relationship, accessLevel, loadGroups]);

  const createGroup = useCallback(async () => {
    if (!user || !newGroupName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/api/family/groups', {
        group_name: newGroupName.trim(),
        primary_contact_id: user.walletAddress,
      });
      setNewGroupName('');
      setPane('list');
      await loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create family group');
    } finally {
      setBusy(false);
    }
  }, [user, newGroupName, loadGroups]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0f766e" />
      </View>
    );
  }

  if (pane === 'myQr') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Your Medical ID QR</Text>
        <Text style={styles.subtitle}>Let a family member scan this to add you to their group.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {myQr ? (
          <Image
            style={styles.qrImage}
            source={{ uri: `data:image/png;base64,${myQr.qr_image_base64}` }}
          />
        ) : (
          <ActivityIndicator size="large" color="#0f766e" />
        )}
        <TouchableOpacity style={styles.secondary} onPress={() => setPane('list')}>
          <Text style={styles.secondaryText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (pane === 'scan') {
    if (hasCameraPermission === false) {
      return (
        <View style={styles.center}>
          <Text style={styles.error}>Camera permission was denied. Enable it in Settings to scan QR codes.</Text>
          <TouchableOpacity style={styles.secondary} onPress={() => setPane('list')}>
            <Text style={styles.secondaryText}>Back</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.flex}>
        <BarCodeScanner
          onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.scanOverlay}>
          <Text style={styles.scanHint}>Point the camera at the other patient's Medical ID QR code</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity style={styles.secondary} onPress={() => setPane('list')}>
            <Text style={styles.secondaryTextLight}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (pane === 'confirm' && scanned) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.confirmContent}>
        <Text style={styles.title}>Add family member</Text>
        <Text style={styles.subtitle}>Patient ID: {scanned.patient_id}</Text>

        <Text style={styles.label}>Relationship</Text>
        <View style={styles.chipRow}>
          {RELATIONSHIPS.map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.chip, relationship === r && styles.chipActive]}
              onPress={() => setRelationship(r)}
            >
              <Text style={[styles.chipText, relationship === r && styles.chipTextActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Access level</Text>
        <View style={styles.chipRow}>
          {ACCESS_LEVELS.map(a => (
            <TouchableOpacity
              key={a}
              style={[styles.chip, accessLevel === a && styles.chipActive]}
              onPress={() => setAccessLevel(a)}
            >
              <Text style={[styles.chipText, accessLevel === a && styles.chipTextActive]}>{a}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.primary} onPress={confirmAddMember} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Add to family group</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={() => setPane('list')}>
          <Text style={styles.secondaryText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (pane === 'createGroup') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Create a family group</Text>
        <TextInput
          style={styles.input}
          placeholder="Group name (e.g. The Kgoatlha Family)"
          value={newGroupName}
          onChangeText={setNewGroupName}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.primary} onPress={createGroup} disabled={busy || !newGroupName.trim()}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Create</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={() => setPane('list')}>
          <Text style={styles.secondaryText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity style={styles.qrCard} onPress={openMyQr}>
        <Text style={styles.qrCardTitle}>My Medical ID QR</Text>
        <Text style={styles.qrCardSubtitle}>Show this so a family member can add you to their group</Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {groups.map(group => (
        <View key={group.family_id} style={styles.card}>
          <Text style={styles.cardTitle}>{group.family_name}</Text>
          {group.members.map(m => (
            <Text key={m.patient_id} style={styles.memberRow}>
              • {m.patient_id === user?.walletAddress ? 'You' : m.patient_id} ({m.relationship})
            </Text>
          ))}
          {group.primary_account_id === user?.walletAddress ? (
            <TouchableOpacity style={styles.secondary} onPress={() => openScanner(group.family_id)}>
              <Text style={styles.secondaryText}>Scan to add family member</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}

      {groups.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.muted}>You don't have a family group yet.</Text>
        </View>
      ) : null}

      <TouchableOpacity style={styles.secondary} onPress={() => setPane('createGroup')}>
        <Text style={styles.secondaryText}>+ Create family group</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#f8fafc' },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 6, marginBottom: 16, textAlign: 'center' },
  qrCard: { backgroundColor: '#0f766e', margin: 12, padding: 20, borderRadius: 12 },
  qrCardTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  qrCardSubtitle: { color: '#ccfbf1', fontSize: 13, marginTop: 4 },
  qrImage: { width: 260, height: 260, marginVertical: 16 },
  card: { backgroundColor: '#fff', margin: 12, marginTop: 0, padding: 16, borderRadius: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  memberRow: { fontSize: 14, color: '#334155', marginBottom: 4 },
  muted: { textAlign: 'center', color: '#94a3b8' },
  error: { color: '#dc2626', marginHorizontal: 12, marginBottom: 8, textAlign: 'center' },
  primary: { backgroundColor: '#0f766e', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondary: { padding: 14, alignItems: 'center' },
  secondaryText: { color: '#0f766e', fontWeight: '600' },
  secondaryTextLight: { color: '#fff', fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: 12,
    width: '100%',
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  label: { fontSize: 13, fontWeight: '700', color: '#334155', marginTop: 16, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  chipActive: { backgroundColor: '#0f766e', borderColor: '#0f766e' },
  chipText: { color: '#334155', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  confirmContent: { padding: 12 },
  scanOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    padding: 20,
    alignItems: 'center',
  },
  scanHint: { color: '#fff', fontSize: 14, textAlign: 'center', marginBottom: 8 },
});
