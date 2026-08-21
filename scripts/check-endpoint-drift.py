#!/usr/bin/env python3
"""Compare frontend API calls against the routes and methods the API registers.

WHY THIS EXISTS
---------------
A page that calls a URL the backend does not serve looks fine in TypeScript,
builds fine, and fails only when a human clicks it. That class of bug has hit
this repo before across whole feature clusters, and it is exactly what shows up
in a live demo.

This reads the two sides directly from source rather than from a generated CSV,
so it cannot go stale the way `docs/frontend-backend-crossref.csv` can:

  frontend  client/{shared,doctor-portal,patient-app}/src/**/*.ts(x)
            getApiClient().<verb>('/api/..') and direct fetch('/api/..') calls
  backend   api/src/**/*.rs                      #[verb("/api/..")]

Path parameters are normalized on both sides (`${patientId}` and `{patient_id}`
both become `{}`) so only genuine path mismatches are reported.

LIMITS, STATED PLAINLY
----------------------
It compares paths and HTTP verbs, but not request/response shapes. It cannot
resolve calls whose URL or method is assembled entirely at runtime. A clean run
means "no statically visible frontend call is unserved", never "the integration
is correct".

Usage: python scripts/check-endpoint-drift.py
Exit 0 when every frontend path has a backend route, 1 otherwise.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLIENT_SRC = (
    ROOT / "client" / "shared" / "src",
    ROOT / "client" / "doctor-portal" / "src",
    ROOT / "client" / "patient-app" / "src",
)
API_SRC = ROOT / "api" / "src"

# getApiClient().get('/api/x')  |  .post(`/api/x/${id}`)  — quote style varies.
FRONTEND_CALL = re.compile(
    r"""\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\s*\(\s*['"`](/api/[^'"`]*)['"`]""",
    re.IGNORECASE,
)
# #[get("/api/x/{id}")]
BACKEND_ROUTE = re.compile(
    r'#\[(?:actix_web::)?(get|post|put|delete|patch)\("([^"]+)"\)\]',
    re.IGNORECASE,
)
# .route("/api/metrics", web::get()...)
BACKEND_MANUAL = re.compile(
    r'\.route\(\s*"([^"]+)"\s*,\s*web::(get|post|put|delete|patch)\s*\(',
    re.IGNORECASE,
)
FETCH_START = re.compile(r"\bfetch\s*\(")
FETCH_PATH = re.compile(r"(/api/[^\s'\"`)]+)")
FETCH_METHOD = re.compile(
    r"\bmethod\s*:\s*['\"](get|post|put|delete|patch)['\"]", re.IGNORECASE
)


def normalize(path: str) -> str:
    """Collapse every parameter spelling to a single placeholder.

    The subtle case is an interpolation that is a QUERY suffix rather than a
    path segment — `/api/admin/cds/audit${q}` where `q` is "?patient_id=..".
    Naively that becomes `/api/admin/cds/audit{}` and gets reported as drift
    against a backend route that plainly exists. Reporting a correct call as
    broken is worse than useless: a checker that cries wolf stops being read.

    The distinguishing rule is positional — a real path parameter always
    follows a `/`, so a placeholder that does NOT is a suffix and is dropped.
    """
    path = re.sub(r"\$\{[^{}]*\}", "{}", path)  # ${patientId}
    path = path.split("$")[0]                   # nested template we can't parse
    path = path.split("?")[0]
    path = re.sub(r"\{[^{}]*\}", "{}", path)    # {patient_id} -> {}
    path = re.sub(r"(?<!/)\{\}", "", path)      # suffix placeholder, not a segment
    path = re.sub(r"/+", "/", path)
    return path.rstrip("/") or "/"


def source_files():
    """Yield production TypeScript sources, excluding generated and test code."""
    for source_root in CLIENT_SRC:
        if not source_root.exists():
            continue
        for path in source_root.rglob("*.ts*"):
            if ".test." not in path.name and ".spec." not in path.name:
                yield path


def fetch_calls(text: str):
    """Yield complete fetch(...) expressions using a small balanced scanner."""
    for match in FETCH_START.finditer(text):
        depth = 0
        quote = None
        escaped = False
        for index in range(match.end() - 1, len(text)):
            char = text[index]
            if quote:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == quote:
                    quote = None
                continue
            if char in "'\"`":
                quote = char
            elif char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    yield match.start(), text[match.start() : index + 1]
                    break


def record(found: dict, verb: str, path: str, source: Path, line: int) -> None:
    """Record a normalized frontend call and its source location."""
    key = (verb.lower(), normalize(path))
    location = f"{source.relative_to(ROOT).as_posix()}:{line}"
    found.setdefault(key, set()).add(location)


def collect_frontend() -> dict:
    """Return (verb, path) -> source locations for statically visible calls."""
    found = {}
    for source in source_files():
        text = source.read_text(encoding="utf-8", errors="replace")
        for match in FRONTEND_CALL.finditer(text):
            verb, path = match.groups()
            record(found, verb, path, source, text.count("\n", 0, match.start()) + 1)
        for offset, call in fetch_calls(text):
            path_match = FETCH_PATH.search(call)
            if not path_match:
                continue
            method_match = FETCH_METHOD.search(call)
            verb = method_match.group(1) if method_match else "get"
            line = text.count("\n", 0, offset) + 1
            record(found, verb, path_match.group(1), source, line)
    return found


def collect_backend() -> set:
    """Return every production (verb, normalized path) route declaration."""
    routes = set()
    for rs in API_SRC.rglob("*.rs"):
        text = rs.read_text(encoding="utf-8", errors="replace")
        for verb, path in BACKEND_ROUTE.findall(text):
            routes.add((verb.lower(), normalize(path)))
    routes_file = API_SRC / "routes.rs"
    text = routes_file.read_text(encoding="utf-8", errors="replace")
    for path, verb in BACKEND_MANUAL.findall(text):
        routes.add((verb.lower(), normalize(path)))
    return routes


def main() -> int:
    if not any(path.exists() for path in CLIENT_SRC):
        print("cannot read client source directories", file=sys.stderr)
        return 2

    frontend = collect_frontend()
    backend = collect_backend()

    frontend_paths = {path for _verb, path in frontend}
    backend_paths = {path for _verb, path in backend}
    print(f"frontend verb/path calls: {len(frontend)} ({len(frontend_paths)} paths)")
    print(f"backend  verb/path routes: {len(backend)} ({len(backend_paths)} paths)")

    missing = sorted(call for call in frontend if call not in backend)

    if not missing:
        print("\nEvery statically visible frontend verb/path call resolves to a backend route.")
        print("(request and response payload shapes are not checked)")
        return 0

    print(f"\n{len(missing)} frontend call(s) with NO matching backend verb/path route:\n")
    for verb, path in missing:
        locations = ", ".join(sorted(frontend[(verb, path)]))
        print(f"  {verb.upper():<8} {path}")
        print(f"           {locations}")
    print("\nEach of these fails at runtime the moment a user opens the page that calls it.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
