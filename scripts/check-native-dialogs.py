#!/usr/bin/env python3
"""Refuse `window.prompt`, `window.confirm` and `window.alert` in the clients.

A native dialog is drawn by the browser, not by the application. It ignores
the theme -- a white box over a dark page -- and cannot be read in context by
a screen reader. Worse, it can be suppressed: embedded browsers and
cross-origin frames answer `prompt()` with `null` without showing anything,
and every handler here reads `null` as "the user cancelled".

That is how the pharmacist's Dispense button came to do nothing at all during
a rehearsed demo: no dialog, no error, no request. Seventeen controls across
both applications were built on a native dialog.

Use `confirmDialog` / `promptDialog` from `@medichain/shared` instead. They
keep the native return values, so a call site changes by one `await`.

Usage:  python scripts/check-native-dialogs.py
Exit:   0 clean, 1 if any client source calls a native dialog.
"""
import re
import sys
from pathlib import Path

# `window.prompt(`, and the bare global forms `prompt(` / `confirm(` / `alert(`
# -- but not a method of some other object (`foo.confirm(`) or an identifier
# that merely ends in one of the words (`onConfirm(`, `showAlert(`).
NATIVE = re.compile(r'(?:\bwindow\.|(?<![\w.$]))(prompt|confirm|alert)\s*\(')
COMMENT = re.compile(r'^\s*(//|\*|/\*)')


def scan(root):
    findings = []
    for path in sorted(root.rglob('*')):
        if path.suffix not in ('.ts', '.tsx') or '.test.' in path.name:
            continue
        if 'node_modules' in path.parts:
            continue
        for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            if COMMENT.match(line):
                continue
            # Ignore anything after a trailing `//` comment on the line.
            code = line.split('//', 1)[0]
            for match in NATIVE.finditer(code):
                # A declaration of a function with the same name is not a call.
                before = code[: match.start()]
                if re.search(r'\b(function|const|let|var|async)\s*$', before):
                    continue
                findings.append((path, number, match.group(1)))
    return findings


def main():
    repo = Path(__file__).resolve().parent.parent
    findings = []
    for app in ('doctor-portal', 'patient-app', 'shared'):
        root = repo / 'client' / app / 'src'
        if root.exists():
            findings.extend(scan(root))

    if not findings:
        print('check-native-dialogs: no client source calls a native browser dialog')
        return 0

    print(f'check-native-dialogs: {len(findings)} native dialog call(s)\n')
    for path, number, name in findings:
        print(f'  {path.relative_to(repo)}:{number}  {name}()')
    print(
        '\nUse confirmDialog / promptDialog from @medichain/shared. A native '
        'dialog\nignores the theme and can be suppressed, which makes the '
        'control silently\ndo nothing.'
    )
    return 1


if __name__ == '__main__':
    sys.exit(main())
