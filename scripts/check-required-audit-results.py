#!/usr/bin/env python3
"""Reject handlers that can lose a required access-audit result silently."""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "api" / "src"
CANONICAL_WRITER = SOURCE / "support.rs"
CALL = re.compile(
    r"(?P<prefix>.{0,240})\.access_logs\s*\.create\s*\(.{0,3200}?\)\s*"
    r"\.await(?P<suffix>.{0,300})",
    re.DOTALL,
)


def strip_test_modules(text: str) -> str:
    """Remove comments and complete cfg(test) modules from production scanning."""
    text = re.sub(r"//.*", "", text)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    output: list[str] = []
    cursor = 0
    while match := re.search(r"#\[cfg\(test\)\]\s*mod\s+\w+\s*\{", text[cursor:]):
        output.append(text[cursor : cursor + match.start()])
        end = cursor + match.end()
        depth = 1
        while end < len(text) and depth:
            depth += (text[end] == "{") - (text[end] == "}")
            end += 1
        cursor = end
    output.append(text[cursor:])
    return "".join(output)


def ignored_calls(text: str) -> list[int]:
    """Return offsets of direct audit calls whose failure is discarded."""
    failures: list[int] = []
    for match in CALL.finditer(text):
        prefix = match.group("prefix")
        suffix = match.group("suffix").lstrip()
        if re.search(r"let\s+_\s*=", prefix) or re.search(r"if\s+let\s+Err", prefix):
            failures.append(match.start())
        elif suffix.startswith(";"):
            failures.append(match.start())
    return failures


def self_test() -> None:
    """Falsify each ignored-result family before trusting the repository scan."""
    bad = [
        "let _ = data.repositories.access_logs.create(entry).await;",
        "if let Err(error) = data.repositories.access_logs.create(entry).await { log(error); }",
        "data.repositories.access_logs.create(entry).await;",
    ]
    for snippet in bad:
        assert ignored_calls(snippet), f"gate failed to reject {snippet!r}"
    good = [
        "data.repositories.access_logs.create(entry).await?;",
        "data.repositories.access_logs.create(entry).await.map_err(map_error)?;",
        "crate::support::require_durable_audit(&data, entry).await?;",
    ]
    for snippet in good:
        assert not ignored_calls(snippet), f"gate falsely rejected {snippet!r}"


def main() -> int:
    self_test()
    failures: list[str] = []
    for path in sorted(SOURCE.rglob("*.rs")):
        # The canonical helper owns the direct repository call and converts its
        # error into a stable fail-closed response. Scan every caller instead.
        if path == CANONICAL_WRITER:
            continue
        body = strip_test_modules(path.read_text(encoding="utf-8", errors="replace"))
        for offset in ignored_calls(body):
            line = body.count("\n", 0, offset) + 1
            failures.append(f"{path.relative_to(ROOT).as_posix()}:{line}")
    if failures:
        print("Required audit result gate FAILED:")
        for failure in failures:
            print(f"  {failure}")
        print("Persist through require_durable_audit or propagate the repository error.")
        return 1
    print("Required audit result gate OK (self-falsified; 0 ignored results).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
