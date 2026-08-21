#!/usr/bin/env python3
"""Verify every semantic token pair clears WCAG AA contrast, in both themes.

The audit found pale text on pale backgrounds on a *critical value* screen -
the one place in the product where legibility is not a matter of taste
(docs/WORKFLOW_AUDIT.md, WF-018). Comments in a stylesheet claiming "9.9:1" are
worth nothing on their own, so this recomputes every ratio from the actual
token values and fails the build if one drops below its bar.

Usage:  python scripts/check-contrast.py [--verbose]
Exit:   0 all pairs pass, 1 otherwise.
"""
import re
import sys

TOKENS = 'client/shared/src/styles/tokens.css'

# Bars. Body text is the default; UI boundaries (borders, focus rings) only
# need to be distinguishable, which AA sets at 3:1.
AA_TEXT = 4.5
AA_UI = 3.0

# (foreground token, background token, bar, description)
PAIRS = [
    ('text-primary', 'surface', AA_TEXT, 'body text on a card'),
    ('text-primary', 'app-bg', AA_TEXT, 'body text on the page'),
    ('text-primary', 'surface-raised', AA_TEXT, 'body text in a modal'),
    ('text-primary', 'surface-sunken', AA_TEXT, 'body text in a well'),
    ('text-secondary', 'surface', AA_TEXT, 'supporting copy'),
    ('text-secondary', 'app-bg', AA_TEXT, 'supporting copy on the page'),
    ('text-muted', 'surface', AA_TEXT, 'captions'),
    ('text-muted', 'app-bg', AA_TEXT, 'captions on the page'),
    ('primary-fg', 'primary', AA_TEXT, 'primary button label'),
    ('primary-subtle-fg', 'primary-subtle-bg', AA_TEXT, 'primary badge'),
    ('success-fg', 'success', AA_TEXT, 'success button label'),
    ('success-subtle-fg', 'success-subtle-bg', AA_TEXT, 'success alert'),
    ('warning-fg', 'warning', AA_TEXT, 'warning button label'),
    ('warning-subtle-fg', 'warning-subtle-bg', AA_TEXT, 'warning alert'),
    ('danger-fg', 'danger', AA_TEXT, 'danger button label'),
    ('danger-subtle-fg', 'danger-subtle-bg', AA_TEXT, 'critical alert'),
    ('info-fg', 'info', AA_TEXT, 'info button label'),
    ('info-subtle-fg', 'info-subtle-bg', AA_TEXT, 'info alert'),
    ('selected-fg', 'selected-bg', AA_TEXT, 'selected row'),
    ('disabled-fg', 'disabled-bg', AA_TEXT, 'disabled control'),
    # A divider separates; it does not identify a component, so 1.4.11 does
    # not apply. It still has to be visible, hence a floor rather than none.
    ('border-strong', 'surface', 1.4, 'structural divider'),
    ('border-default', 'surface', 1.2, 'hairline border'),
    # The outline of an input or button *is* component information.
    ('border-interactive', 'surface', AA_UI, 'control boundary'),
    ('border-interactive', 'app-bg', AA_UI, 'control boundary on the page'),
    ('focus-ring', 'surface', AA_UI, 'focus ring on a card'),
    ('focus-ring', 'app-bg', AA_UI, 'focus ring on the page'),
]


def parse_blocks(text):
    """Return {theme: {token: (r, g, b)}} for the :root and .dark blocks."""
    themes = {}
    for selector, key in ((r':root', 'light'), (r'\.dark', 'dark')):
        m = re.search(selector + r'\s*\{(.*?)\n\}', text, re.S)
        if not m:
            sys.exit(f'could not find the {key} token block')
        values = {}
        for name, raw in re.findall(r'--([\w-]+):\s*([^;]+);', m.group(1)):
            nums = re.findall(r'\d+', raw.split('/')[0])
            if len(nums) == 3:
                values[name] = tuple(int(n) for n in nums)
        themes[key] = values
    # Dark only overrides; anything it omits is inherited from :root.
    merged = dict(themes['light'])
    merged.update(themes['dark'])
    themes['dark'] = merged
    return themes


def luminance(rgb):
    def channel(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg, bg):
    a, b = luminance(fg), luminance(bg)
    lighter, darker = max(a, b), min(a, b)
    return (lighter + 0.05) / (darker + 0.05)


def main():
    verbose = '--verbose' in sys.argv
    with open(TOKENS, encoding='utf-8') as fh:
        themes = parse_blocks(fh.read())

    failures = []
    checked = 0
    for theme, tokens in themes.items():
        for fg_name, bg_name, bar, label in PAIRS:
            if fg_name not in tokens or bg_name not in tokens:
                failures.append(f'{theme}: missing token {fg_name} or {bg_name}')
                continue
            r = ratio(tokens[fg_name], tokens[bg_name])
            checked += 1
            ok = r >= bar
            if not ok:
                failures.append(
                    f'{theme}: {label} ({fg_name} on {bg_name}) '
                    f'is {r:.2f}:1, needs {bar}:1'
                )
            if verbose:
                print(f'  {"PASS" if ok else "FAIL"} {theme:5} {r:6.2f}:1  {label}')

    print(f'\nchecked {checked} token pairs across {len(themes)} themes')
    if failures:
        print(f'{len(failures)} FAILED:\n', file=sys.stderr)
        for f in failures:
            print(f'  {f}', file=sys.stderr)
        return 1
    print('all pairs meet WCAG AA')
    return 0


if __name__ == '__main__':
    sys.exit(main())
