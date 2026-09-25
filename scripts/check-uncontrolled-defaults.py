#!/usr/bin/env python3
"""Find clinical values a page asserts that nobody entered.

Two scans, because this defect has two homes.

**1. Form state (review aid, exit 0).** A field initialised in `useState({...})`
with a plausible clinical value that no control ever writes. This produced the
AMA `patientSigned: true` and the laceration `sutureType: '4-0 Nylon'` defects.

**2. Submit payloads (gate, exit 1 on anything new).** A literal in the object a
page posts to the API. This is where the worse instances live, and where this
script was blind until 2026-09-09:

  PediatricsPage   hr/rr/temp_interpretation: 'Normal'   every child's vitals
                   pain: { score: 0 }                    no pain, unasked
                   immunizations: 'Up to date'           every child
                   abuse_screening: { concerns: false }  a child-protection
                                                         screen that never ran
  TraumaPage       vital_signs: {bp:"120/80", hr:80,     textbook-normal
                                 rr:16, spo2:98}         observations on a
                                                         patient who may be shocked
  CodeBluePage     location: 'Emergency Department'      every code, anywhere
  BloodBankPage    bloodType: 'Unknown'                  while the patient
                                                         record held the type
  ChainOfCustody   integrityVerified: true               a legal document
                                                         asserting the seal was
                                                         checked, with no
                                                         control asking

The last two no longer appear: both were fixed rather than baselined, which is
what should happen to most of what this finds.

All sixteen of those were found by hand. This script scanned past every one,
because it only ever read `useState` initialisers — and none of them are state
at all. They are literals in the object built inside the submit handler.

Replayed against the pre-fix tree, the payload scan reports all sixteen. That
replay is the only reason to believe it: a detector for a defect class you have
already cleaned up reports nothing either way.

It recurses into nested objects, which is essential — seven of the sixteen were
one level down (`vital_signs.bp`, `abuse_screening.concerns`, `pain.score`).

**Why the payload half can be a gate when the state half cannot.** A page's
form state is large and legitimately full of constants, and `PsychPage` alone
produces nine false alarms through computed-key updates. A submit payload is
small, and a literal in it is by construction the same value on every record the
page ever files. The whole tree yields thirteen, each triaged in BASELINE below
with the reason it is true of every record — mostly lifecycle states, which are
the one shape that is legitimately constant.

**What it cannot see:**

  * a value read from state that is itself wrong — the literal is the signal,
    and `formData.x` is not a literal;
  * a payload assembled by spread or by a helper function rather than written as
    one object literal;
  * `false` and `0` in *form state*, where they are a blank to be filled in. In
    a payload they are a negative assertion and are reported.

Usage:
    python scripts/check-uncontrolled-defaults.py [--list] [workspace ...]

Exit 0 = no new payload assertions. Exit 1 = a payload asserts something new,
or the baseline names something that no longer exists.
"""
from __future__ import annotations

import pathlib
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_WORKSPACES = ["client/doctor-portal/src", "client/patient-app/src"]

# `useState({` up to the matching close. Brace-counted rather than regexed:
# these initialisers nest arrays and objects several levels deep.
USE_STATE = re.compile(r"useState[^(]*\(\s*\{")

# `const someData = {` — the shape a submit handler builds its payload in.
CONST_OBJECT = re.compile(r"\bconst\s+(\w+)\s*(?::[^=\n]+)?=\s*\{")

# `createFoo(payload)` / `updateFoo(payload, ...)`. Names the local that is sent,
# so an object literal that never reaches the API is not scanned.
API_CALL = re.compile(
    r"\b(?:create|update|submit|save|post|put|patch)\w*\s*\(\s*(\w+)\s*[,)]", re.I
)

# A `key: value,` pair.
FIELD = re.compile(r"^\s*([A-Za-z_]\w*)\s*:\s*(.+?),?\s*$")

# Values that assert something rather than leaving a blank.
ASSERTIVE = re.compile(r"^(?:'[^']+'|\"[^\"]+\"|`[^`{]+`|true|[1-9]\d*(?:\.\d+)?)$")

# In a payload only: a negative finding is still a finding.
NEGATIVE = re.compile(r"^(?:false|0|0\.0)$")

# Payload literals that have been read and accepted, with the reason.
#
# Adding an entry is a claim that the value is true of every record the page
# will ever file. Most of these are lifecycle states at the moment of creation —
# a consult really is `requested` when it is created — which is the one shape
# that is legitimately constant.
BASELINE: dict[tuple[str, str], str] = {
    ("AutopsyPage.tsx", "status"): "'in-progress' — an autopsy is in progress the moment it is opened.",
    ("BloodBankPage.tsx", "status"): "'ordered' — the state a new blood order is created in.",
    ("ChainOfCustodyPage.tsx", "status"): "'collected' — the specimen is being collected on this form.",
    ("CriticalValuePage.tsx", "notificationStatus"): "'pending' — nobody has been notified yet.",
    ("FallRiskPage.tsx", "assessment_tool"): "'morse' — the page implements the Morse Fall Scale.",
    ("PathologyPage.tsx", "status"): "'received' — the specimen is being received on this form.",
    ("ShiftHandoffPage.tsx", "status"): "'pending' — a handoff is pending until acknowledged.",
}


def matching_body(source: str, start: int) -> tuple[str, int]:
    """The text up to the brace that closes the one just opened, and where it ends."""
    depth, i = 1, start
    while i < len(source) and depth:
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
        i += 1
    return source[start : i - 1], i


def initialiser_bodies(source: str) -> list[str]:
    """Every `useState({...})` object literal in the file."""
    return [matching_body(source, m.end())[0] for m in USE_STATE.finditer(source)]


