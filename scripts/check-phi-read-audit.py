#!/usr/bin/env python3
"""Fail the build when a patient-scoped GET route has no disclosure-audit decision.

MediChain promises every patient that they can see who read their record,
when, why and what. That promise is kept by one chokepoint,
`api/src/middleware/phi_access_audit.rs`, driven by the `PHI_READ_ROUTES`
registry. A route missing from the registry is read without leaving a trace,
and nothing else in the build would notice.

This gate reads every `#[get("...")]` attribute under `api/src`, keeps the ones
whose path carries a patient parameter, and requires each to appear in the
registry (either as a middleware-audited `route(...)` or as a
`handler_audited(...)` entry whose handler writes its own row). It also fails
on registry entries that no longer match a real route, so the list cannot rot.

Usage:  python scripts/check-phi-read-audit.py
Exit 0 = every patient-scoped GET route has an explicit audit decision.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "api" / "src"
REGISTRY = SRC / "middleware" / "phi_access_audit.rs"

# Path parameters that identify the patient whose data a route returns.
PATIENT_PARAMS = ("{patient_id}", "{ward_patient_id}")

GET_ATTRIBUTE = re.compile(r'#\[get\("([^"]+)"\)\]')
# `route("...", ...)`, `handler_audited("...", ...)` and struct-literal
# `pattern: "..."` entries inside the registry.
REGISTRY_ENTRY = re.compile(r'(?:route|handler_audited)\(\s*"([^"]+)"|pattern:\s*"([^"]+)"')


def patient_scoped_get_routes() -> set[str]:
    """Return every registered GET pattern that names a patient parameter."""
    routes: set[str] = set()
    for path in SRC.rglob("*.rs"):
        if path == REGISTRY:
            continue
        for match in GET_ATTRIBUTE.finditer(path.read_text(encoding="utf-8")):
            pattern = match.group(1)
            if any(param in pattern for param in PATIENT_PARAMS):
                routes.add(pattern)
    return routes


def registry_patterns() -> set[str]:
    """Return every pattern declared in PHI_READ_ROUTES."""
    text = REGISTRY.read_text(encoding="utf-8")
    start = text.index("pub const PHI_READ_ROUTES")
    end = text.index("];", start)
    body = text[start:end]
    return {first or second for first, second in REGISTRY_ENTRY.findall(body)}


def main() -> int:
    """Compare the two sets and report every difference."""
    routes = patient_scoped_get_routes()
    registered = registry_patterns()
    missing = sorted(routes - registered)
    stale = sorted(registered - routes)
    if missing:
        print("Patient-scoped GET routes with no disclosure-audit decision:")
        for pattern in missing:
            print(f"  {pattern}")
        print("Add each to PHI_READ_ROUTES in api/src/middleware/phi_access_audit.rs.")
    if stale:
        print("PHI_READ_ROUTES entries that match no registered GET route:")
        for pattern in stale:
            print(f"  {pattern}")
    if missing or stale:
        return 1
    print(f"PHI read audit: {len(routes)} patient-scoped GET routes, all classified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
