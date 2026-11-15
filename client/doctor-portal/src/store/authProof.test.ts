import { describe, it, expect } from 'vitest';
import { deriveAuthProof } from '@medichain/shared';

/**
 * The auth proof is what every existing staff verifier was made from
 * (PBKDF2-SHA512 210,000 rounds, then HKDF-SHA256 "medichain-auth-v1", salt
 * `medichain-staff-credential-v1:<login id lowercased>`). These vectors were
 * computed from the implementation that shipped BEFORE the sign-in redesign.
 * If one fails, the derivation changed and every enrolled account is locked
 * out: revert the change, do not edit the vectors.
 */
describe('deriveAuthProof', () => {
  it('reproduces the pre-removal vectors byte for byte', async () => {
    expect(await deriveAuthProof('Correct-Horse-9!', 'Dr.Mbeki')).toBe(
      '30d9a1b9da818af15ff15705d3caf6a8b729d351b8e4c2aa7423e5565176de3b'
    );
    expect(await deriveAuthProof('p', 'EMP-001')).toBe(
      'cb3b3ad17ce3e4d696f86ddd165f9c331b5bdc1ac8387f20e19da7537a56fbc8'
    );
  }, 60_000);

  it('handles non-ASCII passwords and trims and lowercases the login id', async () => {
    expect(await deriveAuthProof('pässwörd✓ 日本', '  Lerato.NKOSI ')).toBe(
      'dee4831b82a6a01a93828fe72d6b72b2e11c6c59a060cec7b933fc366a63f58c'
    );
  }, 60_000);

  it('treats the login id case-insensitively but the password exactly', async () => {
    const a = await deriveAuthProof('Secret-1', 'EMP-9');
    const b = await deriveAuthProof('Secret-1', 'emp-9');
    const c = await deriveAuthProof('secret-1', 'EMP-9');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});
