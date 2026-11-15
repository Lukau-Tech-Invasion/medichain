#!/usr/bin/env python3
"""Verify exported audit checkpoints offline (ADR-0010).

The API seals audit rows into hash-chained, Ed25519-signed batches and exports
each sealed batch as `<batch_id>.json` in the checkpoint directory
(`AUDIT_CHECKPOINT_DIR`). This script checks a directory of them without the
database or the API:

  * every file is well formed;
  * each batch hash is what SHA3-256 gives over its header fields
    (api/src/audit_seal.rs, `batch_hash`);
  * each batch names, as its previous hash, the hash of the batch before it, so
    a deleted, edited or reordered checkpoint breaks the chain;
  * with --public-key, every signature verifies under that key, and every batch
    was signed by it.

Usage:
    python scripts/verify-audit-checkpoints.py DIR [--public-key HEX64]
                                               [--require-signed] [--allow-partial]

The public key is what `GET /api/patients/{id}/verify` returns as
`seal_key.public_key`. Take it from somewhere other than the directory being
checked: a signature checked against a key that came from the same place as the
checkpoints proves nothing.

By default the first checkpoint must have no previous hash (the chain starts
there). --allow-partial accepts a directory that starts mid-chain, for checking a
window of checkpoints.

Exit status: 0 all checks passed, 1 a check failed, 2 usage or unreadable input.
"""

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

BATCH_DOMAIN = b"medichain.audit.batch.v1\0"
FORMAT = "medichain.audit.checkpoint.v1"
HEX64 = set("0123456789abcdef")


def is_hex(text, length):
    return isinstance(text, str) and len(text) == length and set(text) <= HEX64


def push_digest(buffer, digest):
    buffer += struct.pack(">I", len(digest)) + digest


def batch_hash(checkpoint):
    """SHA3-256 over the header, exactly as the API encodes it."""
    buffer = bytearray(BATCH_DOMAIN)
    buffer += struct.pack(">q", checkpoint["batch_id"])
    buffer += struct.pack(">q", checkpoint["first_seq"])
    buffer += struct.pack(">q", checkpoint["last_seq"])
    buffer += struct.pack(">i", checkpoint["leaf_count"])
    push_digest(buffer, bytes.fromhex(checkpoint["merkle_root"]))
    previous = checkpoint["prev_batch_hash"]
    if previous is None:
        buffer.append(0)
    else:
        buffer.append(1)
        push_digest(buffer, bytes.fromhex(previous))
    return hashlib.sha3_256(bytes(buffer)).hexdigest()


def key_id(public_key):
    return hashlib.sha256(public_key).hexdigest()[:16]


# --- Ed25519 verification (RFC 8032), used when `cryptography` is absent -------

_P = 2**255 - 19
_L = 2**252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _recover_x(y, sign):
    if y >= _P:
        return None
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P) % _P
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P:
        x = x * _I % _P
    if (x * x - x2) % _P:
        return None
    if (x & 1) != sign:
        x = _P - x
    return x


def _base_point():
    y = 4 * pow(5, _P - 2, _P) % _P
    x = _recover_x(y, 0)
    return (x, y, 1, x * y % _P)


def _add(a, b):
    a1 = (a[1] - a[0]) * (b[1] - b[0]) % _P
    b1 = (a[1] + a[0]) * (b[1] + b[0]) % _P
    c = 2 * a[3] * b[3] * _D % _P
    d = 2 * a[2] * b[2] % _P
    e, f, g, h = b1 - a1, d - c, d + c, b1 + a1
    return (e * f % _P, g * h % _P, f * g % _P, e * h % _P)


def _mul(scalar, point):
    result = (0, 1, 1, 0)
    while scalar:
        if scalar & 1:
            result = _add(result, point)
        point = _add(point, point)
        scalar >>= 1
    return result


def _equal(a, b):
    return (a[0] * b[2] - b[0] * a[2]) % _P == 0 and (a[1] * b[2] - b[1] * a[2]) % _P == 0


