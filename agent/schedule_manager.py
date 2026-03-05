"""
ScheduleManager — wraps APScheduler to manage Claude-owned recurring jobs.

Each user's schedule is stored in memory/{uid}/SCHEDULE.json.
Claude adds/removes entries via write_schedule() / remove_schedule() tools,
which call add_job() / remove_job() here to update APScheduler live.
"""
import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

import pytz
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)

IST = pytz.timezone("Asia/Kolkata")

_schedule_manager: Optional["ScheduleManager"] = None


def get_schedule_manager() -> Optional["ScheduleManager"]:
    return _schedule_manager


def set_schedule_manager(mgr: "ScheduleManager"):
    global _schedule_manager
    _schedule_manager = mgr


def _schedule_path(uid: str) -> Path:
    return Path("memory") / uid / "SCHEDULE.json"


def _load_schedule(uid: str) -> list:
    path = _schedule_path(uid)
    if path.exists():
        try:
            data = json.loads(path.read_text())
            return data if isinstance(data, list) else []
        except Exception:
            pass
    return []


def _save_schedule(uid: str, entries: list):
    path = _schedule_path(uid)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, indent=2, default=str))


class ScheduleManager:
    def __init__(self, scheduler: AsyncIOScheduler):
        self.scheduler = scheduler

    # ── internal helpers ────────────────────────────────────────────────────

    def _make_job_id(self, uid: str, entry_id: str) -> str:
        return f"user:{uid}:schedule:{entry_id}"

    def _make_job_fn(self, uid: str, entry_id: str, job_type: str, prompt: str, strategy_id: str = ""):
        """Return an async callable that runs this scheduled job for the given user."""
        async def _job():
            from agent.scheduler import _for_each_user, _send_telegram
            from agent.firestore import is_enabled, get_all_users, get_user

            if is_enabled():
                user_doc = get_user(uid)
                if not user_doc:
                    logger.warning("Schedule job: user %s not found", uid)
                    return
                if user_doc.get("paused"):
                    logger.info("Schedule job: user %s paused — skipping", uid)
                    return

                from agent.user_context import UserContext, set_user_ctx, reset_user_ctx
                try:
                    ctx = UserContext(uid, user_doc)
                except Exception as e:
                    logger.error("Schedule job: failed to create UserContext for %s: %s", uid, e)
                    return

                # Token expiry check
                funds = ctx.dhan.get_funds()
                if isinstance(funds, dict) and funds.get("token_expired"):
                    msg = f"Scheduled job '{job_type}' skipped: Dhan token expired."
                    logger.warning("%s uid=%s", msg, uid)
                    if _send_telegram and ctx.telegram_chat_id:
                        await _send_telegram(msg, chat_id=ctx.telegram_chat_id)
                    return

                token = set_user_ctx(ctx)
                try:
                    result = await asyncio.to_thread(
                        _run_job_type, job_type, prompt, strategy_id
                    )
                    await asyncio.to_thread(_record_last_run, uid, entry_id)
                    if _send_telegram and ctx.telegram_chat_id:
                        label = job_type.capitalize()
                        await _send_telegram(
                            f"{label} complete\n\n{result[:1000]}",
                            chat_id=ctx.telegram_chat_id,
                        )
                except Exception as e:
                    logger.error("Schedule job %s failed for %s: %s", job_type, uid, e, exc_info=True)
                    if _send_telegram and ctx.telegram_chat_id:
                        await _send_telegram(
                            f"Scheduled job '{job_type}' failed: {e}",
                            chat_id=ctx.telegram_chat_id,
                        )
                finally:
                    reset_user_ctx(token)
            else:
                # Single-user fallback
                from agent.user_context import _get_default_ctx, set_user_ctx, reset_user_ctx
                ctx = _get_default_ctx()
                token = set_user_ctx(ctx)
                try:
                    result = await asyncio.to_thread(_run_job_type, job_type, prompt, strategy_id)
                    await asyncio.to_thread(_record_last_run, uid, entry_id)
                    if _send_telegram:
                        await _send_telegram(f"{job_type.capitalize()} complete\n\n{result[:1000]}")
                except Exception as e:
                    logger.error("Schedule job %s failed (single-user): %s", job_type, e, exc_info=True)
                finally:
                    reset_user_ctx(token)

        return _job

    # ── public API ──────────────────────────────────────────────────────────

    def add_job(self, uid: str, entry: dict):
        """Add or replace an APScheduler job from a SCHEDULE.json entry."""
        job_id    = self._make_job_id(uid, entry["id"])
        cron      = entry["cron"]
        job_type  = entry.get("job_type", "custom")
        prompt    = entry.get("prompt", "")

        # Determine which strategy's doc to load.
        # Prefer explicit strategy_id; fall back to inferring from entry ID prefix
        # (e.g. "defence-premarket" → "defence") validated against STRATEGIES.json.
        strategy_id = entry.get("strategy_id", "")
        if not strategy_id:
            entry_id_prefix = entry.get("id", "").split("-")[0]
            strategies_path = Path("memory") / uid / "STRATEGIES.json"
            if strategies_path.exists():
                try:
                    import json as _json
                    registered = _json.loads(strategies_path.read_text())
                    if any(s.get("id") == entry_id_prefix for s in registered):
                        strategy_id = entry_id_prefix
                except Exception:
                    pass

        # Parse cron: standard 5-field "minute hour dom month dow"
        try:
            minute, hour, dom, month, dow = cron.strip().split()
        except ValueError:
            logger.error("Invalid cron expression '%s' for entry %s", cron, entry["id"])
            return

        job_fn = self._make_job_fn(uid, entry["id"], job_type, prompt, strategy_id)
        self.scheduler.add_job(
            job_fn, "cron",
            minute=minute, hour=hour, day=dom, month=month, day_of_week=dow,
            timezone=IST,
            id=job_id,
            replace_existing=True,
        )
        logger.info("Schedule: added job %s (cron=%s, type=%s) for uid=%s", entry["id"], cron, job_type, uid)

    def remove_job(self, uid: str, job_id: str):
        """Remove an APScheduler job by its entry id."""
        full_id = self._make_job_id(uid, job_id)
        try:
            self.scheduler.remove_job(full_id)
            logger.info("Schedule: removed job %s for uid=%s", job_id, uid)
        except Exception as e:
            logger.debug("Schedule: remove_job %s not found: %s", job_id, e)

    def load_user_schedules(self, uid: str):
        """Load all SCHEDULE.json entries for a user into APScheduler."""
        entries = _load_schedule(uid)
        for entry in entries:
            try:
                self.add_job(uid, entry)
            except Exception as e:
                logger.error("Failed to load schedule entry %s for uid=%s: %s", entry.get("id"), uid, e)
        logger.info("Schedule: loaded %d entries for uid=%s", len(entries), uid)

    def list_jobs(self, uid: str) -> list:
        """Return active schedule entries for a user."""
        return _load_schedule(uid)


def _record_last_run(uid: str, entry_id: str):
    """Write last_run timestamp into the matching SCHEDULE.json entry."""
    from datetime import datetime, timezone
    entries = _load_schedule(uid)
    now = datetime.now(timezone.utc).isoformat()
    for entry in entries:
        if entry.get("id") == entry_id:
            entry["last_run"] = now
            break
    _save_schedule(uid, entries)


def _run_job_type(job_type: str, extra_prompt: str = "", strategy_id: str = "") -> str:
    """Run agent for a given job_type. Called from thread pool.
    All user-defined scheduled jobs are job_type='custom' with a Claude-authored prompt."""
    from agent.runner import run
    from agent.tools import _append_activity
    label = f"{job_type}:{strategy_id}" if strategy_id else job_type
    _append_activity(f"SCHEDULE START job={label}")
    try:
        result = run(job_type, extra_prompt=extra_prompt, strategy_id=strategy_id)
        summary = result[:120].replace("\n", " ") if result else "no output"
        _append_activity(f"SCHEDULE DONE job={label} result={summary}")
        return result
    except Exception as e:
        _append_activity(f"SCHEDULE FAILED job={label} error={e}")
        raise
