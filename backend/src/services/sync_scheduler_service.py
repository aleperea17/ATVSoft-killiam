"""APScheduler: intervalos dinámicos para auto_sync_stories y auto_refresh_reels_metrics."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from apscheduler.triggers.interval import IntervalTrigger

from src.services.sync_settings_service import (
    get_calendly_interval_minutes,
    get_reels_interval_minutes,
    get_stories_interval_minutes,
)
from src.services.company_config_service import get_tenant_tz

STORIES_JOB_ID = "auto_sync_stories"
REELS_JOB_ID = "auto_refresh_reels_metrics"
CALENDLY_JOB_ID = "auto_sync_calendly"

_scheduler: Any | None = None


def bind_sync_scheduler(scheduler: Any) -> None:
    global _scheduler
    _scheduler = scheduler


def next_job_run_time(job_id: str) -> datetime | None:
    if _scheduler is None:
        return None
    job = _scheduler.get_job(job_id)
    if job is None:
        return None
    if job.next_run_time is not None:
        return job.next_run_time
    now = datetime.now(get_tenant_tz())
    try:
        return job.trigger.get_next_fire_time(None, now)
    except Exception:
        return None


def stories_next_sync_projection() -> datetime:
    """Próxima sync de historias: job APScheduler o last_sync + intervalo."""
    sched = next_job_run_time(STORIES_JOB_ID)
    if sched is not None:
        return sched
    from pony.orm import db_session

    from src.models import ApiConnection
    from src.services.sync_settings_service import get_stories_interval_minutes

    interval = get_stories_interval_minutes()
    now = datetime.now(get_tenant_tz())
    with db_session:
        conns = list(ApiConnection.select(lambda c: c.platform == "instagram"))
        lasts = [c.last_sync_at for c in conns if c.last_sync_at is not None]
    if lasts:
        last = max(lasts)
        if last.tzinfo is None:
            last = last.replace(tzinfo=get_tenant_tz())
        else:
            last = last.astimezone(get_tenant_tz())
        return last + timedelta(minutes=interval)
    return now + timedelta(minutes=interval)


def apply_sync_schedules(*, stories_run_immediately: bool = False) -> None:
    """Relee intervalos de BD y reprograma los jobs ya registrados en el scheduler."""
    if _scheduler is None:
        return
    stories_m = get_stories_interval_minutes()
    reels_m = get_reels_interval_minutes()
    calendly_m = get_calendly_interval_minutes()
    now = datetime.now(get_tenant_tz())

    stories_job = _scheduler.get_job(STORIES_JOB_ID)
    if stories_job is not None:
        kwargs: dict[str, Any] = {
            "trigger": IntervalTrigger(minutes=stories_m, timezone=get_tenant_tz()),
        }
        if stories_run_immediately:
            kwargs["next_run_time"] = now
        _scheduler.reschedule_job(STORIES_JOB_ID, **kwargs)

    reels_job = _scheduler.get_job(REELS_JOB_ID)
    if reels_job is not None:
        _scheduler.reschedule_job(
            REELS_JOB_ID,
            trigger=IntervalTrigger(minutes=reels_m, timezone=get_tenant_tz()),
        )

    calendly_job = _scheduler.get_job(CALENDLY_JOB_ID)
    if calendly_job is not None:
        _scheduler.reschedule_job(
            CALENDLY_JOB_ID,
            trigger=IntervalTrigger(minutes=calendly_m, timezone=get_tenant_tz()),
        )
