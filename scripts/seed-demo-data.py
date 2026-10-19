"""Create the deterministic MediChain demonstration patient directory.

Requires an API started with IS_DEMO=true on PostgreSQL and an existing
administrator, supplied as DEMO_SEED_LOGIN_ID and DEMO_SEED_PASSWORD. The demo
accounts it creates share DEMO_ACCOUNT_PASSWORD, which the caller must choose: it
never starts the API, invents credentials, or writes to a database directly. Each
account is registered by the administrator, activated, and given its password by
redeeming the one-time credential code, exactly as a deployment does it; the seed
then acts as those accounts with their bearer tokens. The API accepts the stable
fixture keys only in demo mode.
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path
from datetime import date
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from auth_proof import derive_auth_proof  # noqa: E402

API_BASE = os.environ.get("API_BASE", "http://localhost:8090").rstrip("/")
SEED_LOGIN_ID = os.environ.get("DEMO_SEED_LOGIN_ID")
SEED_PASSWORD = os.environ.get("DEMO_SEED_PASSWORD")
DEMO_PASSWORD = os.environ.get("DEMO_ACCOUNT_PASSWORD")
# Marks a request that must carry no credential (the sign-in itself).
ANONYMOUS = "anonymous"
# The account a call without an explicit actor runs as: the demo doctor.
DEFAULT_ACTOR = 2
# Signed-in demo accounts by fixture index: {"token": ..., "user_id": ...}.
SESSIONS: dict[int, dict[str, str]] = {}
# The API rate-limits each client (240 requests a minute by default) and the
# seed can still burst past it. A 429 is waited out, never worked around.
RATE_LIMIT_MAX_ATTEMPTS = 6
RATE_LIMIT_FALLBACK_WAIT_SECS = 15
PATIENT_NAMES = (
    "Anele Mkhize", "Banele Dlamini", "Cebisa Ndlovu", "Dineo Molefe",
    "Ebrahim Jacobs", "Fikile Zungu", "Gugulethu Maseko", "Hlumelo Venter",
    "Inathi Mokoena", "Jabulile Khumalo", "Katlego Modise", "Lerato Mthembu",
    "Mandla Ncube", "Naledi Sibiya", "Onkarabile Mokoena", "Precious Mthethwa",
    "Qhawe Ngcobo", "Refilwe Moeketsi", "Siyabonga Cele", "Thembi Mhlongo",
    "Unathi Gqamane", "Vuyani Mhlanga", "Wandile Mthembu", "Xolile Jali",
    "Yanga Madlala", "Zinhle Dube", "Ayanda Dube", "Bongiwe Maseko",
    "Cyan Mthethwa", "Dumisani Nkomo", "Enhle Sefako", "Fanele Mokoena",
    "Gontse Molefe", "Hlengiwe Dlamini", "Imani Khumalo", "Jabari Ndlovu",
    "Keletso Maseko", "Lindiwe Zungu", "Mvelo Cele", "Nokuthula Ncube",
)
CONDITIONS = ("Hypertension", "Type 2 diabetes", "HIV on ART", "TB history")
DEMO_STAFF = (
    ("Admin", "MediChain Demo Administrator"),
    ("Doctor", "Dr Demo Mokoena"),
    ("Nurse", "Nurse Demo Dlamini"),
    ("LabTechnician", "Lab Demo Ndlovu"),
    ("Pharmacist", "Pharmacist Demo Jacobs"),
    ("Paramedic", "Paramedic Demo Khumalo"),
)


def demo_login_id(index: int) -> str:
    """Return the deterministic login id of the demo account at `index`."""
    return f"demo.staff{index:02d}"


def demo_user_id(index: int) -> str:
    """Return the user id (`users.id`) of the signed-in demo account at `index`."""
    return SESSIONS[index]["user_id"]


def luhn_is_valid(value: str) -> bool:
    """Return whether an all-digit string passes the Luhn checksum."""
    total = 0
    for position, digit in enumerate(reversed(value)):
        number = int(digit)
        if position % 2 == 1:
            number *= 2
            if number > 9:
                number -= 9
        total += number
    return total % 10 == 0


def invalid_national_id(index: int) -> str:
    """Build a clearly synthetic 13-digit value that deliberately fails Luhn."""
    candidate = f"9901015{index:06d}"
    if luhn_is_valid(candidate):
        return candidate[:-1] + str((int(candidate[-1]) + 1) % 10)
    return candidate


def patient_payload(index: int, name: str) -> dict[str, object]:
    """Return one stable, explicitly synthetic patient registration payload."""
    condition = CONDITIONS[(index - 1) % len(CONDITIONS)]
    payload: dict[str, object] = {
        "demo_seed_key": f"{index:03d}",
        "full_name": name,
        "date_of_birth": date(1958 + (index % 45), (index % 12) + 1, (index % 27) + 1).isoformat(),
        "national_id": invalid_national_id(index),
        "gender": "female" if index % 2 else "male",
        "phone": "+27000000000",
        "blood_type": "Unknown",
        "allergies": ["Penicillin"] if index == 1 else [],
        "current_medications": (
            ["Amlodipine 5 mg", "Metformin 500 mg", "Dolutegravir-based ART"]
            if index == 1 else []
        ),
        "chronic_conditions": [condition],
        "emergency_contact_name": "Demo emergency contact",
        "emergency_contact_phone": "+27000000000",
        "emergency_contact_relationship": "Demo contact",
        "organ_donor": False,
        "dnr_status": False,
        "languages": ["en"],
    }
    return payload


def request_json(path: str, payload: dict[str, object] | None, method: str = "POST", actor: int | str | None = None, reason: str | None = None) -> tuple[int, dict[str, object]]:
    """Send one fixture request, waiting out rate limits; return status and JSON.

    Parameters: API path, JSON body (None for a GET), method, acting user and
    optional stated access reason. Returns the final HTTP status and JSON body.
    """
    for _ in range(RATE_LIMIT_MAX_ATTEMPTS - 1):
        status, body = send_json_once(path, payload, method, actor, reason)
        if status != 429:
            return status, body
        details = body.get("details") if isinstance(body.get("details"), dict) else {}
        time.sleep(int(details.get("retry_after_secs", RATE_LIMIT_FALLBACK_WAIT_SECS)) + 1)
    return send_json_once(path, payload, method, actor, reason)


def bearer_for(actor: int | str | None) -> dict[str, str]:
    """The Authorization header for `actor`: a fixture index, or none when anonymous."""
    if actor == ANONYMOUS:
        return {}
    session = SESSIONS.get(DEFAULT_ACTOR if actor is None else int(actor))
    return {"Authorization": f"Bearer {session['token']}"} if session else {}


def send_json_once(path: str, payload: dict[str, object] | None, method: str, actor: int | str | None, reason: str | None) -> tuple[int, dict[str, object]]:
    """Send a single fixture request and return its status and JSON response."""
    request = Request(
        f"{API_BASE}{path}",
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        headers={
            "Content-Type": "application/json",
            **bearer_for(actor),
            **({"X-Access-Reason": reason} if reason else {}),
            # The API refuses authenticated mutations without an operation key,
            # and refuses a reused one as a replay, so each write gets a fresh
            # key. Idempotency of the seed itself comes from the stable fixture
            # identifiers and the "already present" checks, not from this key.
            **({"Idempotency-Key": str(uuid.uuid4())} if method != "GET" else {}),
        },
        method=method,
    )
    try:
        with urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8")
        try:
            return error.code, json.loads(body)
        except json.JSONDecodeError:
            return error.code, {"error": "The API returned a non-JSON error response."}
    except URLError as error:
        raise RuntimeError("The MediChain API is unavailable; start it separately before seeding.") from error


def request_registration(payload: dict[str, object]) -> tuple[int, dict[str, object]]:
    """Register one deterministic patient through the normal API boundary."""
    return request_json("/api/register", payload)


def sign_in(index: int, login_id: str, password: str) -> bool:
    """Sign in with `POST /api/auth/login` and keep the session; False on a refusal."""
    status, body = request_json("/api/auth/login", {
        "identifier": login_id, "auth_proof": derive_auth_proof(password, login_id),
    }, actor=ANONYMOUS)
    user = body.get("user") if isinstance(body.get("user"), dict) else {}
    if status != 200 or not body.get("access_token") or not user.get("user_id"):
        return False
    SESSIONS[index] = {"token": str(body["access_token"]), "user_id": str(user["user_id"])}
    return True


def ensure_account(index: int, login_id: str, role: str, name: str) -> None:
    """Have a signed-in demo account at `index`: sign in, else register and redeem.

    The administrator (fixture index 1) registers the account, activates it, and
    the account redeems its one-time credential code choosing DEMO_ACCOUNT_PASSWORD.
    """
    if sign_in(index, login_id, DEMO_PASSWORD or ""):
        return
    status, reg = request_json("/api/auth/register", {"name": name, "role": role, "login_id": login_id}, actor=1)
    user_id, code = reg.get("user_id"), reg.get("credential_code")
    if status not in (200, 201) or not user_id or not code:
        raise RuntimeError(f"Demo {role} account failed with HTTP {status}: {reg.get('error', reg)}")
    status, response = request_json(f"/api/users/{user_id}", {"status": "active"}, method="PUT", actor=1)
    if status not in (200, 204):
        raise RuntimeError(f"Activating the demo {role} account failed with HTTP {status}: {response.get('error', response)}")
    status, redeemed = request_json("/api/auth/credentials/redeem", {
        "identifier": login_id, "code": code, "password": DEMO_PASSWORD or "",
    }, actor=ANONYMOUS)
    if status != 200 or not sign_in(index, login_id, DEMO_PASSWORD or ""):
        raise RuntimeError(f"Redeeming the demo {role} credential failed with HTTP {status}: {redeemed.get('error', redeemed)}")


def seed_demo_staff() -> None:
    """Create one explicit demo user for each supported staff role.

    Index 1 is the administrator the seed itself runs as; the others are
    registered by it.
    """
    if not sign_in(1, SEED_LOGIN_ID or "", SEED_PASSWORD or ""):
        raise RuntimeError("DEMO_SEED_LOGIN_ID / DEMO_SEED_PASSWORD did not sign in as an administrator.")
    for index, (role, name) in enumerate(DEMO_STAFF, start=1):
        if index > 1:
            ensure_account(index, demo_login_id(index), role, name)


def seed_primary_progress_note() -> None:
    """Seed the primary patient's stable progress note without duplicate writes."""
    status, response = request_json("/api/clinical/progress-note", {
        "note_id": "PN-DEMO-001",
        "patient_id": "PAT-DEMO-001",
        "note_type": "daily",
        "note_date": "2026-01-15",
        "subjective": "Synthetic demonstration follow-up; no real patient data.",
        "exam": "Synthetic stable examination for product demonstration.",
        "assessment": [{"problem_number": 1, "problem": "Hypertension", "status": "stable", "plan": "Continue documented treatment plan."}],
        "plan": ["Review prescribed medicines at the next demonstration encounter."],
        "author": "Demo clinician",
        "note_time": 1768478400,
        "cosigned_by": None,
    })
    if status not in (201, 409):
        raise RuntimeError(f"Primary progress note failed with HTTP {status}: {response.get('error', response)}")


