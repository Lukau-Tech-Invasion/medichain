/**
 * Credential-backed access to a clinician's sr25519 key.
 *
 * # The problem this solves
 *
 * MediChain authorizes every mutating request with an sr25519 signature. Until
 * now the only way to produce one was the Polkadot browser extension, so the
 * realistic alternatives for a clinician were "install a crypto wallet" or
 * "type a 48-character address into a box that cannot sign anything and then
 * watch every request fail". Neither is a login.
 *
 * # The design
 *
 * The password never authenticates on its own and never leaves as itself.
 * Everything derives from one PBKDF2 master, split down two domain-separated
 * HKDF paths:
 *
 *   password ──PBKDF2──▶ master ──HKDF "auth"─────▶ authProof   → sent to server
 *                               └─HKDF "keystore"─▶ keystoreKey → never sent
 *
 * The server stores Argon2id(authProof) and the keystore ciphertext. Because
 * HKDF is one-way, authProof cannot yield master and therefore cannot yield
 * keystoreKey: a stolen database gives an attacker a verifier and an opaque
 * blob, not the ability to sign as a clinician.
 *
 * After login the browser holds the real secret key and signs the ordinary
 * `/api/auth/challenge`, so the server-side trust model is untouched — this
 * changes how the key is *reached*, not what counts as authority.
 *
 * # The trade this makes
 *
 * A forgotten password is a lost key. There is deliberately no reset: a server
 * able to reset it would be a server able to sign as any clinician. Recovery
 * is re-enrolment by an administrator against a newly provisioned keypair,
 * which also needs the on-chain role reassigned.
 *
 * # Format
 *
 * The envelope is this project's own (versioned, below) — not Polkadot's
 * backup JSON. It uses only WebCrypto and `@polkadot/util-crypto`, both already
 * present, rather than adding a keyring dependency. Consequence worth knowing:
 * a keystore made here is not importable into the Polkadot extension.
 */

import { u8aToHex, hexToU8a, stringToU8a } from '@polkadot/util';

/** Bump when the envelope or derivation changes; `openKeystore` refuses others. */
export const KEYSTORE_VERSION = 2;
/** Versions `openKeystore` still accepts. v1 held a mini-secret only. */
const SUPPORTED_KEYSTORE_VERSIONS = [1, 2];

/**
 * PBKDF2 cost. OWASP's 2023 floor for PBKDF2-HMAC-SHA512 is 210,000; this runs
 * once per sign-in, so the latency is acceptable and the figure is deliberately
 * not tuned down for snappiness.
 */
const PBKDF2_ITERATIONS = 210_000;

const AUTH_INFO = 'medichain-auth-v1';
const KEYSTORE_INFO = 'medichain-keystore-v1';
/** Domain separator so these derivations can never collide with another app's. */
const APP_SALT = 'medichain-staff-credential-v1';

export interface EncryptedKeystore {
  v: number;
  /** Base64 AES-GCM nonce. */
  iv: string;
  /**
   * Base64 ciphertext of the account secret: a 32-byte mini-secret (`kind:
   * 'seed'`) or a 64-byte sr25519 secret key (`kind: 'secretKey'`).
   */
  ct: string;
  /**
   * Which secret `ct` holds. Absent means `'seed'`, so v1 keystores written
   * before this field existed still open.
   *
   * v1 could only store a mini-secret, which meant only accounts derived
   * *directly* from a seed could be enrolled. A wallet using a derivation path
   * — `//Alice`, or the `//hospital//dr-mbeki` style a Polkadot extension
   * produces — has no mini-secret that reproduces it, so those clinicians could
   * not use credential sign-in at all. There was no error explaining that;
   * enrolment appeared to succeed and the account it unlocked was simply a
   * different one.
   */
  kind?: 'seed' | 'secretKey';
  /** The address this keystore unlocks, so a wrong-account mix-up is caught. */
  address: string;
}

export interface WalletSigner {
  address: string;
  /** Signs the raw UTF-8 bytes of `message`, matching the API's verifier. */
  sign(message: string): Promise<string>;
}

