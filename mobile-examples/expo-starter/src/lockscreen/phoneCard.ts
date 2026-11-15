/**
 * The lock-screen medical ID on the patient's own phone.
 *
 * The capability that reads the lock-screen card lives five minutes and needs
 * the patient signed in to issue, so a phone cannot hold a live one behind a
 * locked screen. Instead, while the patient is signed in, this enrols the
 * phone once (a P-256 key pair whose private half never leaves secure
 * storage), fetches a fresh capability, reads the card with it, and keeps the
 * card on the phone. The locked app shows that saved card, with the time it
 * was saved, so a responder sees what the patient chose to show even when the
 * phone has no signal.
 *
 * Every capability request is signed with that private key over the device
 * id and the moment (`lockscreen_request_message` on the server), and the
 * server verifies it against the enrolled public key: a session alone, without
 * the phone's key, cannot obtain one.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { ec as EC } from 'elliptic';
import { sha256 } from '@noble/hashes/sha256';
import { apiClient, randomBytes } from '../api/client';

const DEVICE_KEY = 'medichain.phone.device';
const CARD_KEY = 'medichain.phone.lockscreen-card';

interface EnrolledPhone {
  deviceId: string;
  patientId: string;
  /** P-256 private key, hex. Stays in secure storage. */
  privateKey: string;
}

/** The card exactly as `GET /api/medical-id/{id}/lockscreen` returns it. */
export interface LockscreenCard {
  blood_type?: { value?: string };
  allergies_line?: { text?: string };
  dnr_line?: { text?: string } | null;
  name?: { value?: string | null };
  emergency_contact?: { name?: string; phone?: string; relationship?: string } | null;
}

export interface SavedCard {
  card: LockscreenCard;
  /** ISO time the card was read from the server. */
  savedAt: string;
}

async function enrolledPhone(): Promise<EnrolledPhone | null> {
  const raw = await SecureStore.getItemAsync(DEVICE_KEY);
  return raw ? (JSON.parse(raw) as EnrolledPhone) : null;
}

/** Register this phone on the patient's account, once. */
async function enrol(patientId: string): Promise<EnrolledPhone> {
  const existing = await enrolledPhone();
  if (existing && existing.patientId === patientId) return existing;
  const pair = new EC('p256').genKeyPair({ entropy: Array.from(randomBytes(32)) });
  const device = await apiClient.post<{ id: string }>('/api/mobile/devices/register', {
    device_label: `${Platform.OS === 'ios' ? 'iPhone' : 'Android phone'} (lock screen)`,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    public_key: pair.getPublic(false, 'hex'),
  });
  const phone = { deviceId: device.id, patientId, privateKey: pair.getPrivate('hex') };
  await SecureStore.setItemAsync(DEVICE_KEY, JSON.stringify(phone));
  return phone;
}

/** The server's `lockscreen_request_message`, signed with the phone's key. */
export function signLockscreenRequest(privateKeyHex: string, deviceId: string, timestamp: number): string {
  const message = `medichain-lockscreen-token
${deviceId}
${timestamp}`;
  const digest = sha256(new TextEncoder().encode(message));
  return new EC('p256').keyFromPrivate(privateKeyHex, 'hex').sign(digest).toDER('hex');
}

/**
 * Enrol if needed, then read and save the current lock-screen card. Call while
 * signed in; throws if the server refuses (for example, the patient has not
 * allowed the card on the lock screen).
 */
export async function refreshPhoneCard(patientId: string): Promise<SavedCard> {
  const phone = await enrol(patientId);
  const timestamp = Math.floor(Date.now() / 1000);
  const capability = await apiClient.post<{ token: string }>(
    `/api/mobile/devices/${encodeURIComponent(phone.deviceId)}/lockscreen-token`,
    { timestamp, signature: signLockscreenRequest(phone.privateKey, phone.deviceId, timestamp) }
  );
  const card = await apiClient.getWithCapability<LockscreenCard>(
    `/api/medical-id/${encodeURIComponent(patientId)}/lockscreen`,
    { Authorization: `Bearer ${capability.token}`, 'X-Device-Id': phone.deviceId }
  );
  const saved = { card, savedAt: new Date().toISOString() };
  await SecureStore.setItemAsync(CARD_KEY, JSON.stringify(saved));
  return saved;
}

/** The card saved on this phone, if any. Needs no session. */
export async function savedPhoneCard(): Promise<SavedCard | null> {
  const raw = await SecureStore.getItemAsync(CARD_KEY);
  return raw ? (JSON.parse(raw) as SavedCard) : null;
}

/** Whether this phone is enrolled for the given patient. */
export async function isPhoneEnrolled(patientId: string): Promise<boolean> {
  return (await enrolledPhone())?.patientId === patientId;
}

/**
 * Take the card off this phone: revoke the device on the account (while a
 * session exists) and delete the key and the saved card. The local copy is
 * deleted even when the revocation cannot reach the server, so a phone that is
 * signed out never keeps the card.
 */
export async function forgetPhone(reason: string): Promise<void> {
  const phone = await enrolledPhone();
  try {
    if (phone) {
      await apiClient.post(`/api/mobile/devices/${encodeURIComponent(phone.deviceId)}/revoke`, { reason });
    }
  } finally {
    await SecureStore.deleteItemAsync(DEVICE_KEY);
    await SecureStore.deleteItemAsync(CARD_KEY);
  }
}
