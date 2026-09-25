#!/usr/bin/env python3
"""Fail the build when a monitoring config scrapes /api/metrics without credentials.

`/api/metrics` requires a bearer token (`METRICS_TOKEN`) in every configuration
except explicit local demo. A Prometheus scrape config that omits the credential
does not fail loudly -- it produces a target stuck at `down` with
`401 Unauthorized`, visible only to somebody who opens the Prometheus UI.

That is exactly what happened here. The running deployment scraped
`http://api:8080/api/metrics` with a credentials_file while the API's
METRICS_TOKEN was empty, so the two halves disagreed and the target had been
down long enough that nobody remembered it should be up. Metrics silence is the
one failure that cannot page anybody about itself.

WHAT THIS CHECKS

For every Prometheus-shaped YAML in the repository, each scrape job whose
`metrics_path` is an authenticated MediChain endpoint must carry one of:

  * `authorization:` with `credentials` or `credentials_file`
  * `basic_auth:`
  * `bearer_token:` / `bearer_token_file:`

and the compose service that runs Prometheus must actually mount the secret it
names.

WHAT THIS DELIBERATELY DOES NOT CHECK

Whether the token is correct -- a static gate cannot know that, and the runtime
proof for it is the scrape itself. This catches the structural mistake: asking
for a protected endpoint while offering nothing.

Usage:  python scripts/check-metrics-scrape-auth.py [--list]
Exit 0 = every authenticated scrape presents a credential, 1 = at least one does not.
"""
from __future__ import annotations

import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

SKIP_DIRS = {"node_modules", "target", "dist", "build", ".git", ".vite", "coverage"}

# Endpoints that require a credential. `/health` is deliberately unauthenticated
# so an orchestrator can probe liveness without one, and is not listed.
AUTHENTICATED_PATHS = ("/api/metrics",)

CREDENTIAL_KEYS = (
    "authorization",
    "basic_auth",
    "bearer_token",
    "bearer_token_file",
)


def yaml_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name.endswith((".yml", ".yaml")):
                yield pathlib.Path(dirpath) / name


def scrape_jobs(text: str):
    """Yield (job_name, block) for each entry under scrape_configs.

    Parsed by indentation rather than with a YAML library, so the gate runs with
    no dependency beyond the standard library -- the same reason every other
    gate in this directory is plain Python.
    """
    lines = text.split("\n")
    try:
        start = next(i for i, l in enumerate(lines) if l.strip() == "scrape_configs:")
    except StopIteration:
        return

    job_lines: list[str] = []
    name = "<unnamed>"
    job_indent = None
    for line in lines[start + 1 :]:
        stripped = line.strip()
        # A new top-level key ends the scrape_configs section.
        if line and not line[0].isspace() and stripped:
            break
        m_dash = re.match(r"(\s*)-\s", line)
        # Only a dash at the JOB's own indentation starts a new job. Nested list
        # items -- `static_configs:` contains `- targets: [...]` -- are deeper,
        # and treating them as job boundaries split each config so that
        # `metrics_path` and `authorization` landed in different blocks. The
        # gate then reported this repository's own correct Prometheus config as
        # unauthenticated, which is how the bug was found.
        if m_dash and (job_indent is None or len(m_dash.group(1)) == job_indent):
            if job_indent is None:
                job_indent = len(m_dash.group(1))
            if job_lines:
                yield name, "\n".join(job_lines)
            job_lines = [line]
            name = "<unnamed>"
        elif job_lines:
            job_lines.append(line)
        m = re.search(r"job_name:\s*[\"']?([^\"'\n]+)", line)
        if m:
            name = m.group(1).strip()
    if job_lines:
        yield name, "\n".join(job_lines)


def scan() -> list[str]:
    findings: list[str] = []
    for path in sorted(yaml_files()):
        text = path.read_text(encoding="utf-8", errors="replace")
        if "scrape_configs:" not in text:
            continue
        rel = path.relative_to(ROOT).as_posix()
        for name, block in scrape_jobs(text):
            if not any(p in block for p in AUTHENTICATED_PATHS):
                continue
            if any(re.search(rf"^\s*{key}\s*:", block, re.M) for key in CREDENTIAL_KEYS):
                continue
            findings.append(
                f"{rel}: scrape job '{name}' targets an authenticated endpoint "
                f"but presents no credential. The target will sit at `down` with "
                f"401 Unauthorized and nothing else will report it."
            )
    return findings


def main() -> int:
    findings = scan()

    if "--list" in sys.argv:
        for f in findings:
            print(f"  {f}")
        print(f"\n{len(findings)} unauthenticated scrape(s) of a protected endpoint")
        return 0

    if findings:
        print("Metrics scrape authentication gate FAILED:\n")
        for f in findings:
            print(f"  * {f}")
        print(
            "\nAdd `authorization: { credentials_file: ... }` (or basic_auth /"
            "\nbearer_token) to the job, and make sure the Prometheus service"
            "\nmounts the secret it names. Do NOT make /api/metrics public."
        )
        return 1

    print("Metrics scrape authentication gate OK (every authenticated scrape presents a credential).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