def seed_primary_guardian(seeded: dict[str, bool]) -> None:
    """Verify one synthetic guardian relationship only when it is absent."""
    ensure_account(7, demo_login_id(7), "Patient", "Demo Primary Guardian")
    guardian = demo_user_id(7)
    if seeded["guardian"]:
        return
    status, response = request_json("/api/guardians/verify", {
        "guardian_user_id": guardian, "ward_patient_id": "PAT-DEMO-001",
        "relationship_type": "parent_or_guardian", "permissions": ["view_records"],
        "expires_at": None, "authority_evidence_type": None,
        "authority_evidence_reference": None, "authority_issuing_authority": None,
        "authority_verified_by_role": None, "next_reverification_due": None,
        "child_assent_status": None, "child_assent_notes": None,
        "supersedes_relationship_id": None,
    }, actor=1)
    if status != 201:
        raise RuntimeError(f"Guardian relationship failed with HTTP {status}: {response.get('error', response)}")


def seed_primary_emergency_capsule(seeded: dict[str, bool]) -> None:
    """Publish the primary fixture's capsule once without changing later runs."""
    if seeded["emergency_capsule"]:
        return
    status, response = request_json("/api/patients/PAT-DEMO-001/emergency-capsule", {}, actor=2)
    if status != 200:
        raise RuntimeError(f"Emergency capsule publication failed with HTTP {status}: {response.get('error', response)}")


