"""Carga event_type_allowlist en la conexión Calendly de Erik (user_id=1).

No hardcodea la lista en el webhook: solo escribe dato en ApiConnection.credentials.
Uso (en el servidor, desde backend/):

    python scripts/seed_calendly_event_type_allowlist.py
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.setup_env import bootstrap_environment

bootstrap_environment()

from pony.orm import db_session  # noqa: E402

from src.db import db, ensure_db_bound  # noqa: E402
import src.models  # noqa: F401, E402
from src.models import ApiConnection  # noqa: E402
from src.services.calendly_event_filter import (  # noqa: E402
    CALENDLY_EVENT_TYPE_ALLOWLIST_KEY,
    normalize_event_type_allowlist,
)

# Dato inicial editable después en BD / Conexiones. No usar esta lista en el filtro.
ERIK_EVENT_TYPE_ALLOWLIST = [
    "https://api.calendly.com/event_types/d815020b-428c-41b2-ac79-65c14de334fc",  # o-e
    "https://api.calendly.com/event_types/9ae3cd48-474b-41f2-9c78-100124ee9e22",  # m-e
    "https://api.calendly.com/event_types/b57f4613-83a6-419f-81f9-86cd0e50948d",  # e-e
    "https://api.calendly.com/event_types/7a9528ac-b523-4e4f-bf3d-8141a29b48f2",  # g-e
    "https://api.calendly.com/event_types/7f2fa132-4a0a-45c5-bf88-7e2bb95dd98d",  # tk-e
]


def main() -> None:
    if not ensure_db_bound():
        raise SystemExit("db_not_configured")
    db.generate_mapping(create_tables=False, check_tables=False)
    allow = normalize_event_type_allowlist(ERIK_EVENT_TYPE_ALLOWLIST)
    with db_session:
        row = ApiConnection.get(user_id=1, platform="calendly")
        if row is None:
            raise SystemExit("no_calendly_connection user_id=1")
        creds = dict(row.credentials) if isinstance(row.credentials, dict) else {}
        creds[CALENDLY_EVENT_TYPE_ALLOWLIST_KEY] = allow
        row.credentials = creds
        row.updated_at = datetime.utcnow()
        print(f"ok user_id=1 allowlist_len={len(allow)}")


if __name__ == "__main__":
    main()
