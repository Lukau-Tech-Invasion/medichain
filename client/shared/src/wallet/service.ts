/**
 * MediChain Wallet Service
 *
 * The browser-extension half of wallet sign-in: list the accounts a Polkadot
 * extension exposes, and have it sign a challenge. The server issues no JWT
 * without a verified sr25519 signature, so this module holds no keys and
 * stores nothing.
 *
 * The simulated wallets that used to live here -- random addresses, a
 * localStorage account list, a SHA-256 "Blake2" and a derived "Health ID" --
 * were removed on 2026-09-24. Their last caller was a patient-app demo sign-in
 * that fabricated a patient record in the browser.
 *
 * © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
 */

import type { SubstrateAddress, WalletAccount } from './types';
// NOTE: `@polkadot/extension-dapp` + `@polkadot/util` are large and only needed
// for real wallet connect/sign. They are imported dynamically inside the two
// functions that use them so they stay out of the initial bundle.

/** Hex-encode bytes, two lowercase digits each. */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Connect wallet using real Polkadot extension
 */
export async function connectRealWallet(): Promise<WalletAccount[]> {
  const { web3Accounts, web3Enable } = await import('@polkadot/extension-dapp');
  const extensions = await web3Enable('MediChain');
  if (extensions.length === 0) {
    throw new Error('No Polkadot extension found. Please install Polkadot.js or Talisman.');
  }

  // `publicKey` was `bytesToHex(new Uint8Array(32))` — 32 zero bytes, i.e. the
  // same all-zero key returned for EVERY connected wallet. Anything downstream
  // that treated it as a real key would have compared signatures against zeros,
  // or seen two different wallets as identical. The real key is recoverable:
  // an SS58 address IS the public key plus a network prefix and checksum, so
  // decode it rather than invent one.
  const { decodeAddress } = await import('@polkadot/util-crypto');
  const allAccounts = await web3Accounts();
  return allAccounts.map(account => ({
    address: account.address,
    name: account.meta.name,
    role: 'Patient', // Default role, should be fetched from chain
    publicKey: bytesToHex(decodeAddress(account.address)),
    verified: false,
  }));
}

/**
 * Sign a message using the connected wallet
 */
export async function signMessage(address: SubstrateAddress, message: string): Promise<string> {
  const { web3Accounts, web3Enable, web3FromSource } = await import('@polkadot/extension-dapp');
  const { stringToHex } = await import('@polkadot/util');

  // `web3Enable` is a REQUIRED handshake, once per page load, before any other
  // extension call. Without it `web3Accounts()` throws
  //   "web3Accounts: web3Enable(originName) needs to be called before web3Accounts"
  // and this function only called `web3Accounts`.
  //
  // That made patient sign-in impossible even WITH an extension installed,
  // because nothing on the sign-in path calls `connectRealWallet()` first —
  // `login(address)` goes straight here. Both the wallet-address form and every
  // quick-login button failed, and the patient was shown that library string as
  // the explanation.
  //
  // It is safe to call repeatedly: the extension remembers the authorisation,
  // so a session that has already connected is not prompted again.
  const extensions = await web3Enable('MediChain');
  if (extensions.length === 0) {
    throw new Error('No Polkadot extension found. Please install Polkadot.js or Talisman.');
  }

  const account = (await web3Accounts()).find(a => a.address === address);
  if (!account) {
    throw new Error(
      'That wallet is not in your extension. Open it, check the account is imported and visible to this site, then try again.'
    );
  }

  const injector = await web3FromSource(account.meta.source);
  const signRaw = injector.signer.signRaw;

  if (!signRaw) throw new Error('Signer does not support raw signing');

  const { signature } = await signRaw({
    address,
    data: stringToHex(message),
    type: 'bytes'
  });

  return signature;
}

/**
 * Shorten address for display: 5Grw...utQY
 */
export function shortenAddress(address: SubstrateAddress): string {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
