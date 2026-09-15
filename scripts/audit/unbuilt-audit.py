"""Which write endpoints have no producer screen?

Three earlier attempts at this were wrong, each in a different way, and the
corrections are the reason this file exists:

1. Searching page sources for literal URL strings. Pages call the **shared
   endpoint functions**, so the URL appears only in `endpoints.ts`. Every one of
   the six findings was false.
2. Matching shared functions by call site. `import { analyzeSymptoms as
   analyzeSymptomAPI }` defeats that, so the symptom checker read as unused
   while a passing journey step proved otherwise.
3. Matching by URL *stem* -- the literal prefix before the first parameter.
   `/api/insurance/cards`, `/api/insurance/cards/{id}` and
   `/api/insurance/cards/{id}/image` all collapse to the same key, so a used
   route vouched for two unused siblings.

This matches on the **full URL shape**: every path parameter, on both sides,
normalised to `{}`. A route counts as reachable if a shared function with that
exact shape is imported anywhere in either client, or if the raw URL appears in
a client file.

Output is still only a candidate list. Every candidate needs looking at before
it is reported: a route can be superseded by a sibling the page uses instead,
or be machine-to-machine by design.
"""
import json
import os
import re

API = os.path.join('api', 'src')
SHARED = os.path.join('client', 'shared', 'src', 'api', 'endpoints.ts')
ROOTS = [
    os.path.join('client', 'doctor-portal', 'src'),
    os.path.join('client', 'patient-app', 'src'),
    os.path.join('client', 'shared', 'src'),
]

WRITE = re.compile(r'#\[(post|put|patch|delete)\("(/api/[^"]*)"\)\]')


def shape(url):
    """Normalise every path parameter to `{}` so shapes compare exactly."""
    url = re.sub(r'\$\{[^}]*\}', '{}', url)   # `${id}` in a TS template
    url = re.sub(r'\{[^}]*\}', '{}', url)     # `{id}` in a Rust route
    return url.rstrip('/')


def api_routes():
    out = {}
    for d, _dd, ff in os.walk(API):
        for n in sorted(ff):
            if n.endswith('.rs'):
                src = open(os.path.join(d, n), encoding='utf-8').read()
                for m in WRITE.finditer(src):
                    out.setdefault(m.group(2), m.group(1).upper())
    return out


def shared_functions():
    src = open(SHARED, encoding='utf-8').read()
    out = {}
    for m in re.finditer(r'export async function (\w+)\s*[(<]', src):
        name, start = m.group(1), m.end()
        nxt = src.find('\nexport ', start)
        body = src[start: nxt if nxt != -1 else len(src)]
        for u in re.findall(r"['\"`](/api/[^'\"`]*)['\"`]", body):
            out.setdefault(shape(u), set()).add(name)
    return out


def client_sources():
    imported, blobs = set(), []
    for root in ROOTS:
        for d, _dd, ff in os.walk(root):
            if 'node_modules' in d:
                continue
            for n in sorted(ff):
                if not n.endswith(('.ts', '.tsx')) or n.endswith('.test.tsx'):
                    continue
                p = os.path.join(d, n)
                if os.path.abspath(p) == os.path.abspath(SHARED):
                    continue
                t = open(p, encoding='utf-8').read()
                blobs.append(t)
                for m in re.finditer(r'import\s*\{([^}]*)\}\s*from', t, re.S):
                    for spec in m.group(1).split(','):
                        name = spec.strip().split(' as ')[0].strip()
                        if name:
                            imported.add(name)
    return imported, '\n'.join(blobs)


def main():
    routes = api_routes()
    by_shape = shared_functions()
    imported, blob = client_sources()

    # Raw URLs written in client code, normalised the same way.
    raw = {shape(u) for u in re.findall(r"['\"`](/api/[^'\"`]*)['\"`]", blob)}

    unreachable = []
    for url, method in sorted(routes.items()):
        s = shape(url)
        fns = by_shape.get(s, set())
        if any(f in imported for f in fns) or s in raw:
            continue
        unreachable.append({'method': method, 'url': url,
                            'shared_functions': sorted(fns)})

    print('API write routes: %d' % len(routes))
    print('No producer in either client: %d' % len(unreachable))
    print()
    for r in unreachable:
        print('%-6s %-58s %s' % (r['method'], r['url'],
                                 ', '.join(r['shared_functions']) or '(none)'))

    with open(os.path.join('scripts', 'audit', 'unbuilt-candidates.json'), 'w',
              encoding='utf-8') as fh:
        json.dump(unreachable, fh, indent=2)


if __name__ == '__main__':
    main()
