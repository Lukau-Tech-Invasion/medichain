#!/usr/bin/env python3
"""List backend routes that no frontend calls, grouped by owning module.

WHY THIS EXISTS
---------------
`check-endpoint-drift.py` answers "does every frontend call reach a route?".
This answers the opposite, and more awkward, question: "which routes does
nothing call?" A route with no caller is one of three things, and they need
opposite responses:

  * a feature that was never finished on the frontend  -> finish it
  * a feature superseded by another route              -> plan its removal
  * an integration/ops endpoint with no UI by design   -> leave it, document it

The script cannot tell these apart, so it deliberately does not guess or
delete. It produces the worklist a human triages.

Usage:  python scripts/unused-endpoints.py [--csv]
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_SRC = ROOT / 'api' / 'src'
CLIENT_SRC = ROOT / 'client'

ROUTE_RE = re.compile(r'#\[(get|post|put|patch|delete)\("([^"]+)"\)\]')
# Frontend call sites: apiUrl('/api/..'), getApiClient().get('/api/..'), fetch('/api/..')
CALL_RE = re.compile(r"""['"`](/api/[^'"`\s?]+)""")


def normalise(path: str) -> str:
    """Collapse path parameters so `/x/{id}` and `/x/${id}` compare equal."""
    path = re.sub(r'\$\{[^}]*\}', '{}', path)
    path = re.sub(r'\{[^}]*\}', '{}', path)
    return path.rstrip('/')


def backend_routes():
    routes = {}
    for rs in API_SRC.rglob('*.rs'):
        if 'tests' in rs.name:
            continue
        text = rs.read_text(encoding='utf-8', errors='ignore')
        for verb, path in ROUTE_RE.findall(text):
            routes.setdefault(normalise(path), []).append(
                (verb.upper(), path, rs.relative_to(ROOT).as_posix())
            )
    return routes


def frontend_calls():
    called = set()
    # Walk explicitly and prune node_modules: rglob descends into it first and
    # dies on the broken `@medichain/wasm-crypto` symlink before any filtering.
    import os
    for base in ('doctor-portal/src', 'patient-app/src', 'shared/src'):
        root = CLIENT_SRC / base
        if not root.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d != 'node_modules']
            for name in filenames:
                if not name.endswith(('.ts', '.tsx')) or '.test.' in name:
                    continue
                text = Path(dirpath, name).read_text(encoding='utf-8', errors='ignore')
                for path in CALL_RE.findall(text):
                    called.add(normalise(path))
    return called


def main() -> int:
    routes = backend_routes()
    called = frontend_calls()
    unused = {p: v for p, v in routes.items() if p not in called}

    by_module = defaultdict(list)
    for path, entries in unused.items():
        for verb, raw, src in entries:
            module = src.replace('api/src/', '').rsplit('/', 1)[0]
            by_module[module].append((verb, raw))

    if '--csv' in sys.argv:
        print('module,verb,path')
        for module in sorted(by_module):
            for verb, raw in sorted(by_module[module]):
                print(f'{module},{verb},{raw}')
        return 0

    total = sum(len(v) for v in by_module.values())
    print(f'backend routes: {len(routes)}   frontend-called: {len(routes) - len(unused)}   '
          f'uncalled: {len(unused)} paths / {total} verb+path pairs\n')
    for module in sorted(by_module, key=lambda m: -len(by_module[m])):
        print(f'{module}  ({len(by_module[module])})')
        for verb, raw in sorted(by_module[module]):
            print(f'    {verb:6} {raw}')
        print()
    print('Triage each as: unfinished feature / superseded / intentionally UI-less.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
