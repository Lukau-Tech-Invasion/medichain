#!/usr/bin/env python3
"""Fail if a migration seeds accounts, patients or identity records.

A fresh database must contain no account until bootstrap provisions the first
administrator, and no patient until one is registered through the API. Seeded
rows are what blocked first-run bootstrap: historical migrations inserted
credentialless demo accounts and synthetic patients that later code had to
detect and delete. This gate keeps them out at the source.

It flags, in every `api/migrations/*.sql` file (comments ignored):
  * any INSERT into an identity table, unless the (file, table) pair is in
    ALLOWED below with its reason.

Usage:  python scripts/check-no-migration-seeds.py
Exit:   0 clean, 1 if any migration seeds an identity.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "api" / "migrations"

IDENTITY_TABLES = (
    "users", "user_profiles", "patients", "patient_demographics", "nfc_tags",
    "medical_id_issuances", "credential_grants", "user_mfa", "guardian_relationships",
)

# (migration file, table) -> why the insert is not a seed.
ALLOWED: dict[tuple[str, str], str] = {
    ("20261019000000_baseline.sql", "medical_id_issuances"):
        "the trigger function that registers the ID of a patient created later; no row is inserted",
}

INSERT = re.compile(
    r"insert\s+into\s+(?:public\.)?(" + "|".join(IDENTITY_TABLES) + r")\b", re.I
)


def strip_comments(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", "", sql)
    return re.sub(r"/\*.*?\*/", "", sql, flags=re.S)


def findings_for(path: Path):
    sql = strip_comments(path.read_text(encoding="utf-8"))
    for match in INSERT.finditer(sql):
        table = match.group(1).lower()
        if (path.name, table) not in ALLOWED:
            yield f"{path.name}: inserts into {table}"


def main() -> int:
    findings = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        findings.extend(findings_for(path))
    stale = [pair for pair in ALLOWED if not (MIGRATIONS / pair[0]).exists()]
    for name, table in stale:
        findings.append(f"allowlist names a missing migration: {name} ({table})")
    if findings:
        print("Migrations must not seed identities:")
        for finding in findings:
            print(f"  {finding}")
        return 1
    print("check-no-migration-seeds: no migration seeds an account, patient or identity")
    return 0


if __name__ == "__main__":
    sys.exit(main())
