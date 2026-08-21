#!/usr/bin/env python3
"""Read a patient's emergency-capsule commitment back out of chain state.

This is the read-back half of the extrinsic round trip: the API submits
`MedicalRecords::upsert_emergency_capsule_commitment`, and this reads the
resulting `MedicalRecords::HealthRecords` entry straight from the node so the
stored value can be compared against what was submitted.

It decodes only the leading, fixed-width part of the SCALE-encoded
`HealthRecord<T>`, which is all the round trip needs:

    patient                        AccountId32   32 bytes
    emergency_capsule_commitment   [u8; 32]      32 bytes
    emergency_capsule_version      u32            4 bytes, little-endian
    ... (ipfs_hash, alerts, created_at, updated_at, last_modified_by follow)

Usage:
    python3 scripts/blockchain/verify-capsule.py <patient-ss58> [expected-commitment-hex] [expected-version]

Exits non-zero if the record is absent, or if an expected value is supplied and
does not match what the chain holds.
"""

import json
import sys
import hashlib
import binascii
import os
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from substrate_keys import twox128  # noqa: E402

RPC = os.environ.get("RPC_URL", "http://127.0.0.1:9944")
ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        payload = json.load(r)
    if "error" in payload:
        raise SystemExit(f"RPC error: {payload['error']}")
    return payload.get("result")


def ss58_pub(addr: str) -> bytes:
    n = 0
    for c in addr:
        n = n * 58 + ALPHA.index(c)
    b = n.to_bytes((n.bit_length() + 7) // 8, "big")
    raw = b"\x00" * (len(addr) - len(addr.lstrip("1"))) + b
    return raw[1:33]  # network prefix byte, 32-byte key, 2 checksum bytes


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 64
    patient = sys.argv[1]
    want_commitment = sys.argv[2].lower().removeprefix("0x") if len(sys.argv) > 2 else None
    want_version = int(sys.argv[3]) if len(sys.argv) > 3 else None

    pub = ss58_pub(patient)
    key = (
        twox128(b"MedicalRecords")
        + twox128(b"HealthRecords")
        + hashlib.blake2b(pub, digest_size=16).digest()
        + pub
    )
    val = rpc("state_getStorage", ["0x" + key.hex()])
    if val is None:
        print(f"  FAIL: no HealthRecords entry for {patient}")
        return 1

    raw = binascii.unhexlify(val[2:])
    stored_patient = raw[0:32]
    commitment = raw[32:64]
    version = int.from_bytes(raw[64:68], "little")

    print(f"  patient     : {patient}")
    print(f"  stored key  : {'matches' if stored_patient == pub else 'MISMATCH'}")
    print(f"  commitment  : 0x{commitment.hex()}")
    print(f"  version     : {version}")

    failures = 0
    if stored_patient != pub:
        print("  FAIL: stored patient field does not match the queried account")
        failures += 1
    if want_commitment is not None and commitment.hex() != want_commitment:
        print(f"  FAIL: commitment mismatch (expected 0x{want_commitment})")
        failures += 1
    if want_version is not None and version != want_version:
        print(f"  FAIL: version mismatch (expected {want_version})")
        failures += 1

    if failures:
        return 1
    if want_commitment is not None or want_version is not None:
        print("  PASS: on-chain state matches what was submitted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
