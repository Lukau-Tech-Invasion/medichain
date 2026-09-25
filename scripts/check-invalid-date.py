#!/usr/bin/env python3
"""Refuse `new Date(value).toLocale*String()` in the clients.

`new Date(undefined).toLocaleString()` is the literal string "Invalid Date",
and so is the same call on `null`, `''`, `NaN` or any unparseable string. A
screen that prints it has told a clinician something false about when a record
was made. The class was found, fixed locally and left to recur at least four
times before 83 sites were moved onto the shared formatters in one pass.

Use `formatTimestamp(value, options?)` or `formatDateOnly(value)` from
`@medichain/shared`. They answer `''` for an absent or unparseable value, so an
unrecorded time renders as nothing rather than as a false one.

`new Date()` -- now -- cannot be invalid and is allowed.

Usage:  python scripts/check-invalid-date.py
Exit:   0 clean, 1 if any client source formats an arbitrary value directly.
"""
import re
import sys
from pathlib import Path

# `new Date(<something>)` followed by `.toLocaleString(`, `.toLocaleDateString(`
# or `.toLocaleTimeString(`. The argument may contain one level of parentheses.
UNGUARDED = re.compile(
    r'new Date\((?P<arg>(?:[^()]|\([^()]*\))+)\)\s*\.toLocale(?:Date|Time)?String\('
)


def line_of(text, offset):
    return text.count('\n', 0, offset) + 1


def in_comment(text, offset):
    start = text.rfind('\n', 0, offset) + 1
    head = text[start:offset].lstrip()
    return head.startswith(('//', '*', '/*'))


def scan(root):
    findings = []
    for path in sorted(root.rglob('*')):
        if path.suffix not in ('.ts', '.tsx') or '.test.' in path.name:
            continue
        if 'node_modules' in path.parts or 'e2e' in path.parts:
            continue
        text = path.read_text(encoding='utf-8')
        for match in UNGUARDED.finditer(text):
            if in_comment(text, match.start()):
                continue
            findings.append((path, line_of(text, match.start()), match.group('arg').strip()))
    return findings


def main():
    repo = Path(__file__).resolve().parent.parent
    findings = []
    for app in ('doctor-portal', 'patient-app', 'shared'):
        root = repo / 'client' / app / 'src'
        if root.exists():
            findings.extend(scan(root))

    # The shared formatter is the one place allowed to call it, guarded.
    findings = [f for f in findings if not f[0].as_posix().endswith('shared/src/i18n/index.ts')]

    if not findings:
        print('check-invalid-date: every formatted timestamp goes through the shared formatters')
        return 0

    print(f'check-invalid-date: {len(findings)} unguarded date format(s)\n')
    for path, number, arg in findings:
        print(f'  {path.relative_to(repo)}:{number}  new Date({arg}).toLocale...()')
    print(
        '\nUse formatTimestamp / formatDateOnly from @medichain/shared. An absent '
        'or\nunparseable value otherwise renders as the words "Invalid Date".'
    )
    return 1


if __name__ == '__main__':
    sys.exit(main())
