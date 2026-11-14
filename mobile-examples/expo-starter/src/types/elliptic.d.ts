/**
 * The part of `elliptic` this app uses: a P-256 key pair for enrolling the
 * patient's phone. The package ships no types and `@types/elliptic` is not
 * installed, so this declares only what `lockscreen/phoneCard.ts` calls.
 */
declare module 'elliptic' {
  interface KeyPair {
    getPublic(compact: boolean, encoding: 'hex'): string;
    getPrivate(encoding: 'hex'): string;
  }
  class ec {
    constructor(curve: 'p256');
    genKeyPair(options: { entropy: number[] }): KeyPair;
  }
}
