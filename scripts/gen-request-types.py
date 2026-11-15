#!/usr/bin/env python3
"""Generate TypeScript request types from the Rust types the API deserialises.

`client/shared/src/api/endpoints.ts` had 60 wrappers declared `data: unknown`.
A wrapper typed that way is checked by nothing: the page can send any shape and
the first anyone hears of a mismatch is a 400 at the bedside (CLAUDE.md rule
11). Writing the 60 types by hand would create a second copy of every request
struct, free to drift from the first. This reads the one authoritative copy --
the `web::Json<T>` a route takes -- and emits its wire shape.

    python scripts/gen-request-types.py            # rewrite the generated file
    python scripts/gen-request-types.py --check    # exit 1 if it is stale
    python scripts/gen-request-types.py --report   # which wrappers resolve

What it models: serde `rename`, `rename_all = "camelCase"`, `default`,
`Option`, `Vec`, string-keyed maps, nested structs and unit-variant enums.
What it does not: `alias` (a page may send either spelling; only the canonical
one is typed), `flatten`, and enums carrying data -- those fields are emitted
as `unknown`, which is honest about what was not derived.
"""
from __future__ import annotations

import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHARED_SRC = os.path.join(ROOT, 'client', 'shared', 'src')
OUTPUT = os.path.join(SHARED_SRC, 'api', 'request-types.generated.ts')

_spec = importlib.util.spec_from_file_location(
    'payload_contracts', os.path.join(HERE, 'check-payload-contracts.py')
)
contracts = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(contracts)

NUMBERS = {
    'u8', 'u16', 'u32', 'u64', 'usize', 'i8', 'i16', 'i32', 'i64', 'isize',
    'f32', 'f64', 'Decimal',
}
STRINGS = {
    'String', 'str', 'Uuid', 'NaiveDate', 'NaiveTime', 'NaiveDateTime',
    'DateTime<Utc>', 'char',
}

Field = tuple[str, str, bool]  # wire name, rust type, optional


def to_camel(name: str) -> str:
    head, *rest = name.split('_')
    return head + ''.join(part[:1].upper() + part[1:] for part in rest)


def flatten_attributes(body: str) -> str:
    return re.sub(r'#\[(?:[^\[\]]|\[[^\]]*\])*\]', contracts.collapse, body)


def parse_structs(blob: str) -> dict[str, list[Field] | None]:
    """name -> fields, or None when the struct cannot be modelled (flatten)."""
    structs: dict[str, list[Field] | None] = {}
    pattern = re.compile(
        r'((?:^[ \t]*(?:#\[[^\n]*\]|///[^\n]*)\n)*)^[ \t]*pub struct (\w+)\s*\{(.*?)^\}',
        re.M | re.S,
    )
    for m in pattern.finditer(blob):
        attrs, name, body = m.group(1), m.group(2), m.group(3)
        camel = 'rename_all = "camelCase"' in attrs
        fields: list[Field] = []
        modelled = True
        attr = ''
        for line in flatten_attributes(body).split('\n'):
            s = line.strip()
            if s.startswith('#['):
                attr += ' ' + s
                continue
            if not s or s.startswith('//'):
                continue
            fm = re.match(r'pub (\w+)\s*:\s*(.+?),?\s*(?://.*)?$', s)
            if not fm:
                attr = ''
                continue
            field, ty = fm.group(1), fm.group(2).rstrip(',').strip()
            if 'flatten' in attr:
                modelled = False
            if 'skip_deserializing' in attr or re.search(r'\bskip\b', attr):
                attr = ''
                continue
            rm = re.search(r'rename\s*=\s*"([^"]+)"', attr)
            wire = rm.group(1) if rm else (to_camel(field) if camel else field)
            optional = 'default' in attr or ty.startswith('Option<')
            fields.append((wire, ty, optional))
            attr = ''
        # The same name declared twice (a handler-local DTO shadowing a domain
        # type) is ambiguous from here; refuse to guess between them.
        structs[name] = None if name in structs else (fields if modelled else None)
    return structs


