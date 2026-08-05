#!/usr/bin/env python3
"""Catch workflow-file errors that make GitHub reject an entire workflow.

WHY THIS EXISTS
---------------
`.github/workflows/ci.yml` failed in 0 seconds on every push from 2026-07-27 to
2026-08-05. Not one of its eight jobs ever ran — not the endpoint-authorization
gate, not the dual-backend e2e matrix. The cause was a single `working-directory:`
key on a `uses:` step, in a job that was `if:`-disabled and never even executed.
GitHub validates the whole file before running anything, so one invalid key
anywhere silences everything.

It went unnoticed for over a week because `verification.yml` publishes checks
named "Rust format and tests" and "Client builds". Those are green, and at a
glance they read like full CI coverage. A pull request looked adequately tested
while the actual gates were dead.

The lesson generalizes past this one key: a workflow that fails to parse produces
NO failing job, so it is invisible in exactly the places people look. Valid YAML
is not a valid workflow — `yaml.safe_load` accepts all of this happily.

Usage: python scripts/lint-workflows.py [path ...]   (defaults to .github/workflows)
Exit 0 clean, 1 on findings.
"""
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("PyYAML required: pip install pyyaml", file=sys.stderr)
    sys.exit(2)

# Valid only on `run:` steps. On a `uses:` step GitHub errors with
# "Unexpected value '<key>'" and rejects the file.
RUN_ONLY_STEP_KEYS = {"working-directory", "shell"}

# Keys a step may carry regardless of kind.
COMMON_STEP_KEYS = {
    "id", "if", "name", "env", "continue-on-error", "timeout-minutes",
}
USES_STEP_KEYS = COMMON_STEP_KEYS | {"uses", "with"}
RUN_STEP_KEYS = COMMON_STEP_KEYS | {"run", "working-directory", "shell"}


def lint_file(path: Path) -> list[str]:
    problems: list[str] = []
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        return [f"{path}: YAML does not parse: {exc}"]

    if not isinstance(doc, dict):
        return [f"{path}: top level is not a mapping"]

    jobs = doc.get("jobs")
    if not isinstance(jobs, dict):
        return [f"{path}: no 'jobs' mapping"]

    for job_name, job in jobs.items():
        if not isinstance(job, dict):
            problems.append(f"{path}: job '{job_name}' is not a mapping")
            continue

        # A job must be runnable or a reusable-workflow call.
        if "uses" not in job:
            for required in ("runs-on", "steps"):
                if required not in job:
                    problems.append(
                        f"{path}: job '{job_name}' is missing required key '{required}'"
                    )

        for index, step in enumerate(job.get("steps") or []):
            where = f"{path}: job '{job_name}' step[{index}]"
            if not isinstance(step, dict):
                problems.append(f"{where} is not a mapping")
                continue

            label = step.get("name", "<unnamed>")
            has_uses, has_run = "uses" in step, "run" in step

            if has_uses and has_run:
                problems.append(f"{where} '{label}' has BOTH 'uses' and 'run'")
                continue
            if not has_uses and not has_run:
                problems.append(f"{where} '{label}' has NEITHER 'uses' nor 'run'")
                continue

            if has_uses:
                # The defect that killed this repo's CI for over a week.
                misplaced = RUN_ONLY_STEP_KEYS & set(step)
                if misplaced:
                    problems.append(
                        f"{where} '{label}' uses={step['uses']}\n"
                        f"    '{sorted(misplaced)[0]}' is valid only on a 'run:' step. "
                        f"GitHub will reject the ENTIRE workflow file, and every job "
                        f"in it will silently never run."
                    )
                unknown = set(step) - USES_STEP_KEYS
                if unknown:
                    problems.append(
                        f"{where} '{label}' has unexpected key(s) on a 'uses' step: {sorted(unknown)}"
                    )
            else:
                unknown = set(step) - RUN_STEP_KEYS
                if unknown:
                    problems.append(
                        f"{where} '{label}' has unexpected key(s) on a 'run' step: {sorted(unknown)}"
                    )

    return problems


def main() -> int:
    targets = [Path(a) for a in sys.argv[1:]] or sorted(
        Path(".github/workflows").glob("*.y*ml")
    )
    if not targets:
        print("no workflow files found", file=sys.stderr)
        return 2

    all_problems: list[str] = []
    for path in targets:
        all_problems.extend(lint_file(path))

    for problem in all_problems:
        print(f"ERROR {problem}")

    scanned = ", ".join(p.name for p in targets)
    if all_problems:
        print(f"\nworkflow lint: {len(all_problems)} problem(s) in {scanned}")
        return 1
    print(f"workflow lint: {scanned} OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
