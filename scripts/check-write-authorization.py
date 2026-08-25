#!/usr/bin/env python3
"""Flag state-changing handlers gated only by the broadest role predicate.

Why this exists
---------------
`Role::is_healthcare_provider()` is true for Admin, Doctor, Nurse,
LabTechnician **and Pharmacist**. That is the right question for "may this
person look at clinical data at all". It is the wrong question for almost any
specific action.

On 2026-08-20 that distinction was a live defect: the telehealth recording
endpoint asked `is_healthcare_provider()`, so a **pharmacist could start
recording a patient's consultation** — while `role_is_moderator()`, the mapping
that decides the Jitsi JWT's moderator claim, already excluded them. Two
definitions of "moderator" in one feature, and the security-relevant gate
happened to use the wider one.

Nothing caught it. `check-endpoint-auth.py` counted the handler as tier-3
"role authorization" and was satisfied — because it *does* make a role decision.
It just makes the wrong one. A gate that asks "is there an authorization check"
cannot see a check that is present and too permissive.

What this checks
----------------
For every handler that changes state (POST/PUT/PATCH/DELETE), report whether its
only role decision is the broadest predicate. A read gated on "any clinical
staff" is usually defensible. A **write** gated on it is a claim that a
pharmacist, a lab technician, a nurse and a doctor should all be able to perform
that action — which is sometimes true, and needs to have been decided rather
than inherited.

This is a review prompt, not a verdict. The allowlist below records the
decisions already made, with the reasoning, so the list stays short and every
remaining entry means "nobody has ruled on this yet".

Exit codes
----------
0  no unreviewed write handlers
1  unreviewed write handlers found (or the backlog grew)
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
API_SRC = REPO / "api" / "src"

BROAD_PREDICATE = "is_healthcare_provider()"

# Narrower predicates. A handler using any of these has made a real decision
# about *which* clinical role may act, not merely that the caller is clinical.
NARROW_PREDICATES = (
    "is_admin()",
    "can_edit_medical_records()",
    "role_is_moderator(",
    "require_admin",
    "caller_owns_patient_record",
    "resolve_patient_access",
    "authorize_and_load",
    "may_read(",
    "may_write(",
)

WRITE_METHODS = ("post", "put", "patch", "delete")

# Handlers where "any clinical staff" is the reviewed, intended answer.
# Keep the reason with the entry — an allowlist without reasons becomes a
# place to hide things.
REVIEWED: dict[str, str] = {
    "check_drug_interactions": "a pharmacist is the most appropriate caller, not the least",
    "check_eligibility": "administrative benefits lookup, no clinical authority implied",
    "check_insurance_eligibility": "administrative benefits lookup",
    "verify_insurance": "administrative benefits lookup",
    "create_insurance_card": "administrative; scoped to the patient by a separate check",
    "create_insurance_claim": "administrative billing action",
    "check_in_appointment": "front-desk action; the handler also permits the patient",
    "book_appointment": "scheduling is not a clinical authority decision",
    "analyze_lab_trends": "read-shaped analysis exposed as POST for its request body",
    "verify_qr_code": "verification is a read; POST only because it carries a payload",
    "nfc_tap": "simulates a card tap; the emergency data still requires a token",
    "create_sample_history": "a LabTechnician is the primary intended caller here",
    "create_cds_alert": "pharmacists raising interaction alerts is the point of the feature",
    "create_medication_reminder": "pharmacist-appropriate; the handler also permits the patient",
    "create_patient_access_request": "requesting access is not receiving it; the grant is approved separately",
    "register_patient": "registration is a front-desk action in a small clinic; narrowing it would break real intake workflows",
    "create_telehealth_session": "pharmacist-led medication-review consultations are a real workflow",
}

# Deliberately surfaced and NOT yet decided. These are the ones where narrowing
# is defensible and widening is defensible, and the answer is a clinical-policy
# call the implementer should not make alone. Listed with the actual question so
# it can be answered, rather than quietly accepted.
#
# Keeping them here rather than in REVIEWED is the point: they are printed on
# every run, they do not fail the build (the risk is known, not new), and moving
# one into REVIEWED requires writing down an answer.
#
# ADR-0008 (2026-08-25) answered the *assurance* dimension of these handlers and
# deliberately not the *role* dimension, so they stay here. It settled how much
# proof an action needs -- initial break-glass is Class E, exempt from exact
# transaction signing because it must work offline on a shared device in seconds;
# emergency extension and NFC credential issuance are Class C. It did not settle
# *which roles* may invoke them, which is the question below and still a clinical
# governance call.
ESCALATED: dict[str, str] = {
    "emergency_access": (
        "Break-glass bypasses consent to reveal the emergency capsule. Should a "
        "Pharmacist or LabTechnician be able to trigger it, or only the treating "
        "roles (Doctor/Nurse/Admin)? Paramedics map to Nurse in this system. "
        "ADR-0008 classes the initial grant as E (no exact signature); the role "
        "question is untouched by that."
    ),
    "exchange_nfc_hash_for_token": (
        "Mints the one-time break-glass token. Same question as emergency_access; "
        "these two should be answered together or they will drift apart."
    ),
    "generate_nfc_card": (
        "Issues a patient identity credential. Identity issuance is usually an "
        "admin/registration authority rather than any clinical role. ADR-0008 "
        "requires Class C exact signing for it; that raises the proof required, "
        "not the question of who may do it at all."
    ),
}


def handler_blocks(text: str):
    """Yield (method, route, fn_name, body) for each routed handler."""
    pattern = re.compile(
        r'#\[(get|post|put|patch|delete)\("([^"]+)"\)\]\s*'
        r'pub async fn (\w+)',
        re.MULTILINE,
    )
    matches = list(pattern.finditer(text))
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        yield m.group(1), m.group(2), m.group(3), text[start:end]


def main() -> int:
    unreviewed: list[tuple[str, str, str, str]] = []
    escalated: list[tuple[str, str, str, str]] = []
    reviewed_hits = 0
    reads_on_broad = 0

    for path in sorted(API_SRC.rglob("*.rs")):
        if path.name == "domain.rs":
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if BROAD_PREDICATE not in text:
            continue
        rel = path.relative_to(REPO).as_posix()
        for method, route, fn, body in handler_blocks(text):
            if BROAD_PREDICATE not in body:
                continue
            if method not in WRITE_METHODS:
                reads_on_broad += 1
                continue
            if any(p in body for p in NARROW_PREDICATES):
                continue  # a narrower decision is also made here
            if fn in REVIEWED:
                reviewed_hits += 1
                continue
            if fn in ESCALATED:
                escalated.append((method.upper(), route, fn, rel))
                continue
            unreviewed.append((method.upper(), route, fn, rel))

    print(
        f"write-authorization gate: {reads_on_broad} read handlers use the broad "
        f"predicate (usually fine), {reviewed_hits} write handlers reviewed and accepted"
    )

    if escalated:
        print()
        print(
            f"{len(escalated)} handler(s) AWAITING AN OWNER DECISION "
            f"- known, not accepted:"
        )
        print()
        for method, route, fn, rel in sorted(escalated):
            print(f"  {method:6} {route:56} {fn}")
            print(f"         {rel}")
            print(f"         Q: {ESCALATED[fn]}")

    if not unreviewed:
        print(
            "\nPASS - every state-changing handler either narrows beyond "
            '"any clinical staff" or has a recorded reason not to.'
        )
        return 0

    print(
        f"\n{len(unreviewed)} state-changing handler(s) are gated ONLY by "
        f"`{BROAD_PREDICATE}`, which admits Pharmacist and LabTechnician:\n"
    )
    for method, route, fn, rel in sorted(unreviewed):
        print(f"  {method:6} {route:56} {fn}")
        print(f"         {rel}")
    print(
        "\nDecide each one: either narrow the predicate to the roles that should\n"
        "actually perform the action, or add it to REVIEWED in this script with\n"
        "the reason. Inheriting the widest clinical role by default is how a\n"
        "pharmacist ended up able to record a consultation."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