def create_primary_radiology_order(clinician: int) -> str:
    """Create the radiology order the primary imaging report answers; return its id.

    The server assigns order ids, so the report cannot name a fixed one: a
    report pointing at an order that does not exist is refused by the
    `radiology_reports.order_id` foreign key.
    """
    status, response = request_json("/api/surgical/radiology/order", {
        "patient_id": "PAT-DEMO-001", "study_type": "XRay", "body_part": "Chest",
        "laterality": None, "indication": "Synthetic demonstration imaging order.",
        "priority": "Routine", "ordering_provider": demo_user_id(clinician), "order_time": 1768474800,
        "contrast": False, "allergies_reviewed": True, "creatinine_checked": None,
        "pregnancy_checked": None, "special_instructions": None, "status": "Completed",
    }, actor=clinician)
    if status != 201:
        raise RuntimeError(f"Primary imaging order failed with HTTP {status}: {response.get('error', response)}")
    return str(response["id"])


def seed_primary_imaging_report(seeded: dict[str, bool]) -> None:
    """Create one stable synthetic imaging report, and its order, only when absent."""
    if seeded["imaging_report"]:
        return
    clinician = 2
    order_id = create_primary_radiology_order(clinician)
    status, response = request_json("/api/surgical/radiology/report", {
        "report_id": "RAD-DEMO-001", "patient_id": "PAT-DEMO-001", "order_id": order_id,
        "accession_number": "ACC-DEMO-001", "study_type": "XRay", "body_part": "Chest",
        "study_datetime": 1768478400, "technique": "Single frontal chest radiograph", "contrast": None,
        "comparison": None, "clinical_history": "Synthetic demonstration imaging record.",
        "findings": "Synthetic demonstration finding; no clinical interpretation.",
        "impression": ["Synthetic demonstration report."], "recommendations": None,
        "critical_finding": False, "critical_communicated": None, "radiologist": "Demo radiologist",
        "status": "Final", "preliminary_time": None, "final_time": 1768478400,
        "dicom_study_uid": None, "image_ipfs_hash": None,
    }, actor=clinician)
    if status not in (200, 201):
        raise RuntimeError(f"Primary imaging report failed with HTTP {status}: {response.get('error', response)}")


