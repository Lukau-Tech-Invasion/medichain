#!/usr/bin/env python3
import csv
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'logs' / 'repo_inventory.csv'

EXCLUDE_DIRS = {'.git', 'target', 'node_modules', 'dist', 'build'}

def iter_files(root: Path):
    for p in root.rglob('*'):
        if p.is_dir():
            if any(part in EXCLUDE_DIRS for part in p.parts):
                continue
        else:
            if any(part in EXCLUDE_DIRS for part in p.parts):
                continue
            yield p

def count_lines(path: Path):
    try:
        with path.open('rb') as f:
            return sum(1 for _ in f)
    except Exception:
        return ''

def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open('w', newline='', encoding='utf-8') as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(['path','size_bytes','lines','ext'])
        for p in iter_files(ROOT):
            try:
                size = p.stat().st_size
            except Exception:
                size = ''
            lines = count_lines(p)
            ext = p.suffix
            rel = p.relative_to(ROOT).as_posix()
            writer.writerow([rel, size, lines, ext])
    print(f'Wrote inventory to {OUT}')

if __name__ == '__main__':
    main()
#!/usr/bin/env python3
import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'repo_inventory.csv'

def main():
    with OUT.open('w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['path','bytes','lines','extension'])
        for p in sorted(ROOT.rglob('*')):
            if p.is_file():
                try:
                    stat = p.stat()
                    size = stat.st_size
                    try:
                        with p.open('rb') as fh:
                            lines = sum(1 for _ in fh)
                    except Exception:
                        lines = ''
                    writer.writerow([str(p.relative_to(ROOT)), size, lines, p.suffix])
                except Exception:
                    continue
    print(f'Wrote inventory to {OUT}')

if __name__ == '__main__':
    main()
