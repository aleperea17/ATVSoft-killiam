"""El I/O síncrono sale del event loop (to_thread) y no congela otras coroutines."""

from __future__ import annotations

import asyncio
import contextlib
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.services.calendly_event_filter import resolve_invitee_event_type
from src.services.stories_service import _fetch_story_insights, _http_json_instagram


def _sleeping_http(_url: str, _headers: dict | None = None, **_kwargs) -> dict:
    time.sleep(0.35)
    return {"data": []}


class TestToThreadDoesNotBlockLoop(unittest.IsolatedAsyncioTestCase):
    async def test_blocking_call_on_loop_starves_sibling(self) -> None:
        ticks = {"n": 0}

        async def ticker() -> None:
            while True:
                ticks["n"] += 1
                await asyncio.sleep(0.02)

        task = asyncio.create_task(ticker())
        await asyncio.sleep(0.05)
        before = ticks["n"]
        _sleeping_http("https://example.invalid", {})
        after = ticks["n"]
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        self.assertEqual(before, after)
        self.assertGreaterEqual(before, 1)

    async def test_to_thread_lets_sibling_run(self) -> None:
        ticks = {"n": 0}

        async def ticker() -> None:
            while True:
                ticks["n"] += 1
                await asyncio.sleep(0.02)

        task = asyncio.create_task(ticker())
        await asyncio.sleep(0.05)
        before = ticks["n"]
        await asyncio.to_thread(_sleeping_http, "https://example.invalid", {})
        after = ticks["n"]
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        self.assertGreater(after, before)


class TestAsgiFastRouteDuringOffloadedJob(unittest.IsolatedAsyncioTestCase):
    """Equivalente a GET /company-config mientras corre un sync offloaded."""

    async def test_fast_get_returns_while_slow_job_runs(self) -> None:
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        app = FastAPI()

        @app.get("/slow")
        async def slow() -> dict[str, bool]:
            await asyncio.to_thread(time.sleep, 0.4)
            return {"slow": True}

        @app.get("/fast")
        async def fast() -> dict[str, bool]:
            return {"ok": True}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            slow_task = asyncio.create_task(client.get("/slow"))
            await asyncio.sleep(0.05)
            t0 = time.monotonic()
            fast_res = await client.get("/fast")
            fast_ms = (time.monotonic() - t0) * 1000
            slow_res = await slow_task

        self.assertEqual(fast_res.status_code, 200)
        self.assertEqual(fast_res.json(), {"ok": True})
        self.assertEqual(slow_res.status_code, 200)
        self.assertLess(fast_ms, 150)


class TestStoriesGraphOffload(unittest.IsolatedAsyncioTestCase):
    async def test_insights_via_to_thread_allows_ticker(self) -> None:
        ticks = {"n": 0}
        calls = {"n": 0}

        def slow_first_http(url: str, headers: dict) -> dict:
            calls["n"] += 1
            if calls["n"] == 1:
                time.sleep(0.35)
            metric = "reach"
            for name in ("reach", "views", "replies", "shares", "navigation", "profile_visits"):
                if f"metric={name}" in url:
                    metric = name
                    break
            return {"data": [{"name": metric, "values": [{"value": 1}]}]}

        async def ticker() -> None:
            deadline = time.monotonic() + 0.28
            while time.monotonic() < deadline:
                ticks["n"] += 1
                await asyncio.sleep(0.04)

        with patch("src.services.stories_service._http_json", slow_first_http):
            await asyncio.gather(
                asyncio.to_thread(_fetch_story_insights, "story-id", "token", {}),
                ticker(),
            )
        self.assertGreaterEqual(ticks["n"], 3)

    async def test_instagram_list_via_to_thread_allows_ticker(self) -> None:
        ticks = {"n": 0}

        async def ticker() -> None:
            deadline = time.monotonic() + 0.28
            while time.monotonic() < deadline:
                ticks["n"] += 1
                await asyncio.sleep(0.04)

        with patch("src.services.stories_service._http_json", _sleeping_http):
            await asyncio.gather(
                asyncio.to_thread(_http_json_instagram, "https://graph.facebook.com/x", {}),
                ticker(),
            )
        self.assertGreaterEqual(ticks["n"], 3)


class TestCalendlyResolveOffload(unittest.IsolatedAsyncioTestCase):
    async def test_resolve_event_type_fetch_via_to_thread(self) -> None:
        ticks = {"n": 0}
        inner = {"event": "https://api.calendly.com/scheduled_events/abc"}
        flat: dict = {}

        def slow_fetch(uri: str, key: str) -> str:
            time.sleep(0.35)
            return "https://api.calendly.com/event_types/xyz"

        async def ticker() -> None:
            deadline = time.monotonic() + 0.28
            while time.monotonic() < deadline:
                ticks["n"] += 1
                await asyncio.sleep(0.04)

        resolved, via = (
            await asyncio.gather(
                asyncio.to_thread(
                    resolve_invitee_event_type,
                    inner,
                    flat,
                    api_key="pat",
                    fetch_scheduled_event_type=slow_fetch,
                ),
                ticker(),
            )
        )[0]
        self.assertEqual(resolved, "https://api.calendly.com/event_types/xyz")
        self.assertIn("GET", via)
        self.assertGreaterEqual(ticks["n"], 3)


if __name__ == "__main__":
    unittest.main()
