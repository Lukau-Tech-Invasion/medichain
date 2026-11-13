#!/usr/bin/env python3
"""Pin scripts/lib/auth_proof.py to the client's derivation.

The vector was produced by `deriveAuthProof` in client/shared/src/auth/proof.ts
(the login id is trimmed and lower-cased before it enters the salt). If this
fails, the Python port is wrong; do not update the vector.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from auth_proof import derive_auth_proof  # noqa: E402

VECTOR = "8d9621d8b0e50bde3b96469c063c3a56c849c8ce661a462049f4bb5b7251d230"

got = derive_auth_proof("BrowserTest!2026", "BT.Doctor ")
same = derive_auth_proof("BrowserTest!2026", "bt.doctor")
if got != VECTOR or same != VECTOR:
    print(f"FAIL auth proof drifted from the client: {got} / {same}")
    raise SystemExit(1)
print("ok auth proof matches the client vector")
