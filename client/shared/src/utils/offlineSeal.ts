/**
 * Encryption at rest for work queued on a device without signal.
 *
 * An ambulance tablet can be lost with a patient's vitals and medicines queued
 * on it. Each queued body is sealed with AES-GCM under a key that belongs to the
 * signed-in account and is created **non-extractable**: script can use it to
 * seal and open, but the raw key never exists in readable form, so copying the
 * IndexedDB files off a device yields ciphertext. Deleting the account's key
 * (`forgetSealKey`) makes everything sealed under it unreadable at once — the
 * discard path when someone signs out and chooses not to send.
 *
 * What this does not do: protect against someone using the same unlocked
 * browser profile, which can use the key exactly as the app does. That is the
 * device lock's job, and why queued items also expire.
 */

const KEY_DB = 'MediChainOfflineKeys';
const KEY_STORE = 'keys';

export interface SealedBody {
  sealed: 1;
  iv: string;
  data: string;
}

function isSealed(value: unknown): value is SealedBody {
  return typeof value === 'object' && value !== null && (value as SealedBody).sealed === 1
    && typeof (value as SealedBody).iv === 'string' && typeof (value as SealedBody).data === 'string';
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(KEY_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function keyStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openKeyDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, mode);
    const request = run(tx.objectStore(KEY_STORE));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

async function keyFor(owner: string): Promise<CryptoKey> {
  const existing = await keyStore<CryptoKey | undefined>('readonly', (s) => s.get(owner));
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await keyStore('readwrite', (s) => s.put(key, owner));
  return key;
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  bytes.forEach((b) => { text += String.fromCharCode(b); });
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/** True where the browser can seal (secure context with Web Crypto and IndexedDB). */
export function canSeal(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof indexedDB !== 'undefined';
}

/** Seal `body` for `owner`. */
export async function sealBody(body: unknown, owner: string): Promise<SealedBody> {
  const key = await keyFor(owner);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(body ?? null));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { sealed: 1, iv: toBase64(iv), data: toBase64(cipher) };
}

/** Open a stored body; an unsealed value (queued before sealing existed) passes through. */
export async function openBody(stored: unknown, owner: string): Promise<unknown> {
  if (!isSealed(stored)) return stored;
  const key = await keyFor(owner);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(stored.iv) as BufferSource },
    key,
    fromBase64(stored.data) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Destroy `owner`'s key: everything sealed under it becomes unreadable. */
export async function forgetSealKey(owner: string): Promise<void> {
  await keyStore('readwrite', (s) => s.delete(owner));
}
