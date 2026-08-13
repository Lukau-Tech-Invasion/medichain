#!/usr/bin/env python3
"""Substrate storage-key helpers.

Enough of the hashing scheme to address a specific pallet's storage from a
shell script, without pulling in a SCALE/substrate Python dependency.

A storage map's key prefix is:

    twox128(pallet_name) ++ twox128(storage_item_name)

where twox128(x) is xxHash64(x, seed=0) ++ xxHash64(x, seed=1), each encoded
little-endian. xxHash64 is implemented here because it is not in the standard
library and the alternative -- guessing at prefixes or skipping the check -- is
how you end up with a qualification script that passes without checking.
"""

import sys

_MASK = 0xFFFFFFFFFFFFFFFF
_P1 = 11400714785074694791
_P2 = 14029467366897019727
_P3 = 1609587929392839161
_P4 = 9650029242287828579
_P5 = 2870177450012600261


def _rotl(x: int, r: int) -> int:
    return ((x << r) | (x >> (64 - r))) & _MASK


def _round(acc: int, val: int) -> int:
    acc = (acc + (val * _P2)) & _MASK
    acc = _rotl(acc, 31)
    return (acc * _P1) & _MASK


def _merge(acc: int, val: int) -> int:
    acc ^= _round(0, val)
    acc = (acc * _P1) & _MASK
    return (acc + _P4) & _MASK


def xxh64(data: bytes, seed: int = 0) -> int:
    """xxHash64 of `data`."""
    n = len(data)
    i = 0

    if n >= 32:
        v1 = (seed + _P1 + _P2) & _MASK
        v2 = (seed + _P2) & _MASK
        v3 = seed & _MASK
        v4 = (seed - _P1) & _MASK
        while n - i >= 32:
            v1 = _round(v1, int.from_bytes(data[i:i + 8], "little"))
            v2 = _round(v2, int.from_bytes(data[i + 8:i + 16], "little"))
            v3 = _round(v3, int.from_bytes(data[i + 16:i + 24], "little"))
            v4 = _round(v4, int.from_bytes(data[i + 24:i + 32], "little"))
            i += 32
        acc = (_rotl(v1, 1) + _rotl(v2, 7) + _rotl(v3, 12) + _rotl(v4, 18)) & _MASK
        acc = _merge(acc, v1)
        acc = _merge(acc, v2)
        acc = _merge(acc, v3)
        acc = _merge(acc, v4)
    else:
        acc = (seed + _P5) & _MASK

    acc = (acc + n) & _MASK

    while n - i >= 8:
        acc ^= _round(0, int.from_bytes(data[i:i + 8], "little"))
        acc = (_rotl(acc, 27) * _P1 + _P4) & _MASK
        i += 8

    if n - i >= 4:
        acc ^= (int.from_bytes(data[i:i + 4], "little") * _P1) & _MASK
        acc = (_rotl(acc, 23) * _P2 + _P3) & _MASK
        i += 4

    while i < n:
        acc ^= (data[i] * _P5) & _MASK
        acc = (_rotl(acc, 11) * _P1) & _MASK
        i += 1

    acc ^= acc >> 33
    acc = (acc * _P2) & _MASK
    acc ^= acc >> 29
    acc = (acc * _P3) & _MASK
    acc ^= acc >> 32
    return acc


def twox128(data: bytes) -> bytes:
    """Substrate's twox128: two little-endian xxh64 digests, seeds 0 and 1."""
    return xxh64(data, 0).to_bytes(8, "little") + xxh64(data, 1).to_bytes(8, "little")


def storage_prefix(pallet: str, item: str) -> str:
    """Hex-encoded storage prefix for `pallet::item`, with an 0x prefix."""
    return "0x" + (twox128(pallet.encode()) + twox128(item.encode())).hex()


def _self_test() -> int:
    """Known vectors, so a broken hasher fails loudly rather than silently."""
    checks = [
        (xxh64(b"", 0), 0xEF46DB3751D8E999),
        (xxh64(b"a", 0), 0xD24EC4F1A98C6E5B),
        # System::Account is the most widely published Substrate prefix there is.
        (storage_prefix("System", "Account"),
         "0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9"),
    ]
    failed = 0
    for got, want in checks:
        if got != want:
            print(f"SELF-TEST FAIL: got {got!r}, want {want!r}", file=sys.stderr)
            failed += 1
    if failed == 0:
        print("substrate_keys self-test OK")
    return 1 if failed else 0


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        sys.exit(_self_test())
    if len(sys.argv) == 3:
        print(storage_prefix(sys.argv[1], sys.argv[2]))
        sys.exit(0)
    print(f"usage: {sys.argv[0]} <Pallet> <StorageItem> | --self-test", file=sys.stderr)
    sys.exit(64)
