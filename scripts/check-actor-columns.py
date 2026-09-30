#!/usr/bin/env python3
"""Gate: every column that can hold a user is declared in actor_column_registry.

`users.id` is the only identifier of a user (ADR-0010). Migration
20260930000001 remapped every column that held the old wallet address, driven by
`actor_column_registry`. A column added afterwards that looks like an actor
reference -- or any JSONB column, which may carry one anywhere inside it -- must
be declared the same way, or nobody will know to remap or resolve it.

This reads the migration files (no database needed) and fails when:

  * a text / varchar / uuid column whose name looks like an actor reference, or
    a JSONB column, exists after all migrations and is not declared; or
  * a migration after the identity migration declares a registry row for a
    column that does not exist.

Declaring a column: add a row to `actor_column_registry` in a migration:

    INSERT INTO actor_column_registry (table_name, column_name, kind)
    VALUES ('new_table', 'reviewed_by', 'mixed');

A column that matches the pattern but holds no actor goes in NOT_ACTORS below
with the reason. The same pattern and allowlist live in
api/src/repositories/postgres/actor_registry_tests.rs, which checks a real
schema; keep the two in step.

The check is a line-oriented reading of the DDL, not a SQL parser: it follows
CREATE TABLE, ADD/DROP/RENAME COLUMN and DROP/RENAME TABLE, which is all the
migrations here use.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "api" / "migrations"
IDENTITY_MIGRATION = "20260930000001_identity_key.sql"

# Keep identical to ACTOR_LIKE in actor_registry_tests.rs (POSIX ARE == Python re here).
ACTOR_LIKE = re.compile(
    r"(_by$|_by_[a-z]+$|provider_id$|^provider$|_provider$|clinician_id$|owner_id$|^actor$"
    r"|accessor_id$|user_id$|wallet|physician_id$|pathologist_id$|radiologist_id$|surgeon_id$"
    r"|anesthesiologist_id$|psychiatrist_id$|crna_id$|prescriber_id$|collector_id$"
    r"|technologist_id$|custodian_id$|assistant_id$|intubator_id$|reporter_id$|primary_nurse$"
    r"|scrub_nurse_id$|circulating_nurse_id$|requesting_provider$|requesting_person_id$"
    r"|^subject$|assigned_to$|nurse$|_nurse_id$|doctor$|_doctor_id$|recorded_by|performed_by)"
)

# (table, column) pairs the pattern catches that are not actors.
NOT_ACTORS = {
    ("adherence_logs", "reported_by"),  # 'patient' or 'caregiver'
    ("device_keys", "replaced_by"),  # a device key id
    ("guardian_relationships", "authority_verified_by_role"),  # a role name
    ("immunization_records", "administered_by_name"),  # a display name
    ("key_envelopes", "superseded_by"),  # an envelope id
    ("legacy_wallet_identities", "user_id"),  # the mapping's own target
    ("legacy_wallet_identities", "wallet_address"),  # the mapping's own key
    ("obstetric_emergencies", "prenatal_care_provider"),  # free-text name
    ("organization_keys", "replaced_by"),  # an organisation key id
    ("splint_cast_records", "follow_up_provider"),  # free-text name
}

ACTOR_TYPES = ("text", "varchar", "character varying", "uuid")
CONSTRAINT_STARTS = (
    "constraint", "primary", "unique", "foreign", "check", "exclude", "like", "period",
)

CREATE_TABLE = re.compile(
    r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(", re.I
)
ALTER_TABLE = re.compile(r"alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:public\.)?(\w+)\s+(.*?);", re.I | re.S)
DROP_TABLE = re.compile(r"drop\s+table\s+(?:if\s+exists\s+)?([\w.,\s]+?)(?:\s+cascade)?\s*;", re.I)
REGISTRY_ROW = re.compile(r"\(\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'(\w+)'")


def strip_comments(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", "", sql)
    return re.sub(r"/\*.*?\*/", "", sql, flags=re.S)


def split_top_level(body: str):
    parts, depth, current = [], 0, []
    for char in body:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    parts.append("".join(current))
    return parts


def body_after(sql: str, open_index: int) -> str:
    depth = 0
    for index in range(open_index, len(sql)):
        if sql[index] == "(":
            depth += 1
        elif sql[index] == ")":
            depth -= 1
            if depth == 0:
                return sql[open_index + 1 : index]
    return sql[open_index + 1 :]


def column_type(definition: str):
    tokens = definition.strip().split(None, 2)
    if len(tokens) < 2:
        return None
    name = tokens[0].strip('"')
    rest = " ".join(tokens[1:]).lower()
    kind = "other"
    if rest.startswith("jsonb"):
        kind = "jsonb"
    elif rest.startswith(("character varying", "varchar")):
        kind = "varchar"
    elif rest.startswith("text"):
        kind = "text"
    elif rest.startswith("uuid"):
        kind = "uuid"
    return name, kind


class Schema:
    def __init__(self):
        self.tables = {}  # table -> {column: type}
        self.born_at = {}  # (table, column) -> migration file name

    def add(self, table, column, kind, migration):
        self.tables.setdefault(table, {})[column] = kind
        self.born_at[(table, column)] = migration


def read_schema():
    schema = Schema()
    registry_rows = []  # (migration, table, column)
    for path in sorted(MIGRATIONS.glob("*.sql")):
        sql = strip_comments(path.read_text(encoding="utf-8"))
        name = path.name
        for match in CREATE_TABLE.finditer(sql):
            table = match.group(1).lower()
            body = body_after(sql, match.end() - 1)
            schema.tables.setdefault(table, {})
            for part in split_top_level(body):
                words = part.strip().lower().split(None, 1)
                if not words or words[0] in CONSTRAINT_STARTS:
                    continue
                parsed = column_type(part)
                if parsed:
                    schema.add(table, parsed[0].lower(), parsed[1], name)
        for match in ALTER_TABLE.finditer(sql):
            table = match.group(1).lower()
            for action in split_top_level(match.group(2)):
                action = action.strip()
                add = re.match(r"add\s+column\s+(?:if\s+not\s+exists\s+)?(.+)", action, re.I | re.S)
                if add:
                    parsed = column_type(add.group(1))
                    if parsed:
                        schema.add(table, parsed[0].lower(), parsed[1], name)
                    continue
                drop = re.match(r"drop\s+column\s+(?:if\s+exists\s+)?(\w+)", action, re.I)
                if drop:
                    schema.tables.get(table, {}).pop(drop.group(1).lower(), None)
                    continue
                rename = re.match(r"rename\s+column\s+(\w+)\s+to\s+(\w+)", action, re.I)
                if rename:
                    old, new = rename.group(1).lower(), rename.group(2).lower()
                    kind = schema.tables.get(table, {}).pop(old, "other")
                    schema.add(table, new, kind, schema.born_at.get((table, old), name))
                    continue
                to = re.match(r"rename\s+to\s+(\w+)", action, re.I)
                if to:
                    schema.tables[to.group(1).lower()] = schema.tables.pop(table, {})
                    for (t, c), born in list(schema.born_at.items()):
                        if t == table:
                            schema.born_at[(to.group(1).lower(), c)] = born
        for match in DROP_TABLE.finditer(sql):
            for table in re.split(r"[\s,]+", match.group(1)):
                schema.tables.pop(table.lower().replace("public.", ""), None)
        if "actor_column_registry" in sql:
            # A statement ends at a semicolon at the end of a line; one inside a
            # string literal (a note, say) does not.
            for statement in re.split(r";[ \t]*\n", sql):
                if re.search(r"insert\s+into\s+actor_column_registry", statement, re.I):
                    for row in REGISTRY_ROW.finditer(statement):
                        registry_rows.append((name, row.group(1).lower(), row.group(2).lower()))
    return schema, registry_rows


def main() -> int:
    schema, registry_rows = read_schema()
    declared = {(table, column) for _, table, column in registry_rows}
    declared_after_identity = {
        (table, column) for name, table, column in registry_rows if name >= IDENTITY_MIGRATION
    }

    problems = []
    for table, columns in sorted(schema.tables.items()):
        for column, kind in sorted(columns.items()):
            key = (table, column)
            actor_like = kind in ("text", "varchar", "uuid") and ACTOR_LIKE.search(column)
            if not actor_like and kind != "jsonb":
                continue
            if key in NOT_ACTORS or key in declared:
                continue
            born = schema.born_at.get(key, "")
            # The identity migration auto-registers every JSONB column and every
            # owner_id that existed when it ran; only later ones need a row.
            if born and born < IDENTITY_MIGRATION and (kind == "jsonb" or column == "owner_id"):
                continue
            problems.append(f"{table}.{column} ({kind}, created in {born or '?'}) is not in actor_column_registry")

    for table, column in sorted(declared_after_identity):
        # born_at, not the live model: some migrations drop and re-add a column
        # with dynamic SQL, which this reading cannot follow.
        if (table, column) not in schema.born_at:
            problems.append(f"registry row {table}.{column} names a column no migration creates")

    if problems:
        print("actor-column gate FAILED:")
        for problem in problems:
            print(f"  - {problem}")
        print(
            "\nDeclare each in a migration:\n"
            "  INSERT INTO actor_column_registry (table_name, column_name, kind)\n"
            "  VALUES ('table', 'column', 'mixed');\n"
            "or, if it holds no actor, add it to NOT_ACTORS in this script and in\n"
            "api/src/repositories/postgres/actor_registry_tests.rs with the reason."
        )
        return 1
    print(
        f"actor-column gate: OK ({sum(len(c) for c in schema.tables.values())} columns read, "
        f"{len(declared)} declared explicitly)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
