/**
 * The part of `elliptic` this app uses: a P-256 key pair for enrolling the
 * patient's phone. The package ships no types and `@types/elliptic` is not
 * installed, so this declares only what `lockscreen/phoneCard.ts` calls.
 */
declare module 'elliptic' {
  interface Signature {
    toDER(encoding: 'hex'): string;
  }
  interface KeyPair {
    getPublic(compact: boolean, encoding: 'hex'): string;
    getPrivate(encoding: 'hex'): string;
    /** Signs a message digest (here a SHA-256 hash). */
    sign(digest: Uint8Array | number[]): Signature;
  }
  class ec {
    constructor(curve: 'p256');
    genKeyPair(options: { entropy: number[] }): KeyPair;
    keyFromPrivate(key: string, encoding: 'hex'): KeyPair;
  }
}