def seed_primary_lab_result() -> None:
    """Submit one stable mmol/L laboratory result through the real workflow."""
    status, response = request_json("/api/lab/submit", {
        "demo_seed_key": "001", "patient_id": "PAT-DEMO-001", "test_name": "Demonstration glucose",
        "test_category": "Chemistry", "facility_id": "demo-facility-jhb",
        "results": [{"parameter": "Glucose", "value": "5.4", "unit": "mmol/L", "reference_range": "3.9-7.8", "flag": None}],
        "notes": "Synthetic demonstration laboratory result; mmol/L.",
    }, actor=4)
    if status not in (200, 201):
        raise RuntimeError(f"Primary laboratory result failed with HTTP {status}: {response.get('error', response)}")


def seed_paramedic_emergency_access(seeded: dict[str, bool]) -> None:
    """Perform one idempotent, grant-bound paramedic emergency disclosure."""
    if seeded["paramedic_emergency_access"]:
        return
    admin, paramedic = 1, 6
    status, devices = request_json("/api/devices", None, method="GET", actor=admin)
    if status != 200:
        raise RuntimeError(f"Device list failed with HTTP {status}: {devices.get('error', devices)}")
    fingerprint = "MEDICHAIN-DEMO-EMS-001"
    device = next((item for item in devices.get("devices", []) if item.get("hardware_fingerprint") == fingerprint), None)
    if device is None:
        status, device = request_json("/api/devices/enroll", {"organization_id": "demo-organization", "facility_id": "demo-facility-jhb", "device_name": "Demo EMS tablet", "device_type": "tablet", "hardware_fingerprint": fingerprint, "platform": "demo"}, actor=admin)
        if status != 201:
            raise RuntimeError(f"Device enrollment failed with HTTP {status}: {device.get('error', device)}")
    if not device.get("current_key_id"):
        status, device = request_json(f"/api/devices/{device['id']}/rotate", {"key_id": "demo-ems-key-001"}, actor=admin)
        if status != 200:
            raise RuntimeError(f"Device rotation failed with HTTP {status}: {device.get('error', device)}")
    status, context = request_json("/api/identity/context/work", {}, actor=paramedic)
    if status != 200:
        raise RuntimeError(f"Paramedic work context failed with HTTP {status}: {context.get('error', context)}")
    status, response = request_json("/api/emergency/access", {"nfc_tag_id": "NFC-DEMO-001", "device_id": device["id"], "work_context_id": context["context"]["id"], "reason_code": "demo_emergency", "reason_text": "Synthetic demonstration emergency access."}, actor=paramedic)
    if status != 200:
        raise RuntimeError(f"Paramedic emergency access failed with HTTP {status}: {response.get('error', response)}")


