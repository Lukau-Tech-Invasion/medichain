#!/usr/bin/env python3
"""Give inline `fetch` mock responses the `headers` a real Response always has.

The shared API client branches on the content type before parsing:

    const contentType = response.headers.get('content-type');

44 test files hand-roll `{ ok: true, status: 200, json: ... }` with no
`headers` at all, so that line throws `Cannot read properties of undefined` —
inside an effect, where the component swallows it into its error branch. The
test then fails looking for content the page never got to render, and the
message says nothing about the real cause.

`client/shared/src/testing/fetchMock.ts` already exports a correct
`jsonResponse()`; this brings the inline literals up to the same shape rather
than rewriting every test to import it.

Idempotent: literals that already declare `headers` are left alone.

Usage:  python scripts/fix-test-mock-headers.py [--check]
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKSPACES = ["client/doctor-portal", "client/patient-app"]
HEADERS_LINE = "headers: new Headers({ 'content-type': 'application/json' }),"

# An `ok:` property inside an object literal that also has a `json:` property.
OK_PROP = re.compile(r"^(\s*)ok:\s*[^,\n]+,\s*$", re.M)


def patch(source: str) -> tuple[str, int]:
    out: list[str] = []
    added = 0
    lines = source.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        m = OK_PROP.match(line)
        if m:
            # Look ahead a few lines: is this a response literal (has `json:`)
            # that does not already declare `headers`?
            window = "\n".join(lines[i : i + 8])
            if "json:" in window and "headers:" not in window:
                out.append(f"{m.group(1)}{HEADERS_LINE}")
                added += 1
        i += 1
    return "\n".join(out), added


def main() -> int:
    check = "--check" in sys.argv
    total_files = total_added = 0
    for workspace in WORKSPACES:
        root = ROOT / workspace / "src"
        if not root.exists():
            continue
        for test_file in sorted(root.rglob("*.test.tsx")):
            source = test_file.read_text(encoding="utf-8", errors="replace")
            patched, added = patch(source)
            if not added:
                continue
            total_files += 1
            total_added += added
            if not check:
                test_file.write_text(patched, encoding="utf-8")

    verb = "would add" if check else "added"
    print(f"{verb} {total_added} `headers` properties across {total_files} test files")
    return 1 if (check and total_added) else 0


if __name__ == "__main__":
    sys.exit(main())
