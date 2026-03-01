import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from api.auth import get_current_uid
from api.routes.state import _set_user_ctx_for_uid
from agent.user_context import reset_user_ctx

logger = logging.getLogger(__name__)
router = APIRouter()

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="chat-agent")


# ── HTTP endpoints ─────────────────────────────────────────────────────────────

@router.get("/api/threads/{strategy}")
def list_strategy_threads(
    strategy: str,
    uid: Annotated[str, Depends(get_current_uid)],
):
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        from agent.threads import list_threads
        return list_threads(strategy)
    finally:
        reset_user_ctx(token)


@router.post("/api/threads/{strategy}")
def create_strategy_thread(
    strategy: str,
    uid: Annotated[str, Depends(get_current_uid)],
):
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        from agent.threads import create_thread
        return create_thread(strategy)
    finally:
        reset_user_ctx(token)


@router.get("/api/threads/{strategy}/{thread_id}/messages")
def get_thread_messages(
    strategy: str,
    thread_id: str,
    uid: Annotated[str, Depends(get_current_uid)],
):
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        from agent.threads import get_thread_meta, get_messages
        meta = get_thread_meta(strategy, thread_id)
        if meta is None:
            raise HTTPException(status_code=404, detail="Thread not found")
        messages = get_messages(strategy, thread_id)
        return {"id": thread_id, "status": meta.get("status", "idle"), "messages": messages}
    finally:
        reset_user_ctx(token)


# ── WebSocket ──────────────────────────────────────────────────────────────────

def _build_status_context(strategy: str) -> str:
    """
    Build a current-state block for the system prompt.
    Reads only local files — no Dhan API calls.
    """
    import base64
    import json as _json
    import time as _time
    from datetime import datetime
    import pytz
    from agent.user_context import get_user_ctx
    from agent.tools import _load_agent_pnl
    from agent.heartbeat import load_tracked_positions
    from agent.scheduler import _is_market_open

    try:
        ctx = get_user_ctx()
        now_ist = datetime.now(pytz.timezone("Asia/Kolkata"))
        lines = []

        # ── Time & market ──────────────────────────────────────────────────
        day_str = now_ist.strftime("%a %d %b %Y · %H:%M IST")
        market = "open" if _is_market_open() else "closed"
        lines.append(f"Time: {day_str}  |  Market: {market}")

        # ── Broker ────────────────────────────────────────────────────────
        client_id = ctx.dhan.client_id
        token = ctx.dhan.access_token
        if not client_id or not token:
            broker_str = "Broker: not configured (no Dhan credentials — trading and live prices unavailable)"
        else:
            # Decode JWT expiry without an API call
            expired = True
            try:
                payload = token.split(".")[1]
                payload += "=" * (-len(payload) % 4)
                data = _json.loads(base64.urlsafe_b64decode(payload))
                expired = data.get("exp", 0) < _time.time()
            except Exception:
                pass
            if expired:
                broker_str = "Broker: token expired — trading and live prices unavailable until token is refreshed in Settings"
            else:
                broker_str = "Broker: connected"
        lines.append(broker_str)

        # ── Agent mode ────────────────────────────────────────────────────
        if ctx.paused:
            lines.append("Agent: paused (scheduled jobs will not run)")
        elif ctx.autonomous:
            lines.append("Agent: running autonomously")
        else:
            lines.append("Agent: manual mode (autonomous trading disabled)")

        # ── Capital & P&L ─────────────────────────────────────────────────
        pnl = _load_agent_pnl()
        realized = pnl.get("realized", 0) or 0
        unrealized = pnl.get("unrealized", 0) or 0
        seed = ctx.risk.seed_capital

        positions = load_tracked_positions() or {}
        deployed = sum(
            p.get("entry_price", 0) * p.get("quantity", 0)
            for p in positions.values()
        )

        def _fmt(n: float) -> str:
            return f"+₹{n:.0f}" if n >= 0 else f"-₹{abs(n):.0f}"

        lines.append(
            f"Capital: ₹{seed:,.0f} allocated · ₹{deployed:,.0f} deployed"
        )
        lines.append(
            f"P&L today: {_fmt(realized)} realized · {_fmt(unrealized)} unrealized"
        )

        # ── Positions ─────────────────────────────────────────────────────
        if positions:
            pos_parts = []
            for sym, p in positions.items():
                entry = p.get("entry_price", 0)
                qty = p.get("quantity", 0)
                sl = p.get("stop_loss")
                sl_str = f" SL ₹{sl:.0f}" if sl else ""
                pos_parts.append(f"{sym} ×{qty} @ ₹{entry:.0f}{sl_str}")
            lines.append(f"Positions ({len(positions)}): {', '.join(pos_parts)}")
        else:
            lines.append("Positions: none open")

        # ── Watchlist ─────────────────────────────────────────────────────
        wl_path = ctx.memory_dir / "WATCHLIST.json"
        if wl_path.exists():
            try:
                wl = _json.loads(wl_path.read_text())
                symbols = list(wl.keys())
                if symbols:
                    lines.append(f"Watchlist ({len(symbols)}): {', '.join(symbols)}")
                else:
                    lines.append("Watchlist: empty")
            except Exception:
                pass

        # ── Pending approvals ─────────────────────────────────────────────
        pending_path = ctx.memory_dir / "PENDING.json"
        if pending_path.exists():
            try:
                pending = _json.loads(pending_path.read_text())
                if pending:
                    lines.append(f"Pending approvals: {', '.join(pending.keys())}")
                else:
                    lines.append("Pending approvals: none")
            except Exception:
                pass

        # ── Risk limits ───────────────────────────────────────────────────
        loss_limit = abs(ctx.daily_loss_limit)
        max_pos = ctx.risk.max_positions
        lines.append(f"Risk limits: ₹{loss_limit:,.0f} daily loss limit · {max_pos} max positions")

        return "\n".join(lines)

    except Exception as e:
        logger.warning("Failed to build status context: %s", e)
        return ""


