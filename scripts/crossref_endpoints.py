#!/usr/bin/env python3
import csv
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER_CSV = ROOT / 'docs' / 'server-endpoints.csv'
FRONTEND_CSV = ROOT / 'docs' / 'frontend-backend-mapping.csv'
OUT_CSV = ROOT / 'docs' / 'frontend-backend-crossref.csv'

def normalize(path: str) -> str:
    # replace parameter names {id} -> {}
    s = re.sub(r"\{[^}]+\}", "{}", path)
    # remove trailing slashes
    s = s.rstrip('/')
    return s

def read_server_endpoints():
    endpoints = []
    with SERVER_CSV.open('r', encoding='utf-8') as f:
        reader = csv.reader(f)
        for row in reader:
            if not row: 
                continue
            if row[0].startswith('#'):
                continue
            # header check
            if row[0] == 'endpoint':
                continue
            endpoint = row[0].strip()
            defined_in = row[1].strip() if len(row) > 1 else ''
            endpoints.append((endpoint, defined_in))
    return endpoints

def read_frontend_mappings():
    mappings = []
    with FRONTEND_CSV.open('r', encoding='utf-8') as f:
        # mapping file may include code fences; strip them
        text = f.read()
    text = re.sub(r"^```.*?```$", "", text, flags=re.DOTALL | re.MULTILINE)
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('source_type'):
            continue
        parts = [p.strip() for p in line.split(',')]
        if len(parts) < 3:
            continue
        source_type, file, endpoint = parts[0], parts[1], ','.join(parts[2:])
        mappings.append((endpoint, file, source_type))
    return mappings

def main():
    servers = read_server_endpoints()
    mappings = read_frontend_mappings()

    # build normalized index of mappings
    norm_index = {}
    for endpoint, file, source_type in mappings:
        ne = normalize(endpoint)
        norm_index.setdefault(ne, []).append(f"{file} ({source_type})")

    # write crossref
    with OUT_CSV.open('w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['endpoint','defined_in','used_by_frontend','matching_sources'])
        for endpoint, defined_in in servers:
            ne = normalize(endpoint)
            matches = norm_index.get(ne, [])
            used = 'yes' if matches else 'no'
            writer.writerow([endpoint, defined_in, used, ';'.join(sorted(set(matches)))])

    print(f'Wrote cross-reference to {OUT_CSV}')

if __name__ == '__main__':
    main()
