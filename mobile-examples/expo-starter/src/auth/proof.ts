/**
 * Password proof for sign-in (mobile).
 *
 * The same derivation the web clients use, byte for byte, so an account made on
 * the web signs in here and the reverse: PBKDF2-HMAC-SHA512 (210,000 rounds,
 * salt `medichain-staff-credential-v1:<login id trimmed and lower-cased>`) into
 * a master, then HKDF-SHA256 with the same salt and info `medichain-auth-v1`,
 * 32 bytes, as 64 lower-case hex characters. The server stores Argon2id over
 * this proof; the password itself never leaves the device.
 *
 * `@noble/hashes` is used because Hermes has no WebCrypto. It is pure
 * JavaScript, so expect the derivation to take a few seconds on a low-end
 * phone; do not lower the round count to hide that, it would lock the account
 * out of every other client.
 *
 * © 2025-2026 Lukau Invasion (Pty) Ltd. MediChain Health ID System.
 */

import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { hkdf } from '@noble/hashes/hkdf';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes, bytesToHex } from '@noble/hashes/utils';

const PBKDF2_ITERATIONS = 210_000;
const AUTH_INFO = 'medichain-auth-v1';
const APP_SALT = 'medichain-staff-credential-v1';

/** The proof of `password` for `loginId`, as 64 lower-case hex characters. */
export function deriveAuthProof(password: string, loginId: string): string {
  const master = pbkdf2(sha512, utf8ToBytes(password), utf8ToBytes(`${APP_SALT}:${loginId.trim().toLowerCase()}`), {
    c: PBKDF2_ITERATIONS,
    dkLen: 64,
  });
  const proof = hkdf(sha256, master, utf8ToBytes(APP_SALT), utf8ToBytes(AUTH_INFO), 32);
  return bytesToHex(proof);
}
