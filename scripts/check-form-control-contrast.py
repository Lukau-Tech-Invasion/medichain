#!/usr/bin/env python3
"""Refuse a form control that would be painted by the browser, not the theme.

`check-contrast.py` verifies the token pairs and `check-token-pairing.py`
verifies that components use them together. Neither can see this one, and
neither could the live DOM audit that preceded them: **an `<input>`'s value is
not a text node.** Every probe that walked `childNodes` looking for text
measured the labels around a field and never the field itself, and one of
those audits is quoted in `themeStore.ts` as evidence that dark mode was
clean -- "88 elements sampled, 0 below WCAG AA".

What it missed: 88 inputs, textareas and selects across 18 files declared no
background and no text colour at all. They fell back to the browser's defaults
inside a themed page, which in dark mode is how the patient insurance form
came to be white boxes with white text in them -- the control painted from the
light palette, the value inheriting the dark page's light foreground.

Both applications now style form controls from the semantic tokens in a base
layer, so a control needs no classes of its own to be correct. This gate is
about the case that breaks that: a control that sets ONE side. `bg-white` with
no foreground, or `text-content` with no background, re-opens exactly the gap
the base layer closes, because a utility class beats an element selector.

Usage:  python scripts/check-form-control-contrast.py [--verbose]
Exit:   0 clean, 1 if any control sets one side of the pair and not the other.
"""
import re
import sys
from pathlib import Path

CONTROL = re.compile(
    r'<(input|textarea|select)\b[^>]*?class(?:Name)?\s*=\s*'
    r'(?:"([^"]*)"|\{`([^`]*)`\}|\{\s*"([^"]*)"\s*\})',
    re.S,
)

# `text-sm` and friends are typography, not colour.
TEXT_SIZING = re.compile(
    r'^text-(xs|sm|base|lg|xl|\d?xl|left|right|center|justify|wrap|nowrap|balance|ellipsis|clip)$'
)


def colours(class_list):
    """(sets a background, sets a foreground) for one class list."""
    has_bg = False
    has_fg = False
    for raw in class_list.split():
        cls = raw.split(':')[-1]
        if cls.startswith('bg-'):
            has_bg = True
        elif cls.startswith('text-') and not TEXT_SIZING.match(cls):
            has_fg = True
    return has_bg, has_fg


def scan(root, verbose):
    findings = []
    for path in sorted(root.rglob('*.tsx')):
        if '.test.' in path.name:
            continue
        text = path.read_text(encoding='utf-8')
        for match in CONTROL.finditer(text):
            tag = match.group(1)
            element = match.group(0)
            # A checkbox or radio has no text and no fillable box: the browser
            # draws it, `accent-color` tints it, and `text-*` on one is the
            # colour of the CHECK rather than of any text. Judging those by the
            # same rule reports a background nobody should set.
            if re.search(r'type\s*=\s*[\'"]?\{?\s*[\'"]?(checkbox|radio)', element):
                continue
            raw = next((g for g in match.groups()[1:] if g is not None), '')
            # A template literal's ${...} holds conditional classes; the
            # literal parts are what can be checked statically.
            raw = re.sub(r'\$\{[^}]*\}', ' ', raw)
            has_bg, has_fg = colours(raw)
            # Neither side is fine: the base layer styles it.
            if not has_bg and not has_fg:
                continue
            if has_bg and has_fg:
                continue
            line = text[: match.start()].count('\n') + 1
            missing = 'a text colour' if has_bg else 'a background'
            findings.append((path, line, tag, missing))
    if verbose:
        print(f'  scanned {root}')
    return findings


def main():
    verbose = '--verbose' in sys.argv
    repo = Path(__file__).resolve().parent.parent
    findings = []
    for app in ('patient-app', 'doctor-portal', 'shared'):
        root = repo / 'client' / app / 'src'
        if root.exists():
            findings.extend(scan(root, verbose))

    if not findings:
        print('check-form-control-contrast: no form control sets one half of a colour pair')
        return 0

    print(
        f'check-form-control-contrast: {len(findings)} form control(s) set one '
        f'side of the pair and not the other\n'
    )
    for path, line, tag, missing in findings:
        print(f'  {path.relative_to(repo)}:{line}  <{tag}> is missing {missing}')
    print(
        '\nEither set both, or set neither and let the base-layer rule in '
        'index.css\nstyle it from the tokens. Setting one side means the other '
        'comes from the\nbrowser, which does not know which theme the page is in.'
    )
    return 1


if __name__ == '__main__':
    sys.exit(main())
