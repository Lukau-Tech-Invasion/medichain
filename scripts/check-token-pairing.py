#!/usr/bin/env python3
"""Refuse a component that mixes a theme-flipping token with a fixed shade.

`check-contrast.py` proves every semantic PAIR is legible -- that
`--danger-subtle-fg` on `--danger-subtle-bg` clears AA in both themes. That is
necessary and it is not sufficient, because a component does not have to use a
pair. It can take its foreground from a token that flips with the theme and its
background from a Tailwind shade that does not, and then no amount of care in
`tokens.css` saves it.

That is not hypothetical. The patient dashboard's critical-allergy panel was a
`.warning-card` -- `@apply bg-emergency-50`, light in both themes -- holding
text written as `text-critical-subtle-fg`, which in dark mode becomes near
white. Measured in the running application: **1.03:1**. The word "Allergies"
and the allergy itself were invisible to the person whose allergy it is, and
every token-level check passed while it was.

So this checks the other half: within one element's class list, a flipping
foreground must not sit on a frozen background, and a flipping background must
not carry frozen text. Component classes declared with `@apply` are expanded
first, because that is where the mismatch hid.

Usage:  python scripts/check-token-pairing.py [--verbose]
Exit:   0 clean, 1 if any element pairs a flipping token with a frozen shade.
"""
import re
import sys
from pathlib import Path

# The semantic families exposed in each tailwind.config.js. Every utility built
# from one of these reads a CSS variable that has a separate `.dark` value, so
# it repaints with the theme.
FLIPPING_FAMILIES = (
    'brand', 'ok', 'caution', 'critical', 'notice', 'selected', 'disabled',
    'muted', 'content', 'surface', 'border', 'focus', 'emphasis',
)

# A numbered shade is frozen only when the config gives it a literal hex. Some
# are not: the patient app defines `primary.500` as `rgb(var(--primary))`, so
# `bg-primary-500` repaints with the theme and pairing `text-brand-fg` with it
# is correct. Reading the config rather than assuming is the difference between
# a gate people trust and one they learn to ignore.
SHADE_UTILITY = re.compile(r'^(?:bg|text|border)-([a-z]+)-(\d{2,3})$')
CONFIG_FAMILY = re.compile(r'^\s*([a-zA-Z][\w-]*)\s*:\s*\{', re.M)
CONFIG_SHADE = re.compile(r'^\s*\'?(\d{2,3})\'?\s*:\s*[\'"]?([^,\n]+)', re.M)

# `bg-white` and `bg-black` are frozen too, but the doctor portal deliberately
# repaints `.dark .bg-white`, so they are handled by that layer and not here.
EXEMPT = {'bg-white', 'bg-black', 'text-white', 'text-black'}

CLASS_ATTR = re.compile(r'class(?:Name)?\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|\{`([^`]*)`\}|\{\s*"([^"]*)"\s*\})')
# `(\.dark\s+)?` matters: `.dark .patient-card { @apply bg-neutral-800 }` is the
# card's DARK background, not another of its base ones. Folding the two together
# makes every `text-content` inside a card look like light text on a dark slab
# in the light theme, and the gate then reports 40 findings that are all correct
# on screen.
APPLY_RULE = re.compile(r'(\.dark\s+)?\.([a-zA-Z][\w-]*)\s*\{\s*@apply\s+([^;]+);', re.S)


def frozen_shades(config_path):
    """{(family, shade)} for every palette entry the config fixes to a literal.

    An entry whose value mentions `var(--...)` reads a token and therefore
    flips; anything else (a `#rrggbb`) is the same colour in both themes.
    """
    frozen_set = set()
    if not config_path.exists():
        return frozen_set
    text = config_path.read_text(encoding='utf-8')
    for family_match in CONFIG_FAMILY.finditer(text):
        family = family_match.group(1)
        # The family's block runs to the next line at the same indent that
        # closes it; scanning a bounded window is enough for these configs.
        block = text[family_match.end():family_match.end() + 1400]
        end = block.find('\n        }')
        if end != -1:
            block = block[:end]
        for shade, value in CONFIG_SHADE.findall(block):
            if 'var(--' not in value:
                frozen_set.add((family, shade))
    return frozen_set


def flipping(cls, frozen_set):
    """True when this utility's colour is defined per theme."""
    for kind in ('bg-', 'text-', 'border-'):
        if cls.startswith(kind):
            rest = cls[len(kind):]
            if rest.split('-')[0] in FLIPPING_FAMILIES:
                return True
    shade = SHADE_UTILITY.match(cls)
    if shade and (shade.group(1), shade.group(2)) not in frozen_set:
        # A numbered shade the config routes through a token.
        return True
    return False


def frozen(cls, frozen_set):
    """True when this utility is the same colour in both themes."""
    if cls in EXEMPT:
        return False
    shade = SHADE_UTILITY.match(cls)
    return bool(shade) and (shade.group(1), shade.group(2)) in frozen_set


