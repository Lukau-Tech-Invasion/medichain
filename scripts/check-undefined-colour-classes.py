#!/usr/bin/env python3
"""Refuse a colour class the app's Tailwind configuration does not define.

Tailwind emits nothing for a class it does not recognise -- no error, no
warning, no style. The element then takes whatever colour happens to be around
it. The patient app used `bg-warning-100 text-warning-800` on its sign-in page
and emergency card, and it has no `warning` palette: in dark mode the demo
wallet button rendered at 1.0:1, the page's own text colour on the page's own
background, because the classes that were meant to colour it did not exist.

This reads each app's `tailwind.config.js` for the colour families and keys it
extends, adds Tailwind's default palette, and checks every colour utility in
that app's source against the union. A semantic name that belongs to the OTHER
app (or to no app) is exactly what it is built to catch.

Usage:  python scripts/check-undefined-colour-classes.py [--verbose]
Exit:   0 clean, 1 if any source uses a colour class its app does not define.
"""
import re
import sys
from pathlib import Path

DEFAULT_FAMILIES = {
    'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow',
    'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
    'purple', 'fuchsia', 'pink', 'rose',
}
DEFAULT_SHADES = {'50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'}
BARE = {'white', 'black', 'transparent', 'current', 'inherit'}
# Names worth policing even when neither config defines them: the semantic words
# people reach for. Anything else unrecognised is not a colour utility at all
# (`text-xs`, `border-dashed`, `bg-cover`) and is left alone.
SEMANTIC_GUESSES = {
    'warning', 'danger', 'error', 'info', 'success', 'primary', 'secondary', 'accent',
    'muted', 'health', 'emergency', 'critical', 'notice', 'caution', 'ok', 'brand',
    'surface', 'content', 'disabled', 'selected', 'focus', 'app',
}
UTILITIES = ('bg', 'text', 'border', 'from', 'via', 'to', 'ring', 'divide', 'placeholder',
             'fill', 'stroke', 'outline', 'accent', 'caret', 'decoration', 'ring-offset')
TOKEN = re.compile(
    r'(?<![\w/-])(?:[\w-]+:)*(' + '|'.join(sorted(UTILITIES, key=len, reverse=True)) +
    r')-([a-z]+(?:-[a-z0-9]+)*?)(?:/\d+)?(?![\w/-])'
)


def config_colours(config: Path) -> dict:
    """{family: set(keys)} from the `colors: {...}` block of a tailwind config."""
    text = config.read_text(encoding='utf-8')
    start = text.index('colors:')
    i = text.index('{', start)
    depth, j = 0, i
    while True:
        if text[j] == '{':
            depth += 1
        elif text[j] == '}':
            depth -= 1
            if depth == 0:
                break
        j += 1
    block = text[i + 1:j]
    families: dict = {}
    k, n = 0, len(block)
    while k < n:
        m = re.compile(r"\s*(?://[^\n]*\n\s*)*'?([\w-]+)'?\s*:\s*").match(block, k)
        if not m:
            k += 1
            continue
        name = m.group(1)
        k = m.end()
        if block[k] == '{':
            depth, e = 0, k
            while True:
                if block[e] == '{':
                    depth += 1
                elif block[e] == '}':
                    depth -= 1
                    if depth == 0:
                        break
                e += 1
            inner = block[k + 1:e]
            keys = set(re.findall(r"^\s*'?([\w-]+)'?\s*:", inner, re.M))
            families[name] = {('' if key == 'DEFAULT' else key) for key in keys}
            k = e + 1
        else:
            families[name] = {''}
            k = block.find(',', k) + 1 or n
    return families


def defined(family: str, key: str, config: dict) -> bool:
    if family in config:
        return key in config[family]
    if family in DEFAULT_FAMILIES:
        return key in DEFAULT_SHADES
    return False


def split(name: str, config: dict):
    """('content', 'muted') for 'content-muted'; the longest known family prefix wins."""
    parts = name.split('-')
    for cut in range(len(parts), 0, -1):
        family = '-'.join(parts[:cut])
        if family in config or family in DEFAULT_FAMILIES or family in SEMANTIC_GUESSES:
            return family, '-'.join(parts[cut:])
    return None, None


def scan(app: Path, verbose: bool):
    config = config_colours(app / 'tailwind.config.js')
    findings = []
    roots = [app / 'src', app.parent / 'shared' / 'src']
    for root in roots:
        for path in sorted(root.rglob('*.ts*')):
            if '.test.' in path.name or path.suffix not in ('.ts', '.tsx'):
                continue
            for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
                for m in TOKEN.finditer(line):
                    name = m.group(2)
                    if name in BARE:
                        continue
                    family, key = split(name, config)
                    if family is None:
                        continue
                    if not defined(family, key, config):
                        findings.append((path, number, m.group(0)))
    if verbose:
        print(f'  {app.name}: families {sorted(config)}')
    return findings


def main():
    verbose = '--verbose' in sys.argv
    repo = Path(__file__).resolve().parent.parent
    findings = []
    for app in ('doctor-portal', 'patient-app'):
        for path, number, token in scan(repo / 'client' / app, verbose):
            findings.append((app, path, number, token))

    if not findings:
        print('check-undefined-colour-classes: every colour class is defined by its app')
        return 0
    print(f'check-undefined-colour-classes: {len(findings)} class(es) that generate no CSS\n')
    for app, path, number, token in findings:
        print(f'  [{app}] {path.relative_to(repo)}:{number}  {token}')
    print(
        '\nTailwind emits nothing for these, so the element silently takes the colour '
        'around it.\nUse a semantic token the app defines (bg-caution-subtle, '
        'text-critical-subtle-fg, ...).'
    )
    return 1


if __name__ == '__main__':
    sys.exit(main())
