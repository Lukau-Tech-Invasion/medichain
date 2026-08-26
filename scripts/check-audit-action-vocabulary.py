#!/usr/bin/env python3
"""Fail the build when a handler writes an audit action the database will reject.

`access_logs.action` carries a CHECK constraint listing every permitted value.
A handler that writes a value outside it gets a constraint violation on
PostgreSQL — and nowhere else, because the in-memory repository enforces no
constraints at all. Every unit test passes; the audit row is lost in
production.

That is not hypothetical. `lab_review_approve` and `lab_review_reject` were
written by `/api/lab/review` from the day it existed and were never in the
constraint. The insert was discarded with `let _ =`, so the violation was
thrown away and the reviewer was told the result had been "approved and added
to patient records". It surfaced on 2026-08-26 only because that write was
changed into an obligation.

WHY A NEW GATE RATHER THAN THE EXISTING TEST

`test_pg_access_log_accepts_every_action_the_handlers_write` keeps a hand-copy
of the constraint's vocabulary and proves the database accepts each entry. That
proves list == constraint. The invariant that matters is

    constraint  is a superset of  { values the handlers actually write }

and a value missing from both the list and the constraint satisfies that test
perfectly while failing in production. A mirror of the thing under test cannot
detect an omission the two share. This gate reads the left-hand side from the
Rust source instead.

WHAT IT UNDERSTANDS

It scans the body of every `AccessLogEntry` / `AccessLogEntity` struct literal —
skipping the `struct` definitions themselves — and reads the action field's
right-hand side. String literals and `const` references resolve directly.

Anything else is reported as unverifiable rather than skipped. Each such
expression has to be read once and recorded in RESOLVED_EXPRESSIONS with the
values it can produce. That is deliberate friction: an audit value the gate
cannot evaluate is exactly the case that needs a person, and quietly ignoring
it would rebuild the blind spot this exists to close.

Usage:  python scripts/check-audit-action-vocabulary.py [--list]
Exit 0 = every written value is permitted by the constraint.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "api" / "src"
MIGRATIONS = ROOT / "api" / "migrations"

# ---------------------------------------------------------------------------
# Expressions whose possible values have been read at their call sites.
#
# Keyed by "<repo-relative file>::<expression>" so the same expression text in
# two files cannot be resolved by one file's reading. Add an entry only after
# actually following the value to every caller.
# ---------------------------------------------------------------------------
RESOLVED_EXPRESSIONS: dict[str, list[str]] = {
    # `action` is validated to exactly "approve" or "reject" before the audit
    # row is built, so the format string has exactly two expansions.
    'api/src/handlers/lab.rs::format!("lab_review_{}", action)': [
        "lab_review_approve",
        "lab_review_reject",
    ],
    # `audit_prescription_event` takes the event name as a parameter; its only
    # two call sites, both in that file, pass these literals.
    "api/src/clinical_endpoints/billing/e_prescriptions.rs::event.to_string()": [
        "prescription_signed",
        "prescription_transmitted",
    ],
    # The recording handler picks one of two literals immediately above the
    # struct literal.
    "api/src/clinical_endpoints/clinical_support/telehealth.rs::action.to_string()": [
        "recording-started",
        "recording-stopped",
    ],
    # Client-supplied, but `POST /api/telehealth/sessions/{id}/event` rejects
    # anything outside TELEHEALTH_EVENT_TYPES before reaching the audit row.
    # That constant and the constraint are two halves of one closed set.
    "api/src/clinical_endpoints/clinical_support/telehealth.rs::body.event_type.clone()": [
        "conference-joined",
        "conference-left",
        "participant-joined",
        "participant-left",
        "error",
    ],
    # `access_log_entity(accessor_id, accessor_role, action, patient_id)` — the
    # third argument. These are every literal passed by its six call sites in
    # emergency/assessments.rs and emergency/crisis.rs.
    "api/src/clinical_endpoints/emergency/mod.rs::action.to_string()": [
        "create_trauma_assessment",
        "create_stroke_assessment",
        "create_sepsis_assessment",
        "create_ems_handoff",
        "create_code_blue",
        "create_cardiac_event",
    ],
}

# Field-to-field copies between the two representations of one row. They
# introduce no value: whatever is on the right was already checked where it was
# written. Listed rather than pattern-matched, so a genuinely new expression in
# these files still has to be read.
PASS_THROUGH = {
    "api/src/types/conversions.rs::entity.action",
    "api/src/types/conversions.rs::entry.access_type",
}

ENTITY = re.compile(r"(?<!struct )\bAccessLog(?:Entry|Entity)\s*\{")
FIELD = re.compile(r"(?:access_type|action)\s*:\s*(.+?)\s*,\s*\n")
CONST_STR = re.compile(r"const\s+(\w+)\s*:\s*&(?:'static\s+)?str\s*=\s*\"([^\"]*)\"")


def strip_tests(text: str) -> str:
    """Drop `#[cfg(test)]` modules — a test fixture is not a production write."""
    out, i = [], 0
    while True:
        m = re.search(r"#\[cfg\(test\)\]\s*mod\s+\w+\s*\{", text[i:])
        if not m:
            out.append(text[i:])
            break
        out.append(text[i : i + m.start()])
        j, depth = i + m.end(), 1
        while j < len(text) and depth:
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
            j += 1
        i = j
    return "".join(out)


def literal_blocks(text: str):
    """Yield the body of every AccessLogEntry/Entity struct literal."""
    for m in ENTITY.finditer(text):
        i, depth = m.end(), 1
        while i < len(text) and depth:
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
            i += 1
        yield text[m.end() : i]


def constraint_vocabulary() -> set[str]:
    """The permitted values, from the newest migration that defines them.

    Migrations replace the constraint wholesale (DROP then ADD), so the last
    one to add it is the one in force.
    """
    defining = sorted(
        p
        for p in MIGRATIONS.glob("*.sql")
        if "ADD CONSTRAINT access_logs_action_check"
        in p.read_text(encoding="utf-8", errors="replace")
    )
    if not defining:
        print("No migration adds access_logs_action_check.")
        sys.exit(1)
    body = defining[-1].read_text(encoding="utf-8", errors="replace")
    clause = body[body.index("ADD CONSTRAINT access_logs_action_check") :]
    clause = clause[: clause.index(");") + 1]
    # Strip SQL comments, so a value named only in prose is not counted as
    # permitted.
    clause = re.sub(r"--.*", "", clause)
    return set(re.findall(r"'([^']+)'", clause))


def consts() -> dict[str, str]:
    """Every `const NAME: &str = "..."` in the API, by name."""
    found: dict[str, str] = {}
    for path in SRC.rglob("*.rs"):
        body = path.read_text(encoding="utf-8", errors="replace")
        for name, value in CONST_STR.findall(body):
            found[name] = value
    return found


def written_values() -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """Returns (resolved value -> files, unverifiable expression -> files)."""
    resolved: dict[str, set[str]] = {}
    unresolved: dict[str, set[str]] = {}
    known_consts = consts()

    for path in sorted(SRC.rglob("*.rs")):
        rel = path.relative_to(ROOT).as_posix()
        body = strip_tests(path.read_text(encoding="utf-8", errors="replace"))
        for block in literal_blocks(body):
            for raw in FIELD.findall(block):
                raw = raw.strip()
                key = f"{rel}::{raw}"

                if key in PASS_THROUGH:
                    continue

                expansions = RESOLVED_EXPRESSIONS.get(key)
                if expansions is not None:
                    for v in expansions:
                        resolved.setdefault(v, set()).add(rel)
                    continue

                literal = re.fullmatch(r'"([^"]*)"(?:\.to_string\(\))?', raw)
                if literal:
                    resolved.setdefault(literal.group(1), set()).add(rel)
                    continue

                const = re.fullmatch(r"(\w+)(?:\.to_string\(\))?", raw)
                if const and const.group(1) in known_consts:
                    resolved.setdefault(known_consts[const.group(1)], set()).add(rel)
                    continue

                unresolved.setdefault(raw, set()).add(rel)

    return resolved, unresolved


def main() -> int:
    permitted = constraint_vocabulary()
    resolved, unresolved = written_values()

    if "--list" in sys.argv:
        print(f"{len(permitted)} values permitted by the constraint\n")
        for v in sorted(resolved):
            mark = "ok " if v in permitted else "BAD"
            print(f"  {mark} {v}   ({', '.join(sorted(resolved[v]))})")
        for expr, files in sorted(unresolved.items()):
            print(f"  ??? {expr}   ({', '.join(sorted(files))})")
        return 0

    failures: list[str] = []

    for value, files in sorted(resolved.items()):
        if value not in permitted:
            failures.append(
                f"'{value}' is written by {', '.join(sorted(files))} but is not in "
                f"the access_logs_action_check vocabulary. On PostgreSQL this "
                f"insert is rejected; in memory it succeeds. Add it in a migration."
            )

    for expr, files in sorted(unresolved.items()):
        failures.append(
            f"`{expr}` in {', '.join(sorted(files))} yields an audit action this "
            f"gate cannot evaluate. Follow it to its call sites and record the "
            f"values in RESOLVED_EXPRESSIONS, or write a literal."
        )

    if failures:
        print("Audit action vocabulary gate FAILED:\n")
        for f in failures:
            print(f"  * {f}")
        return 1

    # A permitted value nobody writes is not a failure: the list keeps legacy
    # vocabulary valid for rows already in the table.
    print(
        f"Audit action vocabulary gate OK "
        f"({len(resolved)} written values, all permitted by the constraint)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