def _decode(data):
    y = int.from_bytes(data, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = _recover_x(y, sign)
    return None if x is None else (x, y, 1, x * y % _P)


def ed25519_verify(public_key, message, signature):
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

        try:
            Ed25519PublicKey.from_public_bytes(public_key).verify(signature, message)
            return True
        except InvalidSignature:
            return False
    except ImportError:
        pass
    if len(public_key) != 32 or len(signature) != 64:
        return False
    a = _decode(public_key)
    r = _decode(signature[:32])
    s = int.from_bytes(signature[32:], "little")
    if a is None or r is None or s >= _L:
        return False
    h = int.from_bytes(hashlib.sha512(signature[:32] + public_key + message).digest(), "little") % _L
    return _equal(_mul(s, _base_point()), _add(r, _mul(h, a)))


# --- Checks --------------------------------------------------------------------

REQUIRED = {
    "format": str,
    "batch_id": int,
    "first_seq": int,
    "last_seq": int,
    "leaf_count": int,
    "merkle_root": str,
    "batch_hash": str,
    "sealed_at": str,
}


def load(path):
    try:
        checkpoint = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return None, f"unreadable: {error}"
    if not isinstance(checkpoint, dict):
        return None, "not a JSON object"
    for name, kind in REQUIRED.items():
        if not isinstance(checkpoint.get(name), kind) or isinstance(checkpoint.get(name), bool):
            return None, f"missing or mistyped field {name}"
    if checkpoint["format"] != FORMAT:
        return None, f"unknown format {checkpoint['format']!r}"
    for name in ("merkle_root", "batch_hash"):
        if not is_hex(checkpoint[name], 64):
            return None, f"{name} is not 64 hex characters"
    previous = checkpoint.get("prev_batch_hash")
    if previous is not None and not is_hex(previous, 64):
        return None, "prev_batch_hash is not 64 hex characters"
    checkpoint["prev_batch_hash"] = previous
    signature = checkpoint.get("signature")
    if signature is not None and not is_hex(signature, 128):
        return None, "signature is not 128 hex characters"
    checkpoint["signature"] = signature
    checkpoint["signing_key_id"] = checkpoint.get("signing_key_id")
    return checkpoint, None


def check_one(checkpoint, expected_prev, first, public_key, require_signed, allow_partial):
    problems = []
    if batch_hash(checkpoint) != checkpoint["batch_hash"]:
        problems.append("batch_hash does not match the header fields")
    if not first or not allow_partial:
        if checkpoint["prev_batch_hash"] != expected_prev:
            problems.append(
                "does not link to the checkpoint before it "
                "(a checkpoint was deleted, edited or reordered)"
            )
    signature = checkpoint["signature"]
    if signature is None:
        if require_signed or public_key is not None:
            problems.append("unsigned")
    elif public_key is not None:
        if checkpoint["signing_key_id"] != key_id(public_key):
            problems.append("signed by a different key than --public-key")
        elif not ed25519_verify(
            public_key, bytes.fromhex(checkpoint["batch_hash"]), bytes.fromhex(signature)
        ):
            problems.append("signature does not verify")
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("directory", type=Path)
    parser.add_argument("--public-key", help="64 hex characters, the Ed25519 public key")
    parser.add_argument("--require-signed", action="store_true")
    parser.add_argument("--allow-partial", action="store_true")
    args = parser.parse_args(argv)

    public_key = None
    if args.public_key:
        if not is_hex(args.public_key.lower(), 64):
            print("--public-key must be 64 hex characters", file=sys.stderr)
            return 2
        public_key = bytes.fromhex(args.public_key)
    if not args.directory.is_dir():
        print(f"{args.directory} is not a directory", file=sys.stderr)
        return 2

    paths = sorted(
        (p for p in args.directory.glob("*.json") if p.stem.isdigit()),
        key=lambda p: int(p.stem),
    )
    if not paths:
        print(f"no checkpoints in {args.directory}", file=sys.stderr)
        return 2

    failures = 0
    previous_hash = None
    for index, path in enumerate(paths):
        checkpoint, error = load(path)
        if error:
            print(f"FAIL {path.name}: {error}")
            failures += 1
            previous_hash = None
            continue
        problems = []
        if checkpoint["batch_id"] != int(path.stem):
            problems.append("file name and batch_id disagree")
        problems += check_one(
            checkpoint, previous_hash, index == 0, public_key, args.require_signed,
            args.allow_partial,
        )
        if problems:
            failures += 1
            for problem in problems:
                print(f"FAIL {path.name}: {problem}")
        previous_hash = checkpoint["batch_hash"]

    verified = "signatures verified" if public_key else "signatures NOT checked (no --public-key)"
    if failures:
        print(f"{failures} of {len(paths)} checkpoint(s) failed")
        return 1
    print(f"OK: {len(paths)} checkpoint(s), chain intact, {verified}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