def parse_unit_enums(blob: str) -> dict[str, list[str]]:
    """name -> wire values, for enums whose every variant is a bare name."""
    enums: dict[str, list[str]] = {}
    pattern = re.compile(
        r'((?:^[ \t]*(?:#\[[^\n]*\]|///[^\n]*)\n)*)^[ \t]*pub enum (\w+)\s*\{(.*?)^\}',
        re.M | re.S,
    )
    for m in pattern.finditer(blob):
        attrs, name, body = m.group(1), m.group(2), m.group(3)
        if 'Deserialize' not in attrs or 'untagged' in attrs or 'tag =' in attrs:
            continue
        style = re.search(r'rename_all\s*=\s*"([^"]+)"', attrs)
        values: list[str] = []
        attr = ''
        unit = True
        for line in flatten_attributes(body).split('\n'):
            s = line.strip()
            if s.startswith('#['):
                attr += ' ' + s
                continue
            if not s or s.startswith('//'):
                continue
            vm = re.match(r'(\w+)\s*,?\s*(?://.*)?$', s)
            if not vm:
                unit = False
                break
            rm = re.search(r'rename\s*=\s*"([^"]+)"', attr)
            values.append(rm.group(1) if rm else restyle(vm.group(1), style and style.group(1)))
            attr = ''
        if unit and values and name not in enums:
            enums[name] = values
    return enums


def restyle(variant: str, style: str | None) -> str:
    words = re.findall(r'[A-Z][a-z0-9]*|[a-z0-9]+', variant)
    lower = [w.lower() for w in words]
    if style == 'snake_case':
        return '_'.join(lower)
    if style == 'kebab-case':
        return '-'.join(lower)
    if style == 'lowercase':
        return ''.join(lower)
    if style == 'UPPERCASE':
        return ''.join(lower).upper()
    if style == 'SCREAMING_SNAKE_CASE':
        return '_'.join(lower).upper()
    if style == 'camelCase':
        return lower[0] + ''.join(w.title() for w in lower[1:])
    return variant


def split_generic(inner: str) -> list[str]:
    parts, depth, current = [], 0, ''
    for ch in inner:
        if ch == '<':
            depth += 1
        elif ch == '>':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(current.strip())
            current = ''
        else:
            current += ch
    if current.strip():
        parts.append(current.strip())
    return parts


class Emitter:
    def __init__(self, structs, enums, taken: set[str]):
        self.structs = structs
        self.enums = enums
        self.taken = taken
        self.names: dict[str, str] = {}
        self.blocks: dict[str, str] = {}
        self.pending: list[str] = []

    def ts_name(self, rust: str) -> str:
        if rust not in self.names:
            name = rust
            while name in self.taken:
                name += 'Body'
            self.taken.add(name)
            self.names[rust] = name
        return self.names[rust]

    def ts_type(self, ty: str) -> str:
        ty = ty.strip().split('::')[-1] if '<' not in ty else ty.strip()
        ty = re.sub(r'^(?:[a-z_]+::)+', '', ty)
        if ty in NUMBERS:
            return 'number'
        if ty in STRINGS or ty.startswith('DateTime<'):
            return 'string'
        if ty == 'bool':
            return 'boolean'
        gm = re.match(r'(\w+)<(.*)>$', ty)
        if gm:
            outer, args = gm.group(1), split_generic(gm.group(2))
            if outer == 'Option':
                return self.ts_type(args[0])
            if outer in ('Vec', 'HashSet', 'BTreeSet'):
                inner = self.ts_type(args[0])
                return ('(%s)[]' if ' | ' in inner else '%s[]') % inner
            if outer in ('HashMap', 'BTreeMap') and len(args) == 2:
                return 'Record<string, %s>' % self.ts_type(args[1])
            if outer == 'Box':
                return self.ts_type(args[0])
            return 'unknown'
        if ty in self.enums:
            return ' | '.join("'%s'" % v for v in self.enums[ty])
        if self.structs.get(ty) is not None:
            if ty not in self.names:
                self.pending.append(ty)
            return self.ts_name(ty)
        return 'unknown'

    def emit(self, rust: str) -> str | None:
        if self.structs.get(rust) is None:
            return None
        name = self.ts_name(rust)
        self.pending.append(rust)
        while self.pending:
            current = self.pending.pop()
            if current in self.blocks:
                continue
            lines = ['/** Wire shape of the Rust `%s`. */' % current,
                     'export interface %s {' % self.ts_name(current)]
            for wire, ty, optional in self.structs[current]:
                key = wire if re.match(r'^[A-Za-z_$][\w$]*$', wire) else "'%s'" % wire
                rendered = self.ts_type(ty)
                if ty.startswith('Option<') and rendered != 'unknown':
                    rendered += ' | null'
                lines.append('  %s%s: %s;' % (key, '?' if optional else '', rendered))
            lines.append('}')
            self.blocks[current] = '\n'.join(lines)
        return name


