"""Tests del filtro de event types de Calendly (sin BD)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.services.calendly_event_filter import (
    event_type_in_allowlist,
    merge_calendly_credentials,
    normalize_event_type_allowlist,
    resolve_invitee_event_type,
    sanitize_calendly_credentials,
)

ERIK_O_E = "https://api.calendly.com/event_types/d815020b-428c-41b2-ac79-65c14de334fc"
CHRISTIAN_1_1 = "https://api.calendly.com/event_types/18077ed6-abbe-4712-b46d-9640607c0c1f"
ERIK_ALLOWLIST = [
    ERIK_O_E,
    "https://api.calendly.com/event_types/9ae3cd48-474b-41f2-9c78-100124ee9e22",
    "https://api.calendly.com/event_types/b57f4613-83a6-419f-81f9-86cd0e50948d",
    "https://api.calendly.com/event_types/7a9528ac-b523-4e4f-bf3d-8141a29b48f2",
    "https://api.calendly.com/event_types/7f2fa132-4a0a-45c5-bf88-7e2bb95dd98d",
]


class TestAllowlistNormalize(unittest.TestCase):
    def test_keeps_list(self) -> None:
        out = normalize_event_type_allowlist(ERIK_ALLOWLIST)
        self.assertEqual(out, ERIK_ALLOWLIST)

    def test_membership(self) -> None:
        self.assertTrue(event_type_in_allowlist(ERIK_O_E, ERIK_ALLOWLIST))
        self.assertFalse(event_type_in_allowlist(CHRISTIAN_1_1, ERIK_ALLOWLIST))


class TestSanitizeDoesNotStringifyList(unittest.TestCase):
    def test_allowlist_stays_list(self) -> None:
        cleaned = sanitize_calendly_credentials(
            {
                "api_key": "pat",
                "signing_key": "whsec",
                "event_type_allowlist": ERIK_ALLOWLIST,
                "q_legacy": "drop-me",
            }
        )
        self.assertEqual(cleaned["api_key"], "pat")
        self.assertEqual(cleaned["event_type_allowlist"], ERIK_ALLOWLIST)
        self.assertNotIn("q_legacy", cleaned)
        self.assertIsInstance(cleaned["event_type_allowlist"], list)


class TestUiSaveDoesNotWipeAllowlist(unittest.TestCase):
    def test_conexions_save_only_pat_and_signing_key(self) -> None:
        previous = {
            "api_key": "old-pat",
            "signing_key": "",
            "event_type_allowlist": ERIK_ALLOWLIST,
            "last_check_at": "2026-08-25T00:00:00Z",
        }
        incoming = {"api_key": "new-pat", "signing_key": "whsec_new"}
        merged = merge_calendly_credentials(previous, incoming)
        self.assertEqual(merged["api_key"], "new-pat")
        self.assertEqual(merged["signing_key"], "whsec_new")
        self.assertEqual(merged["event_type_allowlist"], ERIK_ALLOWLIST)
        self.assertEqual(merged["last_check_at"], "2026-08-25T00:00:00Z")


class TestResolveEventType(unittest.TestCase):
    def test_uses_nested_scheduled_event(self) -> None:
        calls: list[tuple[str, str]] = []

        def fetch(uri: str, key: str) -> str | None:
            calls.append((uri, key))
            return None

        inner = {
            "name": "Ana",
            "email": "ana@example.com",
            "event": "https://api.calendly.com/scheduled_events/AAA",
            "scheduled_event": {"event_type": ERIK_O_E, "start_time": "2026-08-26T15:00:00.000000Z"},
        }
        et, via = resolve_invitee_event_type(inner, inner, api_key="pat", fetch_scheduled_event_type=fetch)
        self.assertEqual(et, ERIK_O_E)
        self.assertEqual(via, "payload.scheduled_event.event_type")
        self.assertEqual(calls, [])

    def test_fetches_when_missing_nested(self) -> None:
        inner = {
            "name": "Ana",
            "email": "ana@example.com",
            "event": "https://api.calendly.com/scheduled_events/AAA",
        }

        def fetch(uri: str, key: str) -> str | None:
            self.assertEqual(uri, "https://api.calendly.com/scheduled_events/AAA")
            return ERIK_O_E

        et, via = resolve_invitee_event_type(inner, inner, api_key="pat", fetch_scheduled_event_type=fetch)
        self.assertEqual(et, ERIK_O_E)
        self.assertIn("GET", via)

    def test_fail_closed_when_get_fails(self) -> None:
        inner = {"event": "https://api.calendly.com/scheduled_events/AAA"}

        def fetch(uri: str, key: str) -> str | None:
            return None

        et, via = resolve_invitee_event_type(inner, inner, api_key="pat", fetch_scheduled_event_type=fetch)
        self.assertIsNone(et)
        self.assertIn("falló", via)


if __name__ == "__main__":
    unittest.main()
