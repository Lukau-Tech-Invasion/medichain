#!/usr/bin/env python3
"""Fail the build if any HTTP handler lacks an authentication/authorization decision.

MediChain enforces authorization per handler rather than at a single runtime
chokepoint (see docs/adr/ and Horizon HZ-010). That pattern works — live testing
confirms ownership checks are enforced on sensitive endpoints — but it has one
failure mode: a NEW handler can be added that simply forgets to check. This gate
closes that gap at build time.

Every `#[get/post/put/patch/delete("...")]` handler must either:
  * contain an authentication or authorization marker in its body/signature, or
  * be listed in PUBLIC_ROUTES below with a reason.

A handler that is neither is a build failure. Adding a genuinely public route
means adding it to PUBLIC_ROUTES with a justification — a deliberate, reviewable
act rather than a silent omission.

Usage:  python scripts/check-endpoint-auth.py
Exit 0 = clean, 1 = unclassified handler(s) found.
"""
from __future__ import annotations
import re
import sys
import pathlib

ROUTE_ATTR = re.compile(r'#\[(get|post|put|patch|delete)\("([^"]+)"\)\]')
FN_SIG = re.compile(r'\bpub\s+(?:async\s+)?fn\s+(\w+)')

# Any of these in a handler's signature or body counts as an auth decision.
AUTH_MARKERS = [
    # Authentication helpers / extractors
    'get_current_user_id', 'get_user(', 'require_x_user_id_header',
    'require_auth', 'require_known_user', 'AuthorizedUser', 'X-User-Id',
    # Authorization helpers / role + ownership checks
    'require_admin', 'require_provider', 'require_demo_mode',
    'require_emergency_list_access', 'require_card_access',
    'require_surgical_list_access',
    'resolve_patient_access', 'is_healthcare_provider', 'is_admin(',
    'can_edit', 'has_permission', 'ensure_not_restricted', 'is_permitted',
    'INSUFFICIENT_ROLE', 'linked_patient_id',
    # Emergency-path token verification (its own auth model)
    'verify_emergency_token', 'emergency_grants', 'issue',
]

# Deliberately public routes. Each MUST carry a reason. Keep this list SHORT and
# justified — every addition is a decision to expose an endpoint unauthenticated.
PUBLIC_ROUTES = {
    '/health': 'liveness probe, no data',
    '/health/ready': 'readiness probe, no data',
    '/health/db': 'DB liveness, no patient data',
    '/api/health/detailed': 'aggregate health, no patient data',
    '/api/health/telehealth': 'telehealth subsystem health, no data',
    '/api/ipfs/health': 'IPFS liveness, no data',
    '/api/demo': 'demo-mode banner, no data',
    '/api/fhir/r4/metadata': 'FHIR CapabilityStatement — spec requires it be public',
    '/api/platform/languages': 'static list of supported languages, no data',
    '/api/drugs': 'public drug reference data, not patient-specific',
    '/api/interactions': 'public drug-interaction reference, not patient-specific',
    '/api/wearables/supported': 'static list of supported device types',
    '/api/auth/challenge': 'issues the challenge that begins authentication',
    '/api/auth/jwt/refresh': 'refresh flow validates the refresh token itself',
    '/api/auth/session': 'session-token creation validates its own inputs',
    '/api/auth/verify': 'verifies a presented token; that IS the check',
    '/api/auth/bootstrap': 'first-admin bootstrap, gated by MEDICHAIN_BOOTSTRAP_KEY',
    '/api/emergency/nfc-token': 'break-glass: validates the NFC card hash as its credential',
    '/api/emergency/grants': 'break-glass grant issuance; validates work context internally',
    '/api/simulate-nfc-tap': 'demo-only, gated by require_demo_mode (HZ-019)',
    '/api/national-id/verify': 'identity verification utility; no stored data returned',
    '/api/notifications/sms/inbound': 'inbound SMS webhook, authenticated by provider signature',
    '/api/appointments/slots/{provider_id}/{date}': 'public availability lookup, no patient data',
    '/api/telehealth/join/{session_id}': 'redirect to the telehealth app; session validated there',
    '/api/organizations/{organization_id}/keys/active': 'returns a public key by design',
    '/api/identity/context/work': 'establishes a work context; validates identity internally',
    '/api/identity/context/patient': 'establishes a patient context; validates identity internally',
    '/api/identity/context/switch': 'switches context; validates identity internally',
    '/api/medical-id/{patient_id}/emergency': 'break-glass: gated by a signed emergency token',
    '/api/platform/translate': 'now requires a known user (HZ-019)',
}