def exported_names() -> set[str]:
    taken: set[str] = set()
    pattern = re.compile(
        r'^export (?:declare )?(?:async )?(?:interface|type|class|const|function|enum) (\w+)', re.M
    )
    for root, _dirs, files in os.walk(SHARED_SRC):
        for fname in files:
            path = os.path.join(root, fname)
            # Our own previous output must not count as a collision, or every
            # second run would rename everything.
            if not fname.endswith(('.ts', '.tsx')) or os.path.abspath(path) == OUTPUT:
                continue
            with open(path, encoding='utf-8', errors='replace') as fh:
                taken.update(pattern.findall(fh.read()))
    return taken


def resolve() -> tuple[dict[str, str], list[str], str]:
    """wrapper -> generated type name, the unresolved wrappers, the file text."""
    sources = contracts.rust_sources()
    blob = '\n'.join(sources[k] for k in sorted(sources))
    structs = parse_structs(blob)
    enums = parse_unit_enums(blob)
    routes = contracts.parse_routes(sources)
    endpoints = '\n'.join(contracts.endpoint_sources().values())
    wrappers, _untyped = contracts.parse_wrappers(endpoints)

    emitter = Emitter(structs, enums, exported_names())
    resolved: dict[str, str] = {}
    unresolved: list[str] = []
    for fn in sorted(wrappers):
        declared = re.search(
            r'export async function %s\s*\(([^)]*)\)' % re.escape(fn), endpoints
        )
        params = declared.group(1) if declared else ''
        generated = re.search(r'\bdata:\s*Requests\.\w+', params)
        untyped = re.search(r'\bdata:\s*unknown\b', params)
        target = next(
            (r for r in sorted(routes) if contracts.route_matches(wrappers[fn], r)), None
        )
        rust = routes.get(target) if target else None
        # A wrapper is ours to type when it is still `unknown`, or when a
        # previous run already pointed it at a generated type.
        if not (untyped or generated):
            continue
        name = emitter.emit(rust) if rust else None
        if name is None:
            unresolved.append('%s -> %s (%s)' % (fn, wrappers[fn], rust or 'no Json<T> route'))
            continue
        resolved[fn] = name

    header = (
        '// GENERATED by scripts/gen-request-types.py -- do not edit.\n'
        '// Each interface is the wire shape of the Rust type a route\n'
        '// deserialises. Change the Rust type, then re-run the script.\n'
    )
    body = '\n\n'.join(emitter.blocks[k] for k in sorted(emitter.blocks, key=emitter.ts_name))
    return resolved, unresolved, header + '\n' + body + '\n'


def apply_to_endpoints(resolved: dict[str, str]) -> int:
    """Retype each resolved wrapper in whichever module declares it."""
    return sum(
        apply_to_module(path, text, resolved)
        for path, text in contracts.endpoint_sources().items()
    )


def apply_to_module(path: str, text: str, resolved: dict[str, str]) -> int:
    original = text
    changed = 0
    for fn, name in resolved.items():
        pattern = re.compile(
            r'(export async function %s\s*\([^)]*?\bdata:\s*)(?:unknown\b|Requests\.\w+)' % re.escape(fn)
        )
        rewritten = pattern.sub(lambda m: m.group(1) + 'Requests.' + name, text, count=1)
        changed += rewritten != text
        text = rewritten
    marker = "import type * as Requests from '../request-types.generated';"
    if changed and marker not in text:
        nl = '\r\n' if '\r\n' in text else '\n'
        first = re.search(r'^import [^\n]*\n', text, re.M)
        at = first.start() if first else 0
        text = text[:at] + marker + nl + text[at:]
    # Leave an already-current file untouched.
    if text != original:
        with open(path, 'w', encoding='utf-8', newline='') as fh:
            fh.write(text)
    return changed


def main() -> int:
    resolved, unresolved, rendered = resolve()
    if '--report' in sys.argv:
        for fn in sorted(resolved):
            print('%s: %s' % (fn, resolved[fn]))
        print('\nUnresolved (%d):' % len(unresolved))
        for line in unresolved:
            print('  ' + line)
        return 0
    current = ''
    if os.path.exists(OUTPUT):
        with open(OUTPUT, encoding='utf-8') as fh:
            current = fh.read()
    if '--check' in sys.argv:
        if current.replace('\r\n', '\n') != rendered:
            print('gen-request-types: %s is stale; re-run the script.' % os.path.relpath(OUTPUT, ROOT))
            return 1
        print('gen-request-types: %d request types up to date.' % rendered.count('export interface'))
        return 0
    with open(OUTPUT, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(rendered)
    changed = apply_to_endpoints(resolved)
    print('gen-request-types: %d wrappers typed (%d newly), %d unresolved.'
          % (len(resolved), changed, len(unresolved)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
