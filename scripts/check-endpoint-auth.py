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


def main() -> int:
    root = pathlib.Path(__file__).resolve().parent.parent / 'api' / 'src'
    unclassified = []
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
            if any(k in scope for k in AUTH_MARKERS):
                continue
            if route in PUBLIC_ROUTES or route in DELEGATED_AUTH:
                continue
            unclassified.append((m.group(1).upper(), route, fm.group(1),
                                 str(path.relative_to(root.parent.parent))))

    print(f'endpoint-auth gate: {total} handlers scanned, '
          f'{len(PUBLIC_ROUTES)} allowlisted public, '
          f'{len(DELEGATED_AUTH)} delegated, '
          f'{len(unclassified)} unclassified')
    if unclassified:
        print('\nFAIL — these handlers have no auth decision and are not on the '
              'public allowlist:\n')
        for method, route, fn, f in unclassified:
            print(f'  {method:6} {route:52} {fn}  ({f})')
        print('\nFix by adding an auth check to the handler, or — if it is '
              'genuinely public — adding it to PUBLIC_ROUTES with a reason.')
        return 1
    print('PASS — every handler authenticates, authorizes, or is a justified public route.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