# Handlers that ARE authenticated but delegate the check to a helper function
# the static scan cannot follow (e.g. a thin wrapper calling `<name>_impl`).
# Each was confirmed authenticated by a live request during the HZ-019 pass
# (all returned 401 without credentials). Kept separate from PUBLIC_ROUTES
# because these are NOT public — the distinction matters.
DELEGATED_AUTH = {
    '/api/lab/review': 'delegates to review_lab_results_impl; live-verified 401',
    '/api/lab/submissions/{submission_id}/review': 'delegates to review_lab_results_impl; live-verified 401',
    '/api/mobile/devices/register': 'get_current_user_id via helper taking req; live-verified',
    '/api/mobile/records/authorise': 'get_current_user_id via helper taking req; live-verified',
    '/api/mobile/devices/{id}/revoke': 'get_current_user_id via helper taking req; live-verified 401',
    # Break-glass. These authorize through the identity-context / grant model
    # rather than the user store, which this scan cannot follow — they are
    # false positives of the tier classifier, NOT unprotected handlers:
    #   grant_bound_emergency_access requires an ACTIVE PROFESSIONAL identity
    #     context bound to the caller's wallet (data.identity_contexts
    #     .active_context(work_context_id, wallet), ContextType::Professional).
    #   get_emergency_grant performs a resource-ownership check
    #     (grant.requesting_person_id == user_id) and 403s on mismatch.
    # Deliberately NOT wrapped in require_registered_caller: emergency access is
    # safety-critical and an extra gate here risks blocking break-glass in the
    # exact situation it exists for. Re-verify by hand if either is changed.
    '/api/emergency/access': 'break-glass: requires an active Professional identity context',
    '/api/emergency/grants/{id}': 'break-glass: ownership-checked (requesting_person_id)',
}


def body_after(text: str, start: int) -> str:
    i = text.find('{', start)
    if i == -1:
        return ''
    depth, j = 0, i
    while j < len(text):
        if text[j] == '{':
            depth += 1
        elif text[j] == '}':
            depth -= 1
            if depth == 0:
                return text[i:j + 1]
        j += 1
    return text[i:]


# --------------------------------------------------------------------------
# Tiered classification.
#
# The original gate asked one question — "does this handler mention any auth
# marker?" — and `X-User-Id` was one of the markers. So a handler that merely
# READ the header passed, including handlers that then ran an unscoped
# `list_all()`. It reported "408 scanned, 0 unclassified, PASS" over exactly the
# endpoints an external review then walked straight through with a forged
# identity. A green result that does not distinguish "saw a header" from
# "authorized this caller for this resource" is worse than no gate, because
# release decisions get made on it.
#
# Tiers are ordered; a handler is classified at the highest tier it evidences.
# --------------------------------------------------------------------------
T_NONE, T_PRESENCE, T_KNOWN, T_ROLE, T_RESOURCE = 0, 1, 2, 3, 4

TIER_NAMES = {
    T_NONE: 'no auth decision',
    T_PRESENCE: 'identity PRESENCE only (header read, caller never verified)',
    T_KNOWN: 'registered identity resolved',
    T_ROLE: 'role authorization',
    T_RESOURCE: 'resource/patient scope authorization',
}

# Reads the header but proves nothing about who the caller is.
PRESENCE_MARKERS = ['X-User-Id', 'get_current_user_id', 'require_x_user_id_header',
                    'require_auth(']
# Resolves the caller against the user store — proves they are registered.
KNOWN_MARKERS = ['get_user(', 'get_current_user(', 'require_known_user', 'AuthorizedUser',
                 'require_registered_caller']
# Checks what the caller is allowed to do at all.
ROLE_MARKERS = ['require_admin', 'require_provider', 'is_healthcare_provider',
                'can_edit_medical_records', 'can_view_medical_records', 'is_admin(',
                'require_demo_mode', 'is_demo_mode',
                # Resolves the caller, requires a clinical role, audits the read.
                'require_registry_reader', 'require_clinical_staff']
# Ties the decision to the specific patient/resource being touched.
RESOURCE_MARKERS = ['resolve_patient_access', 'caller_may_access_patient',
                    'require_emergency_list_access', 'require_card_access',
                    'require_surgical_list_access', 'is_permitted()',
                    # Dedicated patient/device capability paths. The first
                    # resolves a registered user to their linked patient; the
                    # second cryptographically binds patient + active device.
                    'authenticated_patient_id', 'verify_lockscreen_token',
                    # Binds the acting identity in the body to the authenticated
                    # caller, so a clinical act cannot be attributed to someone
                    # else (`create_radiology_order`, WF-021).
                    'require_actor_is_caller',
                    # Resolves the caller and checks them against the patient in
                    # the path. Module-local in `handlers/patient_documents.rs`
                    # and `handlers/patient_self_service.rs`; both delegate to
                    # `may_read` / `may_write`, which compare the caller against
                    # the record owner.
                    'authorize(&data', 'may_read(', 'may_write(',
                    # Resolves the caller and loads the patient only if they own
                    # the record (`caller_owns_patient_record`), used by the
                    # patient self-service writes.
                    'authorize_and_load', 'caller_owns_patient_record']

