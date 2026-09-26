"""Unit tests for the deterministic demo fixture definitions."""

import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).with_name("seed-demo-data.py")
SPEC = importlib.util.spec_from_file_location("seed_demo_data", MODULE_PATH)
assert SPEC and SPEC.loader
seed_demo_data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(seed_demo_data)


class DemoSeedTests(unittest.TestCase):
    """Verify the fixture identities remain safe and deterministic."""

    def test_every_fixture_identifier_deliberately_fails_luhn(self) -> None:
        for index in range(1, 41):
            self.assertFalse(seed_demo_data.luhn_is_valid(seed_demo_data.invalid_national_id(index)))

    def test_demo_staff_covers_each_supported_staff_role(self) -> None:
        roles = {role for role, _ in seed_demo_data.DEMO_STAFF}
        self.assertEqual(roles, {"Admin", "Doctor", "Nurse", "LabTechnician", "Pharmacist", "Paramedic"})
        wallets = [seed_demo_data.demo_wallet(index) for index in range(1, len(seed_demo_data.DEMO_STAFF) + 1)]
        self.assertEqual(len(wallets), len(set(wallets)))
        self.assertTrue(all(wallet.startswith("5") and 45 <= len(wallet) <= 50 for wallet in wallets))

    def test_primary_fixture_has_the_required_safe_clinical_shape(self) -> None:
        fixture = seed_demo_data.patient_payload(1, seed_demo_data.PATIENT_NAMES[0])
        self.assertEqual(fixture["demo_seed_key"], "001")
        self.assertEqual(fixture["blood_type"], "Unknown")
        self.assertEqual(len(fixture["current_medications"]), 3)
        self.assertIn("Penicillin", fixture["allergies"])

    def test_primary_access_seed_declares_distinct_reasons(self) -> None:
        source = Path(MODULE_PATH).read_text()
        self.assertIn("Referral review", source)
        self.assertIn("Treatment: vitals", source)


if __name__ == "__main__":
    unittest.main()
