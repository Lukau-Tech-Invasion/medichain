#!/usr/bin/env python3
"""Refuse animations that loop on their own: `animate-pulse`, `animate-bounce`
and `animate-ping`.

The motion storyboard (docs/ux-mockups/c10-motion-storyboard.html) lists what
never moves: flashing alerts, shimmering skeletons, bounces, anything that
moves for more than five seconds by itself. A critical alert rises once and
then stays still until it is acknowledged -- a pulsing one competes with the
next alert for attention, and on a ward there is always a next one.

On 2026-11-09 seventeen places pulsed or bounced: critical-alert sirens and
badges, overdue doses, the offline banner, six loading skeletons, a "typing"
indicator. Each became still.

Loading spinners (`animate-spin`) are kept on purpose (owner decision,
2026-11-09): they say work is in progress, and reduced motion already stops
them (shared/src/styles/motion.css). Use `.mc-rise` for something that should
draw the eye once.

Usage:  python scripts/check-looping-motion.py
Exit:   0 clean, 1 if any client source uses a looping animation.
"""
import re
import sys
from pathlib import Path

LOOPING = re.compile(r'\banimate-(pulse|bounce|ping)\b')


def scan(root):
    findings = []
    for path in sorted(root.rglob('*')):
        if path.suffix not in ('.ts', '.tsx', '.css') or '.test.' in path.name:
            continue
        if 'node_modules' in path.parts:
            continue
        for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            for match in LOOPING.finditer(line):
                findings.append((path, number, match.group(0)))
    return findings


def main():
    repo = Path(__file__).resolve().parent.parent
    findings = []
    for app in ('doctor-portal', 'patient-app', 'shared'):
        root = repo / 'client' / app / 'src'
        if root.exists():
            findings.extend(scan(root))

    if not findings:
        print('check-looping-motion: nothing pulses, bounces or pings')
        return 0

    print(f'check-looping-motion: {len(findings)} looping animation(s)\n')
    for path, number, name in findings:
        print(f'  {path.relative_to(repo)}:{number}  {name}')
    print('\nNothing moves on its own for more than 5 s (c10). Use .mc-rise to '
          'draw the eye once.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