@router.websocket("/ws/threads/{strategy}/{thread_id}")
async def chat_websocket(
    websocket: WebSocket,
    strategy: str,
    thread_id: str,
):
    await websocket.accept()

    # ── Auth ──────────────────────────────────────────────────────────────────
    # Import inside function so we get the post-startup value of _initialized
    from api.firebase_admin import _initialized, verify_id_token

    uid = "default"
    token_param = websocket.query_params.get("token")

    if _initialized:
        if token_param:
            try:
                uid = verify_id_token(token_param)
            except ValueError:
                await websocket.send_json({"type": "error", "message": "Invalid token"})
                await websocket.close(code=4001)
                return
        else:
            try:
                auth_msg = await asyncio.wait_for(websocket.receive_json(), timeout=10.0)
                if "token" not in auth_msg:
                    await websocket.send_json(
                        {"type": "error", "message": "First message must contain token"}
                    )
                    await websocket.close(code=4001)
                    return
                try:
                    uid = verify_id_token(auth_msg["token"])
                except ValueError:
                    await websocket.send_json({"type": "error", "message": "Invalid token"})
                    await websocket.close(code=4001)
                    return
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "error", "message": "Auth timeout"})
                await websocket.close(code=4001)
                return

    # ── Set user context and verify thread ────────────────────────────────────
    ctx_token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        from agent.threads import get_thread_meta, append_message, get_messages, set_status

        meta = get_thread_meta(strategy, thread_id)
        if meta is None:
            await websocket.send_json({"type": "error", "message": "Thread not found"})
            await websocket.close(code=4004)
            return

        loop = asyncio.get_running_loop()

        # ── Main receive loop ─────────────────────────────────────────────────
        while True:
            try:
                msg = await websocket.receive_json()
            except WebSocketDisconnect:
                break

            content = msg.get("content", "").strip()
            if not content:
                continue

            # Save user message + mark thinking
            append_message(strategy, thread_id, "user", content)
            set_status(strategy, thread_id, "thinking")

            # Build history for runner (everything before the new message)
            all_messages = get_messages(strategy, thread_id)
            history_for_runner = [
                {"role": m["role"], "content": m["content"]}
                for m in all_messages[:-1]
                if m["role"] in ("user", "assistant")
            ]

            status_context = _build_status_context(strategy)

            # ── Run agent in thread pool ──────────────────────────────────────
            queue: asyncio.Queue = asyncio.Queue()
            response_parts: list[str] = []

            def _run_in_thread(
                uid_=uid,
                strategy_=strategy,
                content_=content,
                history_=history_for_runner,
                status_context_=status_context,
            ):
                thread_ctx_token, _ = _set_user_ctx_for_uid(uid_)
                try:
                    from agent.runner import run_chat_stream
                    for event in run_chat_stream(
                        message=content_,
                        history=history_,
                        strategy=strategy_,
                        status_context=status_context_,
                    ):
                        loop.call_soon_threadsafe(queue.put_nowait, event)
                except Exception as e:
                    loop.call_soon_threadsafe(
                        queue.put_nowait, {"type": "error", "message": str(e)}
                    )
                finally:
                    reset_user_ctx(thread_ctx_token)
                    loop.call_soon_threadsafe(queue.put_nowait, None)  # sentinel

            future = loop.run_in_executor(_executor, _run_in_thread)

            # Drain queue and forward to WebSocket
            while True:
                event = await queue.get()
                if event is None:
                    break
                await websocket.send_json(event)
                if event.get("type") == "token":
                    response_parts.append(event.get("content", ""))

            await future  # propagate any thread exceptions

            full_response = "".join(response_parts)
            if full_response:
                append_message(strategy, thread_id, "assistant", full_response)
            set_status(strategy, thread_id, "idle")

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("WebSocket error in %s/%s: %s", strategy, thread_id, e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        reset_user_ctx(ctx_token)
        try:
            from agent.threads import set_status
            set_status(strategy, thread_id, "idle")
        except Exception:
            pass