/**
 * Copy into a Uint8Array that is definitely backed by a plain ArrayBuffer.
 *
 * WebCrypto's `BufferSource` excludes `SharedArrayBuffer`, while
 * `@polkadot/util` returns the looser `Uint8Array<ArrayBufferLike>`. Rather
 * than casting the difference away, copy — these are 32-byte values used once
 * per sign-in, so the allocation is irrelevant and the types stay honest.
 *
 * Returns `BufferSource` rather than `Uint8Array<ArrayBuffer>` because the two
 * workspaces that compile this file are on different TypeScript libs, and only
 * the newer one has a generic `Uint8Array`. `BufferSource` is correct in both.
 */
function bytes(input: Uint8Array): BufferSource {
  const out = new Uint8Array(input.length);
  out.set(input);
  return out;
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto?.subtle;
  if (!c) {
    // Secure-context only. Surfacing this plainly beats a confusing failure
    // deeper in the login flow.
    throw new Error(
      'Secure credential storage needs a secure context (HTTPS or localhost).'
    );
  }
  return c;
}

/** PBKDF2 master, bound to the identifier so two staff never share a master. */
async function deriveMaster(password: string, identifier: string): Promise<CryptoKey> {
  const s = subtle();
  const base = await s.importKey('raw', bytes(stringToU8a(password)), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await s.deriveBits(
    {
      name: 'PBKDF2',
      salt: bytes(stringToU8a(`${APP_SALT}:${identifier.trim().toLowerCase()}`)),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-512',
    },
    base,
    512
  );
  return s.importKey('raw', bits, 'HKDF', false, ['deriveBits']);
}

async function branch(master: CryptoKey, info: string, len: number): Promise<Uint8Array> {
  const bits = await subtle().deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: bytes(stringToU8a(APP_SALT)),
      info: bytes(stringToU8a(info)),
    },
    master,
    len * 8
  );
  return new Uint8Array(bits);
}

/**
 * Everything derived from one password entry.
 *
 * Derived together because PBKDF2 at 210k iterations is the expensive step and
 * running it twice per login would double the wait for no benefit.
 */
export interface DerivedCredential {
  /** Hex. Safe to send: the server stores only Argon2id over this. */
  authProof: string;
  /** Raw AES-256 key material for the keystore. Must never be transmitted. */
  keystoreKey: Uint8Array;
}

export async function deriveCredential(
  password: string,
  identifier: string
): Promise<DerivedCredential> {
  const master = await deriveMaster(password, identifier);
  const [auth, keystore] = await Promise.all([
    branch(master, AUTH_INFO, 32),
    branch(master, KEYSTORE_INFO, 32),
  ]);
  return { authProof: u8aToHex(auth, undefined, false), keystoreKey: keystore };
}

function b64(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

function unb64(text: string): Uint8Array {
  const raw = atob(text);
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

async function aesKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return subtle().importKey('raw', bytes(raw), { name: 'AES-GCM' }, false, usage);
}

/** Seal an sr25519 account secret under the keystore key. */
export async function createKeystore(
  secret: Uint8Array,
  address: string,
  keystoreKey: Uint8Array
): Promise<string> {
  // 32 bytes is a mini-secret (an account derived straight from a seed);
  // 64 bytes is a full sr25519 secret key, which is the only way to carry an
  // account that came from a derivation path.
  const kind: 'seed' | 'secretKey' =
    secret.length === 32 ? 'seed' : secret.length === 64 ? 'secretKey' : (() => {
      throw new Error('A sr25519 secret must be a 32-byte mini-secret or a 64-byte secret key');
    })();

  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(keystoreKey, ['encrypt']),
    bytes(secret)
  );
  const envelope: EncryptedKeystore = {
    v: KEYSTORE_VERSION,
    iv: b64(iv),
    ct: b64(new Uint8Array(ct)),
    kind,
    address,
  };
  return JSON.stringify(envelope);
}

/**
 * Open a keystore. Throws on a wrong password — AES-GCM's tag makes that a
 * cryptographic failure rather than a silently wrong key.
 */
