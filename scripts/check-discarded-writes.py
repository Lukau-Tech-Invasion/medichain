#!/usr/bin/env python3
"""Fail the build when a handler discards the result of a repository write.

`let _ = data.repositories.<x>.create(..).await;` compiles, satisfies every
type check, and returns HTTP 200. When the write fails, the caller is told the
operation succeeded and nothing was stored. No route test, endpoint-drift scan
or durability gate can see it, because the request genuinely succeeded — this
is the same blind spot `check-state-durability.py` was written for, one layer
further in: there the data was written to the wrong place, here it was not
written at all.

Two real instances found on 2026-08-26, both in workflows where the silence is
the whole problem:

  * `/api/lab/review` — an approval told the reviewer "approved and added to
    patient records" while the medical-record write had failed and been logged.
  * `/api/e-prescriptions/{id}/sign` and `/transmit` — a prescription reported
    as signed or transmitted to a pharmacy when neither had been persisted.

This gate ratchets the remaining surface downward:

  * a discarded write in a file NOT in BASELINE fails the build;
  * a count that RISES above its baseline fails the build;
  * a count that FALLS must have its baseline lowered in the same commit,
    because a ratchet nobody tightens is not a ratchet.

Not every entry is a defect. Some discarded writes are genuinely best-effort
(a cache refresh, a notification). Those belong in BEST_EFFORT with a reason,
not in BASELINE — the distinction is the point of the file.

Usage:  python scripts/check-discarded-writes.py [--list]
Exit 0 = clean or unchanged, 1 = regression or stale baseline.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "api" / "src"

# `let _ = <expr>.repositories.<name>.<verb>(...)` — the receiver may be
# `data`, `state` or `app_state`, and the call may be split across lines.
DISCARDED = re.compile(
    r"let\s+_\s*=\s*(?:data|state|app_state)\s*\.\s*repositories\s*\.\s*([a-z_0-9]+)\s*\.",
    re.MULTILINE,
)

# ---------------------------------------------------------------------------
# Writes that are CORRECT to discard, with the reason. Anything here is a
# deliberate best-effort side effect whose failure must not fail the request.
# ---------------------------------------------------------------------------
BEST_EFFORT: dict[str, str] = {
    # Push delivery is not part of any clinical decision. A notification
    # outage must not un-approve a lab result or un-sign a prescription.
    "push_tokens": "push delivery is a side effect of a decision, never part of it",
}


def strip_noise(text: str) -> str:
    """Remove `#[cfg(test)]` modules and comments.

    A test discarding a write says nothing about production behaviour, and a
    comment quoting the old code — which several of these files carry, e.g.
    "was: let _ = data.repositories..." — is not a call site.
    """
    text = re.sub(r"//.*", "", text)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)

    out, i = [], 0
    while True:
        m = re.search(r"#\[cfg\(test\)\]\s*mod\s+\w+\s*\{", text[i:])
        if not m:
            out.append(text[i:])
            break
        out.append(text[i : i + m.start()])
        j = i + m.end()
        depth = 1
        while j < len(text) and depth:
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
            j += 1
        i = j
    return "".join(out)


def scan() -> dict[str, int]:
    counts: dict[str, int] = {}
    for path in sorted(ROOT.rglob("*.rs")):
        rel = path.relative_to(ROOT.parent.parent).as_posix()
        body = strip_noise(path.read_text(encoding="utf-8", errors="replace"))
        hits = [r for r in DISCARDED.findall(body) if r not in BEST_EFFORT]
        if hits:
            counts[rel] = len(hits)
    return counts


# ---------------------------------------------------------------------------
# The remaining backlog: file -> discarded production repository writes.
# Every entry is a write whose failure is currently invisible to the caller.
# Numbers may only go down. Delete the entry when it reaches zero.
# ---------------------------------------------------------------------------
BASELINE: dict[str, int] = {
    "api/src/clinical_endpoints/billing/insurance_claims.rs": 2,
    "api/src/clinical_endpoints/billing/insurance_eligibility.rs": 1,
    "api/src/clinical_endpoints/clinical_support/lab_trends.rs": 1,
    "api/src/clinical_endpoints/clinical_support/telehealth.rs": 4,
    "api/src/clinical_endpoints/emergency/assessments.rs": 4,
    "api/src/clinical_endpoints/emergency/crisis.rs": 2,
    "api/src/clinical_endpoints/engagement/appointments.rs": 1,
    "api/src/clinical_endpoints/engagement/family.rs": 3,
    "api/src/clinical_endpoints/engagement/symptoms.rs": 2,
    "api/src/clinical_endpoints/engagement/wearables.rs": 4,
    "api/src/clinical_endpoints/insurance_pharmacy/drug_checking.rs": 1,
    "api/src/clinical_endpoints/medical_id/core.rs": 1,
    "api/src/clinical_endpoints/medical_id/preferences.rs": 1,
    "api/src/clinical_endpoints/platform/localization.rs": 1,
    "api/src/clinical_endpoints/platform/sync.rs": 3,
    "api/src/clinical_endpoints/surgical/diagnostics.rs": 4,
    "api/src/clinical_endpoints/surgical/perioperative.rs": 3,
    "api/src/clinical_endpoints/surgical/public_health.rs": 5,
    "api/src/clinical_endpoints/workflow/messaging.rs": 1,
    "api/src/handlers/ipfs_records.rs": 3,
    "api/src/handlers/nfc.rs": 3,
    "api/src/handlers/sms_preferences.rs": 1,
    "api/src/handlers/soap.rs": 3,
    "api/src/handlers/vitals.rs": 1,
}


def main() -> int:
    found = scan()

    if "--list" in sys.argv:
        for path, n in sorted(found.items(), key=lambda kv: (-kv[1], kv[0])):
            print(f"{n:3}  {path}")
        print(f"\n{sum(found.values())} discarded repository writes in {len(found)} files")
        return 0

    failures: list[str] = []

    for path, n in sorted(found.items()):
        base = BASELINE.get(path)
        if base is None:
            failures.append(
                f"NEW: {path} discards {n} repository write(s). A failed write must "
                f"reach the caller — return an error, or move the call into "
                f"BEST_EFFORT with a reason."
            )
        elif n > base:
            failures.append(f"ROSE: {path} {base} -> {n} discarded write(s).")

    for path, base in sorted(BASELINE.items()):
        n = found.get(path, 0)
        if n < base:
            failures.append(
                f"STALE BASELINE: {path} is now {n}, baseline says {base}. "
                f"Lower it in this commit."
            )

    if failures:
        print("Discarded repository writes gate FAILED:\n")
        for f in failures:
            print(f"  * {f}")
        print(
            "\nA `let _ = ...create(...)` returns 200 to the caller when the write "
            "\nfailed. Run with --list to see the current surface."
        )
        return 1

    total = sum(found.values())
    print(f"Discarded repository writes gate OK ({total} known, none new).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
