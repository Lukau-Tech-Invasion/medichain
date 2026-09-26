"""Create the deterministic MediChain demonstration patient directory.

Requires an API started with IS_DEMO=true and an existing clinician supplied as
DEMO_SEED_USER. It never starts the API, invents credentials, or writes to a
database directly. The API accepts the stable fixture keys only in demo mode.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API_BASE = os.environ.get("API_BASE", "http://localhost:8090").rstrip("/")
ACTOR = os.environ.get("DEMO_SEED_USER")
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


def demo_wallet(index: int) -> str:
    """Return a deterministic, format-valid local demo wallet identifier."""
    return "5" + f"DEMO{index:02d}" + "A" * 41


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


def request_json(path: str, payload: dict[str, object] | None, method: str = "POST", actor: str | None = None, reason: str | None = None) -> tuple[int, dict[str, object]]:
    """POST a demo fixture request and return its status and JSON response."""
    request = Request(
        f"{API_BASE}{path}",
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        headers={
            "Content-Type": "application/json",
            "X-User-Id": actor or ACTOR or "",
            **({"X-Access-Reason": reason} if reason else {}),
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


def seed_demo_staff() -> None:
    """Create one explicit demo user for each supported staff role."""
    for index, (role, name) in enumerate(DEMO_STAFF, start=1):
        status, response = request_json("/api/auth/demo-login", {
            "wallet_address": demo_wallet(index), "role": role, "name": name,
        })
        if status not in (200, 201):
            raise RuntimeError(f"Demo {role} user failed with HTTP {status}: {response.get('error', response)}")


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


def seed_primary_guardian() -> None:
    """Verify one synthetic guardian relationship only when it is absent."""
    guardian = demo_wallet(7)
    status, response = request_json("/api/auth/demo-login", {
        "wallet_address": guardian, "role": "Patient", "name": "Demo Primary Guardian",
    })
    if status not in (200, 201):
        raise RuntimeError(f"Demo guardian user failed with HTTP {status}: {response.get('error', response)}")
    status, response = request_json("/api/guardians/ward/PAT-DEMO-001", None, method="GET", actor=demo_wallet(1))
    if status != 200:
        raise RuntimeError(f"Guardian lookup failed with HTTP {status}: {response.get('error', response)}")
    if any(item.get("guardian_wallet") == guardian for item in response.get("relationships", [])):
        return
    status, response = request_json("/api/guardians/verify", {
        "guardian_wallet": guardian, "ward_patient_id": "PAT-DEMO-001",
        "relationship_type": "ParentOrGuardian", "permissions": ["view_records"],
        "expires_at": None, "authority_evidence_type": None,
        "authority_evidence_reference": None, "authority_issuing_authority": None,
        "authority_verified_by_role": None, "next_reverification_due": None,
        "child_assent_status": None, "child_assent_notes": None,
        "supersedes_relationship_id": None,
    }, actor=demo_wallet(1))
    if status != 201:
        raise RuntimeError(f"Guardian relationship failed with HTTP {status}: {response.get('error', response)}")


def seed_primary_emergency_capsule() -> None:
    """Publish the primary fixture's capsule once without changing later runs."""
    path = "/api/patients/PAT-DEMO-001/emergency-capsule"
    status, response = request_json(path, None, method="GET", actor=demo_wallet(2))
    if status != 200:
        raise RuntimeError(f"Emergency capsule lookup failed with HTTP {status}: {response.get('error', response)}")
    if response.get("current") is not None:
        return
    status, response = request_json(path, {}, actor=demo_wallet(2))
    if status != 200:
        raise RuntimeError(f"Emergency capsule publication failed with HTTP {status}: {response.get('error', response)}")


def seed_primary_imaging_report() -> None:
    """Create one stable synthetic imaging report through the clinical API."""
    status, response = request_json("/api/surgical/radiology/report", {
        "report_id": "RAD-DEMO-001", "patient_id": "PAT-DEMO-001", "order_id": "ORD-DEMO-001",
        "accession_number": "ACC-DEMO-001", "study_type": "XRay", "body_part": "Chest",
        "study_datetime": 1768478400, "technique": "Single frontal chest radiograph", "contrast": None,
        "comparison": None, "clinical_history": "Synthetic demonstration imaging record.",
        "findings": "Synthetic demonstration finding; no clinical interpretation.",
        "impression": ["Synthetic demonstration report."], "recommendations": None,
        "critical_finding": False, "critical_communicated": None, "radiologist": "Demo radiologist",
        "status": "Final", "preliminary_time": None, "final_time": 1768478400,
        "dicom_study_uid": None, "image_ipfs_hash": None,
    }, actor=demo_wallet(2))
    if status not in (200, 201):
        raise RuntimeError(f"Primary imaging report failed with HTTP {status}: {response.get('error', response)}")


def seed_primary_lab_result() -> None:
    """Submit one stable mmol/L laboratory result through the real workflow."""
    status, response = request_json("/api/lab/submit", {
        "demo_seed_key": "001", "patient_id": "PAT-DEMO-001", "test_name": "Demonstration glucose",
        "test_category": "Chemistry", "facility_id": "demo-facility-jhb",
        "results": [{"parameter": "Glucose", "value": "5.4", "unit": "mmol/L", "reference_range": "3.9-7.8", "flag": None}],
        "notes": "Synthetic demonstration laboratory result; mmol/L.",
    }, actor=demo_wallet(4))
    if status not in (200, 201):
        raise RuntimeError(f"Primary laboratory result failed with HTTP {status}: {response.get('error', response)}")


def seed_paramedic_emergency_access() -> None:
    """Perform one idempotent, grant-bound paramedic emergency disclosure."""
    admin, paramedic = demo_wallet(1), demo_wallet(6)
    status, history = request_json("/api/access-logs/PAT-DEMO-001", None, method="GET", actor=admin)
    if status != 200:
        raise RuntimeError(f"Emergency history lookup failed with HTTP {status}: {history.get('error', history)}")
    if any(entry.get("accessor_id") == paramedic and entry.get("emergency") for entry in history.get("access_logs", [])):
        return
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


def seed_primary_access_history() -> None:
    """Read primary records through audited endpoints to create demo history."""
    doctor = demo_wallet(2)
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


def main() -> int:
    """Seed all fixtures once and report a retry-safe, honest result."""
    if not ACTOR:
        print("DEMO_SEED_USER is required and must name an existing demo clinician.", file=sys.stderr)
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
        seed_primary_imaging_report()
        seed_primary_guardian()
        seed_primary_emergency_capsule()
        seed_paramedic_emergency_access()
        seed_primary_access_history()
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 1
    print(f"Demo seed complete: {created} created, {already_present} already present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
