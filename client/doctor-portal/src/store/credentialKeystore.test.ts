import { describe, it, expect } from 'vitest';
import {
  deriveCredential,
  createKeystore,
  openKeystore,
  signerFromSecret,
  KEYSTORE_VERSION,
} from '@medichain/shared';

/**
 * The credential keystore is the only thing standing between a clinician's
 * password and their signing key, so its round-trip is worth asserting
 * directly rather than through a page.
 *
 * The case that matters most is the one v1 could not express. A v1 envelope
 * held a 32-byte mini-secret and the login rebuilt the account with
 * `sr25519PairFromSeed`. That only reproduces accounts derived *straight from a
 * seed*. An account created through a derivation path — `//Alice`, or the
 * `//hospital//dr-mbeki` shape a Polkadot extension produces — has no
 * mini-secret that yields it, so enrolling one appeared to succeed and then
 * unlocked a **different account**. The address check in `loginWithCredentials`
 * turned that into "your stored key does not match this account", with nothing
 * explaining why.
 */
describe('credential keystore', () => {
  const PASSWORD = 'KeystoreRoundTrip!1';
  const IDENTIFIER = 'dr.roundtrip';

  /** The canonical Substrate development phrase. */
  const DEV_PHRASE = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';

  async function crypto() {
    return import('@polkadot/util-crypto');
  }

  it('round-trips a seed-derived account, as v1 always did', async () => {
    const { cryptoWaitReady, mnemonicGenerate, mnemonicToMiniSecret, sr25519PairFromSeed, encodeAddress } =
      await crypto();
    await cryptoWaitReady();

    const seed = mnemonicToMiniSecret(mnemonicGenerate(12));
    const address = encodeAddress(sr25519PairFromSeed(seed).publicKey, 42);

    const { keystoreKey } = await deriveCredential(PASSWORD, IDENTIFIER);
    const opened = await openKeystore(await createKeystore(seed, address, keystoreKey), keystoreKey);
    const signer = await signerFromSecret(opened.miniSecret, opened.address);

    expect(signer.address).toBe(address);
  });

  it('round-trips an account that came from a derivation path', async () => {
    const {
      cryptoWaitReady, mnemonicToMiniSecret, sr25519PairFromSeed,
      encodeAddress, keyExtractPath, keyFromPath,
    } = await crypto();
    await cryptoWaitReady();

    const { path } = keyExtractPath('//Alice');
    const pair = keyFromPath(sr25519PairFromSeed(mnemonicToMiniSecret(DEV_PHRASE)), path, 'sr25519');
    const address = encodeAddress(pair.publicKey, 42);

    const { keystoreKey } = await deriveCredential(PASSWORD, IDENTIFIER);
    // The full 64-byte secret key, which is the only representation that can
    // carry this account.
    const opened = await openKeystore(
      await createKeystore(pair.secretKey, address, keystoreKey),
      keystoreKey
    );
    const signer = await signerFromSecret(opened.miniSecret, opened.address);

    // The property under test: whatever account the path produces, the
    // keystore must hand back *that* account. Under v1 this returned a
    // different address entirely, because a 64-byte secret key expanded
    // through `sr25519PairFromSeed` is a different keypair.
    expect(signer.address).toBe(address);

    // Deliberately not asserted against the canonical
    // `5Grwva…KutQY` literal. jsdom resolves `@polkadot/util-crypto` to its
    // non-WASM backend, whose hard derivation yields a different — internally
    // consistent — keypair, so a hardcoded address fails here while being
    // correct everywhere the product actually runs. The canonical value is
    // pinned instead where the WASM backend is real: `dev_account_addresses`
    // in `api/src/startup.rs`, asserted by its Rust test.
  });

  it('still opens a v1 envelope, which carries no `kind`', async () => {
    const { cryptoWaitReady, mnemonicGenerate, mnemonicToMiniSecret, sr25519PairFromSeed, encodeAddress } =
      await crypto();
    await cryptoWaitReady();

    const seed = mnemonicToMiniSecret(mnemonicGenerate(12));
    const address = encodeAddress(sr25519PairFromSeed(seed).publicKey, 42);
    const { keystoreKey } = await deriveCredential(PASSWORD, IDENTIFIER);

    // Downgrade a fresh envelope to exactly what v1 wrote: version 1, no
    // `kind`. An existing clinician must not be locked out by a format bump.
    const v2 = JSON.parse(await createKeystore(seed, address, keystoreKey));
    delete v2.kind;
    v2.v = 1;

    const opened = await openKeystore(JSON.stringify(v2), keystoreKey);
    const signer = await signerFromSecret(opened.miniSecret, opened.address);
    expect(signer.address).toBe(address);
  });

  it('refuses a keystore format it does not understand', async () => {
    const { keystoreKey } = await deriveCredential(PASSWORD, IDENTIFIER);
    const future = JSON.stringify({
      v: KEYSTORE_VERSION + 99,
      iv: 'AAAAAAAAAAAAAAAA',
      ct: 'AAAA',
      address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    });
    await expect(openKeystore(future, keystoreKey)).rejects.toThrow(/cannot open/i);
  });

  it('refuses a secret that is neither a mini-secret nor a secret key', async () => {
    const { keystoreKey } = await deriveCredential(PASSWORD, IDENTIFIER);
    await expect(
      createKeystore(new Uint8Array(48), '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', keystoreKey)
    ).rejects.toThrow(/32-byte mini-secret or a 64-byte secret key/);
  });

  it('will not build a signer for a secret key without its address', async () => {
    // Without the address there is no public half, and guessing one would sign
    // as an account nobody intended.
    await expect(signerFromSecret(new Uint8Array(64))).rejects.toThrow(/needs its address/i);
  });

  it('rejects the wrong password rather than returning a wrong key', async () => {
    const { cryptoWaitReady, mnemonicGenerate, mnemonicToMiniSecret, sr25519PairFromSeed, encodeAddress } =
      await crypto();
    await cryptoWaitReady();

    const seed = mnemonicToMiniSecret(mnemonicGenerate(12));
    const address = encodeAddress(sr25519PairFromSeed(seed).publicKey, 42);
    const right = await deriveCredential(PASSWORD, IDENTIFIER);
    const wrong = await deriveCredential('NotThePassword!1', IDENTIFIER);

    const envelope = await createKeystore(seed, address, right.keystoreKey);
    // AES-GCM's tag makes this a cryptographic failure, not a silently wrong key.
    await expect(openKeystore(envelope, wrong.keystoreKey)).rejects.toThrow(/incorrect password/i);
  });
});
