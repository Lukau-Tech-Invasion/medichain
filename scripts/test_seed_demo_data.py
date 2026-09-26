"""Unit tests for the deterministic demo fixture definitions."""

import importlib.util
from pathlib import Path
import unittest
from unittest import mock


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


class RateLimitTests(unittest.TestCase):
    """A 429 is waited out and retried a bounded number of times, never bypassed."""

    def test_a_rate_limited_request_is_retried_after_the_advertised_wait(self) -> None:
        responses = [(429, {"details": {"retry_after_secs": 3}}), (201, {"id": "ok"})]
        with mock.patch.object(seed_demo_data, "send_json_once", side_effect=responses) as send, \
                mock.patch.object(seed_demo_data.time, "sleep") as sleep:
            self.assertEqual(seed_demo_data.request_json("/api/x", {}), (201, {"id": "ok"}))
        self.assertEqual(send.call_count, 2)
        sleep.assert_called_once_with(4)

    def test_retries_stop_at_the_attempt_limit(self) -> None:
        limited = (429, {"details": {"retry_after_secs": 1}})
        with mock.patch.object(seed_demo_data, "send_json_once", return_value=limited) as send, \
                mock.patch.object(seed_demo_data.time, "sleep"):
            status, _ = seed_demo_data.request_json("/api/x", {})
        self.assertEqual(status, 429)
        self.assertEqual(send.call_count, seed_demo_data.RATE_LIMIT_MAX_ATTEMPTS)


if __name__ == "__main__":
    unittest.main()
