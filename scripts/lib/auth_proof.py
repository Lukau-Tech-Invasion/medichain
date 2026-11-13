#!/usr/bin/env python3
"""The sign-in auth proof, for the shell and Python harnesses.

This is a port of `client/shared/src/auth/proof.ts` (PBKDF2-HMAC-SHA512, 210,000
rounds, then the HKDF-SHA256 "auth" branch). It exists because the shell
harnesses cannot import TypeScript. It is byte-for-byte the same derivation, so
a proof made here verifies against a verifier the portals created, and the other
way round. `scripts/test-auth-proof.py` pins it against the client's vector; if
the two ever disagree the client is right and this file is wrong.

Usage:  python scripts/lib/auth_proof.py <login_id> <password>
Prints 64 lower-case hex characters.

Importable: `from auth_proof import derive_auth_proof` after putting this
directory on `sys.path`.
"""
import hashlib
import hmac
import sys

PBKDF2_ITERATIONS = 210_000
AUTH_INFO = b"medichain-auth-v1"
APP_SALT = b"medichain-staff-credential-v1"


def derive_auth_proof(password: str, login_id: str) -> str:
    """The proof of `password` for `login_id` (trimmed and lower-cased, as the client does)."""
    salt = APP_SALT + b":" + login_id.strip().lower().encode("utf-8")
    master = hashlib.pbkdf2_hmac(
        "sha512", password.encode("utf-8"), salt, PBKDF2_ITERATIONS, dklen=64
    )
    # HKDF (RFC 5869), SHA-256: extract with the app salt, expand one block.
    prk = hmac.new(APP_SALT, master, hashlib.sha256).digest()
    okm = hmac.new(prk, AUTH_INFO + b"\x01", hashlib.sha256).digest()
    return okm.hex()


def main(argv: list) -> int:
    if len(argv) != 3:
        sys.stderr.write("usage: auth_proof.py <login_id> <password>\n")
        return 2
    print(derive_auth_proof(argv[2], argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
