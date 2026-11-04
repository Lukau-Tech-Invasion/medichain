#!/usr/bin/env python3
"""Every route the patient apps call is on the patient surface.

`api/src/middleware/patient_surface.rs` refuses a patient session on any route
it does not list (docs/PATIENT_SURFACE_PLAN.md). That closes a new staff route
to patients by default -- and would equally close a route the patient app has
just started calling, which shows up only as a 403 in a patient's hands.

This gate follows what `client/patient-app` and the Expo app in
`mobile-examples/` reach: their own `/api/...` calls, and every
`@medichain/shared` export they use, transitively. Each call that resolves to
a registered route must be on the surface. The API's own test
(`a_patient_reaches_exactly_the_listed_routes`) proves the other direction:
nothing unlisted is reachable.

A call with no registered route at all is reported as a note: it already
fails, for a different reason.

Usage:  python scripts/check-patient-surface.py
Exit:   0 clean, 1 if a patient-app call is missing from the surface.
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARED = ROOT / 'client/shared/src'
SURFACE = ROOT / 'api/src/middleware/patient_surface.rs'
PATIENT_ROOTS = [
    ROOT / 'client/patient-app/src',
    ROOT / 'mobile-examples/expo-starter/src',
    ROOT / 'mobile-examples/expo-starter/services',
]

ROUTE_RE = re.compile(r'#\[(get|post|put|patch|delete)\("([^"]+)"\)\]')
# rustfmt wraps a long entry across lines.
SURFACE_RE = re.compile(r'\(\s*"(GET|POST|PUT|PATCH|DELETE)",\s*"([^"]+)",?\s*\)')
# A method call whose first argument is a literal `/api/...` path.
CALL_RE = re.compile(
    r"""\.(get|post|put|patch|delete|getBlob|postBinary|postBlob)\s*(?:<[^()]*?>)?\(\s*([`'"])(/api/[^`'"]*)\2""",
    re.S,
)
ANY_RE = re.compile(r"""([`'"])(/api/[^`'"]*)\1""")
EXPORT_RE = re.compile(
    r'^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_]+)',
    re.M,
)
IDENT_RE = re.compile(r'\b[A-Za-z_][A-Za-z0-9_]*\b')
METHOD = {'get': 'GET', 'getBlob': 'GET', 'post': 'POST', 'postBinary': 'POST',
          'postBlob': 'POST', 'put': 'PUT', 'patch': 'PATCH', 'delete': 'DELETE'}


def shape(path: str) -> str:
    """`/x/${id}?q` and `/x/{patient_id}` both become `/x/{}`."""
    path = re.sub(r'\$\{[^}]*\}', '{}', path)
    path = re.sub(r'\{[^}]*\}', '{}', path)
    path = path.split('?', 1)[0].split('${', 1)[0].rstrip('/')
    # A trailing `{}` glued to a segment is a query-string suffix, not a segment.
    while re.search(r'[^/]\{\}$', path):
        path = path[:-2].rstrip('/')
    return path


def sources(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ('node_modules', 'testing', 'test', '__tests__')]
        for name in filenames:
            if name.endswith(('.ts', '.tsx')) and '.test.' not in name and '.spec.' not in name:
                yield Path(dirpath, name)


COMMENT_LINE = re.compile(r'^\s*(//|/\*|\*)')


def read(path: Path) -> str:
    """Source text without comment lines: a path in a doc comment is not a call."""
    text = path.read_text(encoding='utf-8', errors='ignore')
    return '\n'.join(line for line in text.splitlines() if not COMMENT_LINE.match(line))


def method_calls(text: str):
    return {(METHOD[m.group(1)], shape(m.group(3))) for m in CALL_RE.finditer(text)}


def shared_exports():
    """export name -> its source text, for every `@medichain/shared` export."""
    defs = {}
    for path in sources(SHARED):
        text = read(path)
        marks = list(EXPORT_RE.finditer(text))
        for i, mark in enumerate(marks):
            end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
            defs[mark.group(1)] = defs.get(mark.group(1), '') + text[mark.end():end]
    return defs


def reached_code():
    """The patient apps' own source plus every shared export they reach."""
    defs = shared_exports()
    names = set(defs)
    texts, pending = [], set()
    for root in PATIENT_ROOTS:
        if root.exists():
            for path in sources(root):
                text = read(path)
                texts.append(text)
                pending |= names & set(IDENT_RE.findall(text))
    done = set()
    while pending:
        name = pending.pop()
        done.add(name)
        pending |= (names & set(IDENT_RE.findall(defs[name]))) - done
    texts.extend(defs[name] for name in done)
    return texts


def main() -> int:
    registered = set()
    for rs in (ROOT / 'api/src').rglob('*.rs'):
        for verb, path in ROUTE_RE.findall(read(rs)):
            registered.add((verb.upper(), shape(path)))
    surface = {(m, shape(p)) for m, p in SURFACE_RE.findall(read(SURFACE))}
    registered_shapes = {p for _, p in registered}
    surface_shapes = {p for _, p in surface}

    missing, notes = set(), set()
    # The client's own session plumbing (refresh, sign-out) runs for everyone;
    # only its calls count, not the path constants it classifies requests by.
    plumbing = method_calls(read(SHARED / 'api/client.ts'))
    for method, path in plumbing - surface:
        if (method, path) in registered:
            missing.add(f'{method} {path}')
    for text in reached_code():
        captured = method_calls(text)
        for method, path in captured:
            if (method, path) in surface:
                continue
            (missing if (method, path) in registered else notes).add(f'{method} {path}')
        # Paths built away from the call (lookup tables, URL variables): the
        # method is not visible, so the path must be on the surface for some
        # method if it is a registered route at all.
        for match in ANY_RE.finditer(text):
            path = shape(match.group(2))
            if path in registered_shapes and path not in surface_shapes:
                missing.add(f'(any) {path}')

    for line in sorted(notes):
        print(f'note: patient app calls an unregistered route: {line}')
    if missing:
        print('Patient-app calls missing from api/src/middleware/patient_surface.rs:')
        for line in sorted(missing):
            print(f'  {line}')
        print('A patient session is refused on these. Add each to PATIENT_SURFACE '
              'if patients should reach it.')
        return 1
    print(f'patient surface: {len(surface)} routes, every patient-app call covered')
    return 0


if __name__ == '__main__':
    sys.exit(main())
