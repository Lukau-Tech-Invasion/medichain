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

A FALSE POSITIVE HERE COSTS A REAL INVESTIGATION
------------------------------------------------
Two endpoints were reported uncalled for a week while both had callers, because
the extractor was a regex that stopped at the first `?`:

    `/api/admin/cds/audit${query ? `?${query}` : ''}`

It captured `/api/admin/cds/audit${query` and matched nothing. Somebody then
spends an afternoon proving the feature exists. So the extractor is now a
brace-balancing scan rather than a regex: it walks a template literal, replaces
each complete `${...}` with `{}` (nested braces, nested backticks and all), and
stops at the closing quote.

That leaves one genuine ambiguity. An interpolation appended with no `/` before
it -- `/api/x/${id}${query ? ... : ''}` -- may be a query-string suffix rather
than a path segment, and which it is cannot be known without evaluating it. So
a call site offers every reading: the full path, and the path with each such
trailing suffix dropped. A route counts as called if it matches any of them.
The cost of that choice is a route that could be wrongly counted as called;
the alternative cost is the afternoon above, every time.

Usage:  python scripts/unused-endpoints.py [--csv]
"""
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_SRC = ROOT / 'api' / 'src'
CLIENT_SRC = ROOT / 'client'

ROUTE_RE = re.compile(r'#\[(get|post|put|patch|delete)\("([^"]+)"\)\]')
# Where a call site starts: a quote or backtick immediately followed by `/api/`.
CALL_START_RE = re.compile(r"""(['"`])(?=/api/)""")


def normalise(path: str) -> str:
    """Collapse path parameters so `/x/{id}` and `/x/${id}` compare equal."""
    path = re.sub(r'\$\{[^}]*\}', '{}', path)
    path = re.sub(r'\{[^}]*\}', '{}', path)
    path = path.split('?', 1)[0]
    return path.rstrip('/')


def extract_call_paths(text: str):
    """Yield the path expression of every `/api/...` string in `text`.

    Each complete `${...}` becomes `{}`. Unlike a regex this survives nested
    braces and the nested backticks of a conditional query-string suffix.
    """
    for match in CALL_START_RE.finditer(text):
        quote = match.group(1)
        index = match.end()
        out = []
        while index < len(text):
            char = text[index]
            if char == quote or char == '\n':
                break
            if char == '$' and text.startswith('${', index):
                depth = 0
                scan = index + 1
                while scan < len(text):
                    if text[scan] == '{':
                        depth += 1
                    elif text[scan] == '}':
                        depth -= 1
                        if depth == 0:
                            break
                    scan += 1
                else:
                    # Unterminated: not something to guess about.
                    break
                out.append('{}')
                index = scan + 1
                continue
            out.append(char)
            index += 1
        if out:
            yield ''.join(out)


def readings(raw: str):
    """Every path a single call site could produce.

    A trailing `{}` with no `/` before it is a suffix expression -- a
    conditional query string, an appended fragment -- as often as it is part of
    a segment, so both readings are offered.
    """
    path = normalise(raw)
    forms = {path}
    while re.search(r'[^/]\{\}$', path):
        path = normalise(path[:-2])
        forms.add(path)
    return forms


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
    """Every path a shipped client (the two web apps, or the Expo app) calls."""
    called = set()
    # Walk explicitly and prune node_modules: rglob descends into it first and
    # dies on the broken `@medichain/wasm-crypto` symlink before any filtering.
    # The Expo app under mobile-examples/ is a client too: it is the only
    # caller of `/api/my-records` and `/api/nfc/verify-mine`, and a report
    # that ignored it would recommend deleting what it depends on.
    for root in (
        CLIENT_SRC / 'doctor-portal/src',
        CLIENT_SRC / 'patient-app/src',
        CLIENT_SRC / 'shared/src',
        ROOT / 'mobile-examples/expo-starter/src',
        ROOT / 'mobile-examples/expo-starter/services',
    ):
        if not root.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d != 'node_modules']
            for name in filenames:
                if not name.endswith(('.ts', '.tsx')) or '.test.' in name:
                    continue
                text = Path(dirpath, name).read_text(encoding='utf-8', errors='ignore')
                for raw in extract_call_paths(text):
                    called.update(readings(raw))
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