def payload_bodies(source: str) -> list[str]:
    """Every `const x = {...}` object literal that is then sent to the API."""
    sent = set(API_CALL.findall(source))
    bodies = []
    for match in CONST_OBJECT.finditer(source):
        if match.group(1) in sent:
            bodies.append(matching_body(source, match.end())[0])
    return bodies


def top_level_fields(body: str) -> list[tuple[str, str]]:
    """`(name, value)` for each pair at nesting depth 0 of the literal."""
    fields, depth, line = [], 0, ""
    for char in body:
        if char in "{[(":
            depth += 1
        elif char in "}])":
            depth -= 1
        if char == "\n" and depth == 0:
            match = FIELD.match(line)
            if match:
                fields.append((match.group(1), match.group(2).strip()))
            line = ""
        else:
            line += char
    return fields


def nested_fields(body: str, prefix: str = "") -> list[tuple[str, str]]:
    """`(dotted.name, value)` for every pair, descending into nested objects.

    Five of the eight defects this scan exists for were one level down, so a
    depth-0-only walk — which is all the form-state scan needs — would have
    missed most of them.
    """
    fields, depth, line, i = [], 0, "", 0
    while i < len(body):
        char = body[i]
        if char == "{" and depth == 0:
            key_match = FIELD.match(line + "{")
            nested, end = matching_body(body, i + 1)
            if key_match:
                fields += nested_fields(nested, prefix + key_match.group(1) + ".")
            i, line = end, ""
            continue
        if char in "{[(":
            depth += 1
        elif char in "}])":
            depth -= 1
        if char == "\n" and depth == 0:
            match = FIELD.match(line)
            if match:
                fields.append((prefix + match.group(1), match.group(2).strip()))
            line = ""
        else:
            line += char
        i += 1
    match = FIELD.match(line)
    if match:
        fields.append((prefix + match.group(1), match.group(2).strip()))
    return fields


def scan_form_state(source: str) -> list[tuple[str, str]]:
    """Uncontrolled defaults in `useState` initialisers. Review aid only."""
    found = []
    # Computed-key updates (`setMse({ ...mse, [field.key]: v })`) are the reason
    # this half cannot be a gate: PsychPage renders its nine mental-status fields
    # from a list and writes them back through one dynamic key, so every field
    # looks unreachable to a literal search while all nine are in fact editable.
    # When a file writes state through a computed key at all, assume its fields
    # are reachable — a false negative is much cheaper than nine false alarms.
    if re.search(r"\.\.\.\w+,\s*\[[^\]]+\]\s*:", source):
        return found
    for body in initialiser_bodies(source):
        for name, value in top_level_fields(body):
            if not ASSERTIVE.match(value):
                continue
            updated = re.search(rf"\.\.\.\w+,\s*{re.escape(name)}\s*:", source)
            bound = re.search(rf"(?:value|checked)=\{{[^}}]*\.{re.escape(name)}\b", source)
            setter = re.search(rf"\bset{name[0].upper()}{name[1:]}\s*\(", source)
            if not (updated or bound or setter):
                found.append((name, value))
    return found


def scan_payloads(source: str) -> list[tuple[str, str]]:
    """Literal assertions in the object a page posts to the API. Gated."""
    found = []
    for body in payload_bodies(source):
        for name, value in nested_fields(body):
            if ASSERTIVE.match(value) or NEGATIVE.match(value):
                found.append((name, value))
    return found


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    workspaces = args or DEFAULT_WORKSPACES
    verbose = "--list" in sys.argv

    state_findings: list[tuple[str, str, str]] = []
    payload_findings: list[tuple[str, str, str, str]] = []

    for workspace in workspaces:
        for path in sorted((ROOT / workspace).rglob("*.tsx")):
            if path.name.endswith(".test.tsx"):
                continue
            source = path.read_text(encoding="utf-8", errors="replace")
            rel = path.relative_to(ROOT).as_posix()
            for name, value in scan_form_state(source):
                state_findings.append((rel, name, value))
            for name, value in scan_payloads(source):
                payload_findings.append((rel, path.name, name, value))

    # --- the gated half -----------------------------------------------------
    seen = {(filename, name) for _, filename, name, _ in payload_findings}
    new = [f for f in payload_findings if (f[1], f[2]) not in BASELINE]
    stale = [key for key in BASELINE if key not in seen]

    if state_findings:
        print(f"REVIEW: {len(state_findings)} form field(s) carry a default with no control:")
        current = ""
        for rel, name, value in state_findings:
            if rel != current:
                print(f"  {rel}")
                current = rel
            print(f"      {name}: {value}")
        print()

    if new:
        print("FAIL - a submit payload asserts a value nobody entered:\n")
        for rel, _, name, value in new:
            print(f"  {rel}\n      {name}: {value}")
        print(
            "\nThis literal is written into every record the page files. Either it is\n"
            "true of all of them — add it to BASELINE with that reason — or the form\n"
            "has to collect it, or it should not be sent at all. An absent field reads\n"
            "as 'not recorded'; a fabricated one reads as a finding."
        )
        return 1

    if stale:
        print("FAIL - BASELINE names payload assertions that no longer exist:\n")
        for filename, name in sorted(stale):
            print(f"  {filename}: {name}")
        print("\nRemove them, so the baseline keeps meaning what it says.")
        return 1

    if verbose:
        print("Accepted payload assertions:")
        for (filename, name), reason in sorted(BASELINE.items()):
            print(f"  {filename}: {name}\n      {reason}")
        print()

    print(
        f"Uncontrolled defaults gate OK "
        f"({len(payload_findings)} payload assertion(s), all baselined; "
        f"{len(state_findings)} form-state note(s))."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
