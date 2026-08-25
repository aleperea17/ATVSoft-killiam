"""Fix de timezone Calendly: naive UTC y un solo retry de UnrepeatableReadError."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from pony.orm.core import UnrepeatableReadError

from src.datetime_utils import naive_utc
from src.db_session_retry import once_on_unrepeatable_read


AUDIT_START = "2026-08-27T08:00:00.000000Z"


class TestNaiveUtc(unittest.TestCase):
    def test_none_stays_none(self) -> None:
        self.assertIsNone(naive_utc(None))

    def test_already_naive_unchanged(self) -> None:
        dt = datetime(2026, 8, 27, 8, 0)
        out = naive_utc(dt)
        self.assertEqual(out, dt)
        self.assertIsNone(out.tzinfo)

    def test_utc_z_becomes_naive_same_wall_clock(self) -> None:
        was = datetime(2026, 8, 27, 8, 0, tzinfo=timezone.utc)
        now = datetime(2026, 8, 27, 8, 0)
        self.assertNotEqual(was, now)
        stripped = naive_utc(was)
        self.assertEqual(stripped, now)
        self.assertIsNone(stripped.tzinfo)

    def test_non_utc_offset_uses_astimezone(self) -> None:
        madrid = timezone(timedelta(hours=2))
        dt = datetime(2026, 8, 27, 10, 0, tzinfo=madrid)
        self.assertEqual(naive_utc(dt), datetime(2026, 8, 27, 8, 0))


class TestParseThenStrip(unittest.TestCase):
    """Mismo pipeline que calendly_webhook: parse ISO Z → naive_utc."""

    def test_audit_start_time_is_naive_after_strip(self) -> None:
        from src.controllers.webhook_controller import _parse_calendly_start_time

        parsed = _parse_calendly_start_time(AUDIT_START)
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertIsNotNone(parsed.tzinfo)
        stripped = naive_utc(parsed)
        self.assertIsNotNone(stripped)
        assert stripped is not None
        self.assertIsNone(stripped.tzinfo)
        self.assertEqual(stripped, datetime(2026, 8, 27, 8, 0))
        self.assertEqual(stripped.hour, 8)


class TestOnceOnUnrepeatableRead(unittest.TestCase):
    def test_retries_once_then_succeeds(self) -> None:
        calls = {"n": 0}

        def op() -> str:
            calls["n"] += 1
            if calls["n"] == 1:
                raise UnrepeatableReadError("Lead.call")
            return "ok"

        self.assertEqual(once_on_unrepeatable_read(op, log_label="test"), "ok")
        self.assertEqual(calls["n"], 2)

    def test_second_failure_propagates(self) -> None:
        def op() -> None:
            raise UnrepeatableReadError("Lead.call")

        with self.assertRaises(UnrepeatableReadError):
            once_on_unrepeatable_read(op, log_label="test")

    def test_other_errors_are_not_retried(self) -> None:
        calls = {"n": 0}

        def op() -> None:
            calls["n"] += 1
            raise ValueError("otro")

        with self.assertRaises(ValueError):
            once_on_unrepeatable_read(op, log_label="test")
        self.assertEqual(calls["n"], 1)


if __name__ == "__main__":
    unittest.main()
