"""Verifica que is_db_configured() y load_db_bind_kwargs() compartan la misma lógica."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.setup_env import is_db_configured, load_db_bind_kwargs  # noqa: E402

_DB_KEYS = (
    "DATABASE_URL",
    "DB_PROVIDER",
    "DB_HOST",
    "DB_USER",
    "DB_PASS",
    "DB_NAME",
)


class TestDbConfigured(unittest.TestCase):
    def setUp(self) -> None:
        self._saved = {k: os.environ.get(k) for k in _DB_KEYS}
        for k in _DB_KEYS:
            os.environ.pop(k, None)

    def tearDown(self) -> None:
        for k in _DB_KEYS:
            os.environ.pop(k, None)
        for k, v in self._saved.items():
            if v is not None:
                os.environ[k] = v

    def test_not_configured(self) -> None:
        with patch("src.setup_env._parse_env_file", return_value={}):
            self.assertFalse(is_db_configured())
            self.assertIsNone(load_db_bind_kwargs())

    def test_configured_via_database_url(self) -> None:
        url = "postgresql://u:p@ep-xxx.neon.tech/neondb?sslmode=require"
        with patch("src.setup_env._parse_env_file", return_value={"DATABASE_URL": url}):
            self.assertTrue(is_db_configured())
            self.assertEqual(
                load_db_bind_kwargs(),
                {"provider": "postgres", "dsn": url},
            )

    def test_configured_via_loose_vars_env_file(self) -> None:
        """Modo producción/Docker: DB_PROVIDER + DB_HOST sin DATABASE_URL."""
        with patch(
            "src.setup_env._parse_env_file",
            return_value={
                "DB_PROVIDER": "postgres",
                "DB_HOST": "db",
                "DB_USER": "user",
                "DB_PASS": "pass",
                "DB_NAME": "atv",
            },
        ):
            self.assertTrue(is_db_configured())
            self.assertEqual(
                load_db_bind_kwargs(),
                {
                    "provider": "postgres",
                    "user": "user",
                    "password": "pass",
                    "host": "db",
                    "database": "atv",
                },
            )

    def test_configured_via_loose_vars_environ(self) -> None:
        os.environ.update(
            {
                "DB_PROVIDER": "postgres",
                "DB_HOST": "localhost",
                "DB_USER": "u",
                "DB_PASS": "p",
                "DB_NAME": "d",
            }
        )
        with patch("src.setup_env._parse_env_file", return_value={}):
            self.assertTrue(is_db_configured())
            self.assertIsNotNone(load_db_bind_kwargs())

    def test_incomplete_loose_vars_not_configured(self) -> None:
        with patch(
            "src.setup_env._parse_env_file",
            return_value={"DB_PROVIDER": "postgres"},  # falta DB_HOST
        ):
            self.assertFalse(is_db_configured())
            self.assertIsNone(load_db_bind_kwargs())

    def test_database_url_takes_precedence_over_loose_vars(self) -> None:
        url = "postgresql://neon/db"
        with patch(
            "src.setup_env._parse_env_file",
            return_value={
                "DATABASE_URL": url,
                "DB_PROVIDER": "postgres",
                "DB_HOST": "db",
                "DB_USER": "user",
                "DB_PASS": "pass",
                "DB_NAME": "atv",
            },
        ):
            self.assertTrue(is_db_configured())
            self.assertEqual(load_db_bind_kwargs(), {"provider": "postgres", "dsn": url})


if __name__ == "__main__":
    unittest.main()
