"""Fail CI when the production Compose overlay exposes internal services.

This validates the *merged* configuration, since Compose merges port lists
unless the overlay explicitly replaces them. Dummy values are used only while
parsing; this script never starts containers or reads deployment credentials.
"""

import json
import os
import subprocess
import sys
from copy import deepcopy


REQUIRED_PLACEHOLDERS = (
    "POSTGRES_PASSWORD",
    "JWT_SECRET",
    "SESSION_SECRET",
    "ENCRYPTION_KEYS",
    "PATIENT_SEARCH_INDEX_KEY",
    "METRICS_TOKEN",
    "NATIONAL_ID_HASH_KEY",
    "SMS_INBOUND_WEBHOOK_SECRET",
    "AUDIT_SEAL_SIGNING_KEY",
    "GRAFANA_ADMIN_PASSWORD",
    "ALLOWED_ORIGINS",
    "PGBACKREST_REPO1_CIPHER_PASS",
    "PGBACKREST_REPO2_AZURE_ACCOUNT",
    "PGBACKREST_REPO2_AZURE_CONTAINER",
    "PGBACKREST_REPO2_AZURE_KEY",
    "PGBACKREST_REPO2_CIPHER_PASS",
    "MEDICHAIN_BOOTSTRAP_KEY",
)


def merged_config() -> dict:
    """Return the production configuration with every optional profile included."""
    env = os.environ.copy()
    for name in REQUIRED_PLACEHOLDERS:
        env[name] = "compose-check-only"
    env["ALLOWED_ORIGINS"] = "https://clinic.example.invalid"
    command = [
        "docker", "compose", "-f", "docker-compose.yml",
        "-f", "docker-compose.backup.yml",
        "-f", "docker-compose.backup-offsite.yml",
        "-f", "docker-compose.prod.yml", "--profile", "monitoring",
        "--profile", "debug", "config", "--format", "json",
    ]
    result = subprocess.run(command, env=env, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return json.loads(result.stdout)


def published_ports(service: dict) -> set[int]:
    """Get all host ports Compose would publish for a service."""
    return {int(port["published"]) for port in service.get("ports", []) if port.get("published")}


def check(config: dict) -> list[str]:
    """List production exposure and posture defects in the merged stack."""
    services = config["services"]
    problems = []
    for name in ("ipfs", "blockchain", "substrate"):  # retired-term-negative-assertion
        if name in services:
            problems.append(f"removed service {name} is still configured")
    for name in ("api", "postgres", "pgadmin", "prometheus", "grafana"):
        if published_ports(services[name]):
            problems.append(f"{name} publishes host ports: {published_ports(services[name])}")
    if published_ports(services["nginx"]) != {443}:
        problems.append("nginx must publish only HTTPS port 443")
    api_env = services["api"]["environment"]
    expected = {
        "APP_ENV": "production", "IS_DEMO": "false",
        "MEDICHAIN_STORAGE": "postgres", "REQUIRE_SIGNATURES": "true",
    }
    for name, value in expected.items():
        if str(api_env.get(name)).lower() != value:
            problems.append(f"API {name} must be {value}")
    if api_env.get("MEDICHAIN_BOOTSTRAP_KEY") != "compose-check-only":
        problems.append("API bootstrap key must come from the deployment environment")
    if api_env.get("AUDIT_CHECKPOINT_SINK") != "filesystem":
        problems.append("API checkpoint sink must be configured")
    postgres = services["postgres"]
    command = postgres.get("command", [])
    if "archive_mode=on" not in command or not any(
        "pgbackrest" in argument and "archive-push" in argument for argument in command
    ):
        problems.append("PostgreSQL WAL archiving through pgBackRest is missing")
    if postgres["environment"].get("PGBACKREST_REPO2_TYPE") != "azure":
        problems.append("encrypted off-site pgBackRest repository is missing")
    return problems


def main() -> int:
    """Print a concise gate result without displaying interpolated secrets."""
    try:
        config = merged_config()
        problems = check(config)
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print(f"production Compose check could not run: {error}", file=sys.stderr)
        return 2
    if problems:
        for problem in problems:
            print(f"FAIL: {problem}")
        return 1
    unsafe = deepcopy(config)
    unsafe["services"]["postgres"]["ports"] = [{"published": "5432"}]
    unsafe["services"]["postgres"]["command"] = ["postgres"]
    unsafe["services"]["nginx"]["ports"] = [{"published": "80"}]
    unsafe["services"]["api"]["environment"]["MEDICHAIN_BOOTSTRAP_KEY"] = "fixed-example-key"
    negative = check(unsafe)
    if not all(any(marker in problem for problem in negative) for marker in (
        "postgres publishes", "WAL archiving", "HTTPS port 443", "bootstrap key"
    )):
        print("FAIL: production Compose gate did not detect its negative controls")
        return 1
    print("PASS: production Compose HTTPS, encrypted WAL backups, and external bootstrap key")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
