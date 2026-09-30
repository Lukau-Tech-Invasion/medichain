/**
 * Password proof for sign-in.
 *
 * The password never leaves the browser as itself. It is stretched with PBKDF2
 * (210,000 rounds, SHA-512) into a master, and the proof sent to the server is
 * the HKDF-SHA256 "auth" branch of that master, as 64 hex characters. The server
 * stores Argon2id over the proof, so a stolen database yields a verifier and not
 * a password.
 *
 * COMPATIBILITY: this derivation is byte-for-byte the one every existing staff
 * verifier was created from (salt `medichain-staff-credential-v1:<login id,
 * lowercased and trimmed>`, HKDF info `medichain-auth-v1`). Changing any
 * constant here locks every enrolled account out. `proof.test.ts` pins known
 * vectors; if it fails, revert the change, do not update the vectors.
 */

/** Bump only with a coordinated server-side verifier migration. */
const PBKDF2_ITERATIONS = 210_000;
const AUTH_INFO = 'medichain-auth-v1';
/** Domain separator so these derivations can never collide with another app's. */
const APP_SALT = 'medichain-staff-credential-v1';

const encoder = new TextEncoder();

/**
 * Copy into a Uint8Array that is definitely backed by a plain ArrayBuffer.
 * Returns `BufferSource` because the workspaces compiling this file are on
 * different TypeScript libs and only the newer one has a generic `Uint8Array`.
 */
function bytes(input: Uint8Array): BufferSource {
  const out = new Uint8Array(input.length);
  out.set(input);
  return out;
}

function utf8(text: string): BufferSource {
  return bytes(encoder.encode(text));
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto?.subtle;
  if (!c) {
    throw new Error('Signing in needs a secure context (HTTPS or localhost).');
  }
  return c;
}

/** Lower-case hex, no prefix. */
export function bytesToHex(input: Uint8Array): string {
  let out = '';
  input.forEach((b) => {
    out += b.toString(16).padStart(2, '0');
  });
  return out;
}

/** PBKDF2 master, bound to the login id so two people never share a master. */
async function deriveMaster(password: string, loginId: string): Promise<CryptoKey> {
  const s = subtle();
  const base = await s.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await s.deriveBits(
    {
      name: 'PBKDF2',
      salt: utf8(`${APP_SALT}:${loginId.trim().toLowerCase()}`),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-512',
    },
    base,
    512
  );
  return s.importKey('raw', bits, 'HKDF', false, ['deriveBits']);
}

/**
 * The proof of a password for a login id (Employee ID for staff, username for
 * patients). 64 lower-case hex characters; safe to send.
 */
export async function deriveAuthProof(password: string, loginId: string): Promise<string> {
  const master = await deriveMaster(password, loginId);
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8(APP_SALT), info: utf8(AUTH_INFO) },
    master,
    32 * 8
  );
  return bytesToHex(new Uint8Array(bits));
}