def component_classes(css_paths):
    """{name: [utilities]} for every `.name { @apply ... }` rule, expanded.

    Utilities from a `.dark .name` rule are re-emitted with a `dark:` prefix so
    they land in the dark layer, exactly as if the component had been written
    inline with that variant.
    """
    raw = {}
    for path in css_paths:
        if not path.exists():
            continue
        for dark, name, body in APPLY_RULE.findall(path.read_text(encoding='utf-8')):
            utilities = body.split()
            if dark:
                utilities = ['dark:' + u for u in utilities]
            raw.setdefault(name, []).extend(utilities)
    # A component may @apply another component (`.action-btn-primary` applies
    # `.action-btn`). Expand a bounded number of times -- no recursion.
    for _ in range(4):
        for name, utilities in list(raw.items()):
            expanded = []
            for utility in utilities:
                prefix, _, bare = utility.rpartition(':')
                nested = raw.get(bare)
                if nested is None:
                    expanded.append(utility)
                elif prefix:
                    expanded.extend(f'{prefix}:{u}' for u in nested)
                else:
                    expanded.extend(nested)
            raw[name] = expanded
    return raw


def layers(classes, components):
    """Group a class list into the theme layers that actually paint together.

    `dark:bg-slate-800` only applies in dark mode, so pairing it with a base
    `text-...` from the same element is a comparison that never happens on
    screen. Each variant prefix gets its own bucket, and the base bucket seeds
    the others so `dark:bg-x text-y` is still checked as it renders.
    """
    base = []
    dark = []
    for cls in classes:
        head, _, tail = cls.rpartition(':')
        # Only a theme variant changes which colours coexist; hover/md/focus
        # still paint over the base layer.
        outer_dark = 'dark' in head.split(':')
        for utility in components.get(tail, [tail]):
            inner, _, bare = utility.rpartition(':')
            if outer_dark or 'dark' in inner.split(':'):
                dark.append(bare)
            else:
                base.append(bare)
    if not dark:
        return {'': base}
    # In dark mode the base classes still apply except where a dark: one of the
    # same kind overrides them.
    overridden = {c.split('-')[0] for c in dark}
    kept = [c for c in base if c.split('-')[0] not in overridden]
    return {'': base, 'dark': kept + dark}


def check(findings, path, line_no, foregrounds, bg, frozen_set):
    """Record every foreground on this element that clashes with `bg`."""
    for fg in foregrounds:
        if flipping(fg, frozen_set) and frozen(bg, frozen_set):
            findings.append((path, line_no, fg, bg, 'flipping text on a frozen background'))
        elif flipping(bg, frozen_set) and frozen(fg, frozen_set):
            findings.append((path, line_no, fg, bg, 'frozen text on a flipping background'))


def scan(app_root, components, frozen_set, verbose):
    findings = []
    for path in sorted(app_root.rglob('*.tsx')):
        text = path.read_text(encoding='utf-8')
        pending = {}
        for line_no, line in enumerate(text.splitlines(), 1):
            for match in CLASS_ATTR.finditer(line):
                value = next(g for g in match.groups() if g is not None)
                # A template literal's ${...} holds conditional classes; keep
                # the literal parts, which is where the static pairing lives.
                value = re.sub(r'\$\{[^}]*\}', ' ', value)
                for layer, utilities in layers(value.split(), components).items():
                    backgrounds = [c for c in utilities if c.startswith('bg-')]
                    foregrounds = [c for c in utilities if c.startswith('text-')]
                    if backgrounds and not foregrounds:
                        # An element that only sets a background hands it to
                        # whatever it wraps. `<div className="bg-emergency-50">
                        # <QrCode className="text-critical-subtle-fg" /></div>`
                        # is the same defect split over two lines, and it is the
                        # commoner spelling of it: the dashboard's emergency-card
                        # tile measured 1.03:1 in exactly that shape. Kept per
                        # layer, so a `dark:` container never gets paired with
                        # the text of the light theme.
                        pending[layer] = (backgrounds[-1], line_no)
                        continue
                    if not foregrounds:
                        continue
                    if backgrounds:
                        # The nearest background wins when several are listed.
                        check(findings, path, line_no, foregrounds, backgrounds[-1], frozen_set)
                    elif layer in pending and line_no - pending[layer][1] <= 2:
                        check(findings, path, line_no, foregrounds, pending[layer][0], frozen_set)
    if verbose:
        print(f'  scanned {app_root}')
    return findings


def main():
    verbose = '--verbose' in sys.argv
    root = Path(__file__).resolve().parent.parent
    apps = [root / 'client' / 'patient-app', root / 'client' / 'doctor-portal']
    css = [app / 'src' / 'index.css' for app in apps]
    css.append(root / 'client' / 'shared' / 'src' / 'styles' / 'tokens.css')
    components = component_classes(css)
    if verbose:
        print(f'{len(components)} component classes expanded')

    findings = []
    for app in apps:
        frozen_set = frozen_shades(app / 'tailwind.config.js')
        if verbose:
            print(f'{app.name}: {len(frozen_set)} shades fixed to a literal colour')
        findings.extend(scan(app / 'src', components, frozen_set, verbose))
    # The shared components are compiled into both apps; check them against the
    # stricter of the two palettes so a shade frozen in either app is caught.
    shared = root / 'client' / 'shared' / 'src'
    if shared.exists():
        union = set()
        for app in apps:
            union |= frozen_shades(app / 'tailwind.config.js')
        findings.extend(scan(shared, components, union, verbose))

    if not findings:
        print('check-token-pairing: no element mixes a flipping token with a frozen shade')
        return 0

    print(f'check-token-pairing: {len(findings)} element(s) pair a theme-flipping token with a fixed shade\n')
    for path, line_no, fg, bg, why in findings:
        print(f'  {path.relative_to(root)}:{line_no}')
        print(f'    {fg} + {bg} -- {why}')
    print('\nUse a matching pair: bg-<family>-subtle with text-<family>-subtle-fg,')
    print('or bg-<family> with text-<family>-fg. Both halves then flip together.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
