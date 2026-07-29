/**
 * NFC card self-verification screen (Phase 8.3).
 *
 * Patient-only: tap your OWN physical MediChain NFC card against the phone
 * to confirm it's genuinely registered to your account and still active.
 * This is deliberately NOT the provider-only emergency-read flow (the web
 * `NFCTapSimulator` / backend `nfc_tap`) — this app has no provider role,
 * same scope split already made for QR scanning in `FamilyScreen.tsx`.
 *
 * Reads the card_hash off the tag's NDEF text record and posts it to
 * `POST /api/nfc/verify-mine`, which checks the card exists AND belongs to
 * the calling account before returning a status — so a cloned or someone
 * else's card is rejected, not just "any card that scans."
 *
 * Native module: Expo Go does NOT support `react-native-nfc-manager` (it's
 * a custom native module) — this screen only works in a custom dev-client
 * build (`expo prebuild` + a local Android/iOS build, or EAS Build). That
 * build step, and a physical NFC-capable device to tap, are both outside
 * what this environment can produce; this screen is the real, typed,
 * `tsc --noEmit`-verified implementation ready for whoever has both.
 *
 * © 2025-2026 Lukau Invasion (Pty) Ltd. MediChain Health ID System.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager';
import { apiClient } from '../api/client';

interface VerifyMyCardResponse {
  success: boolean;
  status: string | null;
  last_used_at: number | null;
  message: string;
}

type ScanState = 'idle' | 'unsupported' | 'scanning' | 'result';

export function NfcCardScreen() {
  const [state, setState] = useState<ScanState>('idle');
  const [result, setResult] = useState<VerifyMyCardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    NfcManager.isSupported()
      .then((supported) => {
        if (mounted && !supported) setState('unsupported');
      })
      .catch(() => {
        if (mounted) setState('unsupported');
      });
    NfcManager.start();
    return () => {
      mounted = false;
      NfcManager.cancelTechnologyRequest().catch(() => {});
    };
  }, []);

  const readCardHash = useCallback(async (): Promise<string> => {
    await NfcManager.requestTechnology(NfcTech.Ndef);
    const tag = await NfcManager.getTag();
    const record = tag?.ndefMessage?.[0];
    if (!record) {
      throw new Error('This tag has no readable data. Is it a MediChain card?');
    }
    // MediChain cards are provisioned with a single NDEF text record whose
    // payload is the card_hash (see api/src/nfc_simulator.rs `card_hash`).
    const text = Ndef.text.decodePayload(new Uint8Array(record.payload));
    if (!text) {
      throw new Error("Couldn't read this card's data.");
    }
    return text.trim();
  }, []);

  const scan = useCallback(async () => {
    setError(null);
    setResult(null);
    setState('scanning');
    try {
      const cardHash = await readCardHash();
      const resp = await apiClient.post<VerifyMyCardResponse>('/api/nfc/verify-mine', {
        card_hash: cardHash,
      });
      setResult(resp);
      setState('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read the NFC card.');
      setState('result');
    } finally {
      NfcManager.cancelTechnologyRequest().catch(() => {});
    }
  }, [readCardHash]);

  if (state === 'unsupported') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>NFC not available</Text>
        <Text style={styles.subtitle}>
          This device (or this build) doesn't support NFC card scanning.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <Text style={styles.title}>Verify my MediChain card</Text>
      <Text style={styles.subtitle}>
        Hold your physical MediChain NFC card against the back of your phone.
      </Text>

      {state === 'scanning' ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#0f766e" />
          <Text style={styles.hint}>Hold the card steady...</Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.primary} onPress={scan}>
          <Text style={styles.primaryText}>Tap to scan</Text>
        </TouchableOpacity>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {result ? (
        <View style={[styles.resultCard, result.success ? styles.resultOk : styles.resultBad]}>
          <Text style={styles.resultMessage}>{result.message}</Text>
          {result.status ? <Text style={styles.resultDetail}>Status: {result.status}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#f8fafc' },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 6, marginBottom: 24, textAlign: 'center' },
  hint: { fontSize: 13, color: '#64748b', marginTop: 12 },
  primary: { backgroundColor: '#0f766e', borderRadius: 10, paddingHorizontal: 32, paddingVertical: 16 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  error: { color: '#dc2626', marginTop: 16, textAlign: 'center' },
  resultCard: { marginTop: 20, padding: 16, borderRadius: 12, width: '100%' },
  resultOk: { backgroundColor: '#d1fae5' },
  resultBad: { backgroundColor: '#fee2e2' },
  resultMessage: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  resultDetail: { fontSize: 13, color: '#334155', marginTop: 4 },
});