# Unscoped bulk reads. `list_all()` returns every row for every organization;
# filtering afterwards in Rust is not isolation, and at 10-100 hospitals it is
# the multi-tenant breach path.
BULK_MARKERS = ['list_all(']

BASELINE = pathlib.Path(__file__).resolve().parent.parent / '.endpoint-auth-baseline'


def classify(scope: str) -> int:
    if any(k in scope for k in RESOURCE_MARKERS):
        return T_RESOURCE
    if any(k in scope for k in ROLE_MARKERS):
        return T_ROLE
    if any(k in scope for k in KNOWN_MARKERS):
        return T_KNOWN
    if any(k in scope for k in PRESENCE_MARKERS):
        return T_PRESENCE
    return T_NONE


def main() -> int:
    root = pathlib.Path(__file__).resolve().parent.parent / 'api' / 'src'
    unclassified, weak, bulk = [], [], []
    tiers = {t: 0 for t in TIER_NAMES}
    total = 0
    for path in sorted(root.rglob('*.rs')):
        text = path.read_text(encoding='utf-8', errors='replace')
        for m in ROUTE_ATTR.finditer(text):
            route = m.group(2)
            fm = FN_SIG.search(text, m.end())
            if not fm:
                continue
            total += 1
            sig_end = text.find('{', fm.end())
            sig = text[fm.end():sig_end] if sig_end != -1 else ''
            body = body_after(text, fm.end())
            scope = sig + body
            rel = str(path.relative_to(root.parent.parent))
            entry = (m.group(1).upper(), route, fm.group(1), rel)

            if route in PUBLIC_ROUTES or route in DELEGATED_AUTH:
                continue

            tier = classify(scope)
            tiers[tier] += 1
            if tier == T_NONE:
                unclassified.append(entry)
            elif tier == T_PRESENCE:
                weak.append(entry)
            if any(k in scope for k in BULK_MARKERS) and tier < T_RESOURCE:
                bulk.append(entry)

    print(f'endpoint-auth gate: {total} handlers scanned, '
          f'{len(PUBLIC_ROUTES)} allowlisted public, {len(DELEGATED_AUTH)} delegated')
    for t in sorted(TIER_NAMES, reverse=True):
        print(f'  tier {t} — {TIER_NAMES[t]:58} {tiers[t]:4}')
    print(f'  unscoped bulk reads (list_all without resource scope): {len(bulk)}')

    failed = False
    if unclassified:
        failed = True
        print('\nFAIL — no auth decision at all, and not on the public allowlist:\n')
        for method, route, fn, f in unclassified:
            print(f'  {method:6} {route:52} {fn}  ({f})')

    # Presence-only handlers are a RATCHET, not an immediate hard failure: there
    # is a real backlog of them and failing outright would just get the gate
    # disabled. The count may never rise. Delete the baseline file to re-record.
    prev = int(BASELINE.read_text().strip()) if BASELINE.exists() else None
    if prev is None:
        BASELINE.write_text(str(len(weak)))
        print(f'\n[baseline] recorded {len(weak)} presence-only handlers as the '
              f'ceiling. This count must not increase.')
    elif len(weak) > prev:
        failed = True
        print(f'\nFAIL — presence-only handlers rose {prev} -> {len(weak)}. '
              f'A new handler reads X-User-Id without verifying the caller.')
        for method, route, fn, f in weak:
            print(f'  {method:6} {route:52} {fn}  ({f})')
    elif len(weak) < prev:
        BASELINE.write_text(str(len(weak)))
        print(f'\n[baseline] presence-only handlers fell {prev} -> {len(weak)}; '
              f'ceiling tightened.')

    if weak:
        print(f'\nNOTE: {len(weak)} handler(s) only check that X-User-Id is PRESENT. '
              f'A forged header satisfies them. Run with --list-weak to enumerate.')
    if bulk:
        # Not a finding. ADR-0006 makes each hospital its own deployment and
        # ADR-0007 records the consequence: a clinician worklist is *meant* to be
        # deployment-wide, and startup refuses a database holding more than one
        # active organisation. The count stays printed so growth is still
        # visible, but calling it an exposure risk trained readers to ignore this
        # gate — and then to ignore the real findings alongside it.
        print(f'NOTE: {len(bulk)} handler(s) read deployment-wide via list_all(). '
              f'Intended scope for a single-organisation instance (ADR-0007); '
              f'enforced at startup by validate_single_organisation().')
    if '--list-weak' in sys.argv:
        print('\nPresence-only handlers:')
        for method, route, fn, f in weak:
            print(f'  {method:6} {route:52} {fn}  ({f})')
        print('\nUnscoped bulk reads:')
        for method, route, fn, f in bulk:
            print(f'  {method:6} {route:52} {fn}  ({f})')

    if failed:
        return 1
    print('\nPASS — no handler is entirely without an auth decision, and the '
          'presence-only backlog did not grow.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
