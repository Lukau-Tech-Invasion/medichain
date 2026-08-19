#!/usr/bin/env python3
"""Find form state fields that carry a real default but have no UI control.

The failure mode this catches is the one that produced the AMA
`patientSigned: true` and the laceration `sutureType: '4-0 Nylon'` defects: a
field is initialised in `useState({...})` with a plausible clinical value, no
control ever sets it, and the backend faithfully persists the fiction. Nothing
in the type system or the tests notices, because the value is always present
and always well-formed — it is simply never true.

A field is reported when ALL of the following hold:

  * it is initialised in a `useState({ ... })` object literal,
  * its initial value is a non-empty string, a non-zero number, or `true`
    (an empty string / 0 / false is a blank to be filled in, not a claim),
  * no `setX({ ...x, <field>: ...})` update mentions it,
  * no `value={...<field>}` or `checked={...<field>}` binding mentions it.

That last pair is what separates a fabricated value from a legitimate constant:
a field the user can see and change is fine, whatever it starts as.

Exit status is always 0 — this is a review aid, not a gate. Deciding whether a
default is a lie needs clinical judgement about the field.

Usage:
    python scripts/check-uncontrolled-defaults.py [workspace ...]
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

# A `key: value,` pair at the top level of the initialiser.
FIELD = re.compile(r"^\s*(\w+)\s*:\s*(.+?),?\s*$")

# Values that assert something rather than leaving a blank.
ASSERTIVE = re.compile(r"^(?:'[^']+'|\"[^\"]+\"|`[^`]+`|true|[1-9]\d*(?:\.\d+)?)$")


def initialiser_bodies(source: str) -> list[str]:
    """Every `useState({...})` object literal in the file."""
    bodies = []
    for match in USE_STATE.finditer(source):
        depth = 1
        i = match.end()
        while i < len(source) and depth:
            if source[i] == "{":
                depth += 1
            elif source[i] == "}":
                depth -= 1
            i += 1
        bodies.append(source[match.end() : i - 1])
    return bodies


def top_level_fields(body: str) -> list[tuple[str, str]]:
    """`(name, value)` for each pair at nesting depth 0 of the initialiser."""
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


def main() -> int:
    workspaces = [a for a in sys.argv[1:] if not a.startswith("-")] or DEFAULT_WORKSPACES
    findings: list[tuple[str, str, str]] = []

    for workspace in workspaces:
        for path in sorted((ROOT / workspace).rglob("*.tsx")):
            if path.name.endswith(".test.tsx"):
                continue
            source = path.read_text(encoding="utf-8", errors="replace")
            rel = path.relative_to(ROOT).as_posix()

            for body in initialiser_bodies(source):
                for name, value in top_level_fields(body):
                    if not ASSERTIVE.match(value):
                        continue
                    # Does anything let a user change it?
                    #
                    # Computed-key updates (`setMse({ ...mse, [field.key]: v })`)
                    # are the reason this check cannot be a gate: PsychPage
                    # renders its nine mental-status fields from a list and
                    # writes them back through one dynamic key, so every field
                    # looks unreachable to a literal search while all nine are in
                    # fact editable. When a file writes state through a computed
                    # key at all, assume its fields are reachable — a false
                    # negative here is much cheaper than nine false alarms.
                    if re.search(r"\.\.\.\w+,\s*\[[^\]]+\]\s*:", source):
                        continue
                    updated = re.search(rf"\.\.\.\w+,\s*{re.escape(name)}\s*:", source)
                    bound = re.search(
                        rf"(?:value|checked)=\{{[^}}]*\.{re.escape(name)}\b", source
                    )
                    setter = re.search(rf"\bset{name[0].upper()}{name[1:]}\s*\(", source)
                    if updated or bound or setter:
                        continue
                    findings.append((rel, name, value))

    if not findings:
        print("No uncontrolled defaults found.")
        return 0

    print(f"{len(findings)} form field(s) carry a default with no control:\n")
    current = ""
    for rel, name, value in findings:
        if rel != current:
            print(f"  {rel}")
            current = rel
        print(f"      {name}: {value}")

    print(
        "\nEach of these is submitted exactly as written, every time. Check whether\n"
        "the value is a claim about the patient (fix: add a control, or drop the\n"
        "field) or an inert constant (fine)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
