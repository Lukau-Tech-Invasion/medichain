#!/usr/bin/env python3
"""Compare the paths the frontend calls against the routes the API registers.

WHY THIS EXISTS
---------------
A page that calls a URL the backend does not serve looks fine in TypeScript,
builds fine, and fails only when a human clicks it. That class of bug has hit
this repo before across whole feature clusters, and it is exactly what shows up
in a live demo.

This reads the two sides directly from source rather than from a generated CSV,
so it cannot go stale the way `docs/frontend-backend-crossref.csv` can:

  frontend  client/shared/src/api/endpoints.ts   getApiClient().<verb>('/api/..')
  backend   api/src/**/*.rs                      #[verb("/api/..")]

Path parameters are normalized on both sides (`${patientId}` and `{patient_id}`
both become `{}`) so only genuine path mismatches are reported.

LIMITS, STATED PLAINLY
----------------------
It compares paths, not HTTP verbs, and not request/response shapes. A path that
matches here can still be wrong in method or payload. It also cannot see calls
built by string concatenation at runtime. So a clean run means "no frontend
path is obviously unserved", never "the integration is correct".

Usage: python scripts/check-endpoint-drift.py
Exit 0 when every frontend path has a backend route, 1 otherwise.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "client" / "shared" / "src" / "api" / "endpoints.ts"
API_SRC = ROOT / "api" / "src"

# getApiClient().get('/api/x')  |  .post(`/api/x/${id}`)  — quote style varies.
FRONTEND_CALL = re.compile(
    r"""\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\s*\(\s*['"`](/api/[^'"`]*)['"`]""",
    re.IGNORECASE,
)
# #[get("/api/x/{id}")]
BACKEND_ROUTE = re.compile(r'#\[(get|post|put|delete|patch)\("([^"]+)"\)\]', re.IGNORECASE)
# .route("/api/metrics", web::get()...)
BACKEND_MANUAL = re.compile(r'\.route\(\s*"([^"]+)"')


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


def collect_frontend() -> dict:
    """path -> sorted list of verbs the frontend uses on it."""
    text = FRONTEND.read_text(encoding="utf-8", errors="replace")
    found = {}
    for verb, path in FRONTEND_CALL.findall(text):
        found.setdefault(normalize(path), set()).add(verb.lower())
    # exportDocumentToPdf uses raw fetch(), not the client wrapper.
    for raw in re.findall(r"fetch\(\s*`\$\{[^}]*\}(/api/[^`]*)`", text):
        found.setdefault(normalize(raw), set()).add("post")
    return found


def collect_backend() -> set:
    paths = set()
    for rs in API_SRC.rglob("*.rs"):
        text = rs.read_text(encoding="utf-8", errors="replace")
        for _verb, path in BACKEND_ROUTE.findall(text):
            paths.add(normalize(path))
        for path in BACKEND_MANUAL.findall(text):
            if path.startswith("/"):
                paths.add(normalize(path))
    return paths


def main() -> int:
    if not FRONTEND.exists():
        print(f"cannot read {FRONTEND}", file=sys.stderr)
        return 2

    frontend = collect_frontend()
    backend = collect_backend()

    print(f"frontend distinct paths : {len(frontend)}")
    print(f"backend  distinct routes: {len(backend)}")

    missing = sorted(p for p in frontend if p not in backend)

    if not missing:
        print("\nEvery frontend path resolves to a registered backend route.")
        print("(paths only - verbs and payload shapes are NOT checked)")
        return 0

    print(f"\n{len(missing)} frontend path(s) with NO matching backend route:\n")
    for path in missing:
        verbs = ",".join(sorted(frontend[path])).upper()
        print(f"  {verbs:<18} {path}")
    print("\nEach of these fails at runtime the moment a user opens the page that calls it.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