def seed_primary_care_relationship(seeded: dict[str, bool]) -> None:
    """Book the demo doctor a follow-up with the primary patient.

    Since WP9 a clinician needs a care relationship to open a chart, and a
    relationship comes from real clinical workflow, never from a seed shortcut:
    booking the appointment is what records it. Skipped when one is active.
    """
    if seeded.get("care_relationship"):
        return
    tomorrow = int(time.time()) + 24 * 3600
    status, response = request_json("/api/appointments", {
        "patient_id": "PAT-DEMO-001", "appointment_type": "FollowUp",
        "preferred_date": time.strftime("%Y-%m-%d", time.gmtime(tomorrow)),
        "preferred_time": "09:00", "scheduled_at": str(tomorrow), "duration_minutes": 30,
        "reason": "Synthetic demonstration follow-up",
    }, actor=2)
    if status not in (200, 201):
        raise RuntimeError(f"Demo care relationship failed with HTTP {status}: {response.get('error', response)}")


def seed_primary_access_history(seeded: dict[str, bool]) -> None:
    """Read primary records through audited endpoints to create demo history.

    Each read is a real, audited disclosure that the patient will see, so it
    runs only when the stated-reason session is not already on record.
    """
    if seeded["treatment_session"]:
        return
    doctor = 2
    reads = (
        ("/api/patients/PAT-DEMO-001", "Treatment: profile"),
        ("/api/clinical/patient/PAT-DEMO-001/vitals", "Treatment: vitals"),
        ("/api/lab/patient/PAT-DEMO-001", "Treatment: labs"),
        ("/api/clinical/patient/PAT-DEMO-001/progress-notes", "Treatment: notes"),
        ("/api/patients/PAT-DEMO-001", "Referral review"),
    )
    for path, reason in reads:
        status, response = request_json(path, None, method="GET", actor=doctor, reason=reason)
        if status != 200:
            raise RuntimeError(f"Demo access history failed with HTTP {status}: {response.get('error', response)}")


def seed_primary_vitals() -> None:
    """Seed the primary patient's mmol/L vital signs without duplicate rows."""
    status, response = request_json("/api/clinical/vitals", {
        "demo_seed_key": "001", "patient_id": "PAT-DEMO-001", "heart_rate": 76,
        "systolic_bp": 128, "diastolic_bp": 78, "respiratory_rate": 16,
        "oxygen_saturation": 98, "temperature_celsius": 36.8, "pain_scale": 0,
        "blood_glucose": 5.4, "notes": "Synthetic demonstration reading; mmol/L.",
    })
    if status not in (200, 201):
        raise RuntimeError(f"Primary vital signs failed with HTTP {status}: {response.get('error', response)}")


def fetch_seed_status() -> dict[str, bool]:
    """Ask the demo-only probe which primary-fixture steps already exist.

    Checking through the chart routes would itself be an audited read on the
    demo patient's history, so a re-run would never leave the database as it
    found it. The probe answers with booleans only.
    """
    status, response = request_json("/api/demo/seed-status", None, method="GET")
    if status != 200:
        raise RuntimeError(f"Demo seed status failed with HTTP {status}: {response.get('error', response)}")
    return {key: bool(value) for key, value in response.items()}


def main() -> int:
    """Seed all fixtures once and report a retry-safe, honest result."""
    if not (SEED_LOGIN_ID and SEED_PASSWORD and DEMO_PASSWORD):
        print(
            "DEMO_SEED_LOGIN_ID and DEMO_SEED_PASSWORD (an existing administrator) and "
            "DEMO_ACCOUNT_PASSWORD (the password the demo accounts will share) are required.",
            file=sys.stderr,
        )
        return 2
    try:
        seed_demo_staff()
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 1
    facility_status, facility_response = request_json("/api/demo/seed-facilities", {})
    if facility_status != 200:
        print(f"Facility seed failed with HTTP {facility_status}: {facility_response.get('error', facility_response)}", file=sys.stderr)
        return 1
    created = 0
    already_present = 0
    for index, name in enumerate(PATIENT_NAMES, start=1):
        status, response = request_registration(patient_payload(index, name))
        if status == 201:
            created += 1
        elif status == 200 and response.get("chain_status") == "already_seeded":
            already_present += 1
        else:
            print(f"Fixture {index:03d} failed with HTTP {status}: {response.get('error', response)}", file=sys.stderr)
            return 1
    try:
        seed_primary_vitals()
        seed_primary_progress_note()
        seed_primary_lab_result()
        seeded = fetch_seed_status()
        seed_primary_imaging_report(seeded)
        seed_primary_guardian(seeded)
        seed_primary_emergency_capsule(seeded)
        seed_paramedic_emergency_access(seeded)
        seed_primary_care_relationship(seeded)
        seed_primary_access_history(seeded)
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 1
    print(f"Demo seed complete: {created} created, {already_present} already present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