export async function openKeystore(
  json: string,
  keystoreKey: Uint8Array
): Promise<{ miniSecret: Uint8Array; address: string }> {
  let envelope: EncryptedKeystore;
  try {
    envelope = JSON.parse(json) as EncryptedKeystore;
  } catch {
    throw new Error('Stored credentials are unreadable. Ask an administrator to re-enrol you.');
  }
  // v1 keystores stay openable. They hold a mini-secret and carry no `kind`,
  // which is exactly what the default below assumes — an existing clinician
  // must not be locked out by a format bump.
  if (!SUPPORTED_KEYSTORE_VERSIONS.includes(envelope.v)) {
    throw new Error(
      `Stored credentials use format v${envelope.v}, which this version cannot open.`
    );
  }
  try {
    const pt = await subtle().decrypt(
      { name: 'AES-GCM', iv: bytes(unb64(envelope.iv)) },
      await aesKey(keystoreKey, ['decrypt']),
      bytes(unb64(envelope.ct))
    );
    // The name stays `miniSecret` for callers, but a v2 `secretKey` envelope
    // returns 64 bytes; `signerFromSecret` distinguishes them by length.
    return { miniSecret: new Uint8Array(pt), address: envelope.address };
  } catch {
    throw new Error('Incorrect password.');
  }
}

/**
 * Build a signer from a mini-secret.
 *
 * Signs the raw UTF-8 bytes of the message, which is what
 * `verify_wallet_signature_bound` checks. Note this differs from the extension
 * path, which signs an `<Bytes>`-wrapped payload.
 */
export async function signerFromSecret(
  secret: Uint8Array,
  /**
   * Required for a 64-byte secret key. sr25519 signing needs both halves of the
   * keypair, and a secret key alone does not yield its public half — but the
   * keystore already records the address, which decodes straight back to it.
   */
  address?: string
): Promise<WalletSigner> {
  const {
    cryptoWaitReady, sr25519PairFromSeed, sr25519Sign, encodeAddress, decodeAddress,
  } = await import('@polkadot/util-crypto');
  await cryptoWaitReady();

  // 32 bytes is a seed to expand. 64 bytes is already the secret key of an
  // account that came from a derivation path; expanding *that* through
  // `sr25519PairFromSeed` yields a different account entirely, which is the bug
  // this branch exists to prevent.
  let pair: { publicKey: Uint8Array; secretKey: Uint8Array };
  if (secret.length === 32) {
    pair = sr25519PairFromSeed(secret);
  } else if (secret.length === 64) {
    if (!address) {
      throw new Error('A 64-byte sr25519 secret key needs its address to recover the public key');
    }
    pair = { publicKey: decodeAddress(address), secretKey: secret };
  } else {
    throw new Error('A sr25519 secret must be a 32-byte mini-secret or a 64-byte secret key');
  }

  return {
    address: encodeAddress(pair.publicKey, 42),
    async sign(message: string): Promise<string> {
      return u8aToHex(sr25519Sign(stringToU8a(message), pair));
    },
  };
}

/**
 * Generate a fresh sr25519 identity for enrolment.
 *
 * Returns the mnemonic so it can be shown once as a recovery phrase — the only
 * way back in if the password is lost, given there is no server-side reset.
 */
export async function generateWalletIdentity(): Promise<{
  mnemonic: string;
  miniSecret: Uint8Array;
  address: string;
}> {
  const { cryptoWaitReady, mnemonicGenerate, mnemonicToMiniSecret, sr25519PairFromSeed, encodeAddress } =
    await import('@polkadot/util-crypto');
  await cryptoWaitReady();
  const mnemonic = mnemonicGenerate(12);
  const miniSecret = mnemonicToMiniSecret(mnemonic);
  const pair = sr25519PairFromSeed(miniSecret);
  return { mnemonic, miniSecret, address: encodeAddress(pair.publicKey, 42) };
}

/** Recover the mini-secret for an existing recovery phrase, for re-enrolment. */
export async function secretFromMnemonic(mnemonic: string): Promise<Uint8Array> {
  const { cryptoWaitReady, mnemonicToMiniSecret, mnemonicValidate } = await import(
    '@polkadot/util-crypto'
  );
  await cryptoWaitReady();
  const phrase = mnemonic.trim().replace(/\s+/g, ' ');
  if (!mnemonicValidate(phrase)) {
    throw new Error('That recovery phrase is not valid.');
  }
  return mnemonicToMiniSecret(phrase);
}

/** Zero key material once it is no longer needed. */
export function wipe(...buffers: Array<Uint8Array | undefined | null>): void {
  buffers.forEach((b) => b?.fill(0));
}

export { hexToU8a };
