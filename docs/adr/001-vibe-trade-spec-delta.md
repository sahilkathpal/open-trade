# ADR-001: Vibe Trade Spec Delta Implementation

**Date:** 2026-03-06
**Branch:** strategy-as-tool
**Status:** Accepted

---

## Context

The `strategy-as-tool` branch already covered the full infrastructure from the Vibe Trade spec:
- 24 tools across market data, broker, trigger, schedule, and strategy domains
- Unified 4-tier permission system with inline approval cards
- Strategy as a first-class Firestore entity (CRUD, thesis, rules, learnings)
- Per-strategy portfolio isolation (positions + trades subcollections)
- Firestore-backed schedules + APScheduler
- Multi-tenant auth, WebSocket chat, dynamic sidebar, portfolio dashboard

A gap analysis identified five incremental features missing from the spec. Rather than a rewrite, all five were implemented as targeted additions to the existing branch.

---

## Decisions

### Phase 1 — @Strategy Mentions + Action Tagging

**Decision:** Implement @mention parsing in the backend (chat.py) rather than as a client-side-only feature. Mentions are resolved at the WS message handler level and injected into the system context block sent to Claude.

**Rationale:** Claude needs the strategy's thesis and rules in its context window to reason about them. A purely frontend highlight would be cosmetic. By resolving mentions server-side, we guarantee the context is present regardless of which client (web, Telegram) sends the message.

**Implementation:**
- `_extract_mentioned_strategies(uid, message)` — regex finds `@slug` tokens, resolves each via `get_strategy(uid, slug)` from Firestore.
- `_build_mention_context(strategies)` — formats resolved strategies as a markdown block appended to `status_context`.
- `_build_status_context(context)` appends a strategy tagging instruction when `context != "portfolio"`, telling Claude to always pass `strategy_id='{context}'` to write/trade tools unless the user says otherwise.
- Frontend: `@` in the chat input triggers an autocomplete dropdown filtered against `/api/strategies`. On select, inserts `@strategy-id` as plain text (backend parses it).

**Alternatives considered:**
- Client-side mention rendering only (rejected — Claude wouldn't see the context).
- Full message pre-processing pipeline (rejected — overcomplicated for the current scale).

---

### Phase 2 — Per-Strategy Autonomy

**Decision:** Each strategy carries an `autonomy` field (`"approval"` | `"autonomous"`) stored in its Firestore document. The global `autonomous` flag acts as a master override (if global is paused/false, all strategies are paused). Per-strategy autonomy only affects Tier 2 permission gates.

**Rationale:** Different strategies have different risk profiles. A low-frequency macro strategy might warrant autonomous execution while an intraday scalping strategy should always require approval. Tying autonomy to the strategy doc (rather than a separate collection) keeps it atomic with the strategy's other config.

**Implementation:**
- `permissions.needs_approval(tool_name, inputs, autonomous, strategy_id="")` — for Tier 2 tools, fetches strategy doc and checks `autonomy == "autonomous"` before falling back to the global flag. Firestore lookup is best-effort (silently falls through on failure).
- `set_strategy_autonomy(strategy_id, mode)` tool — Tier 3 (always requires approval), updates the `autonomy` field.
- `runner.py` passes `strategy` as `strategy_id` to every `needs_approval` call.
- Guardrails tab in the strategy page shows the current autonomy mode as a badge.

**Alternatives considered:**
- Global autonomous toggle only (rejected — too coarse for multi-strategy setups).
- Per-tool autonomy overrides (rejected — too granular, harder to reason about).

---

### Phase 3 — Strategy Versioning

**Decision:** Version snapshots are written to a Firestore subcollection (`versions/`) automatically whenever `update_strategy_thesis` or `update_strategy_rules` is called. No explicit versioning command is needed from Claude — it happens transparently.

**Rationale:** Thesis and rules are the most consequential documents in the system — they directly determine trade behavior. Silent auto-versioning (copy-on-write) means no version is ever lost without any cognitive overhead on Claude or the user. Labeling is optional and additive.

**Schema:**
```
users/{uid}/strategies/{strategy_id}/versions/{version_id}
  version_id: str (UUID)
  thesis: str
  rules: str
  label: str | null
  created_at: str (ISO UTC)
  change: "thesis" | "rules" | "both"
```

**Implementation:**
- `save_version(uid, strategy_id, thesis, rules, change)` in `firestore_strategies.py` — snapshots the current state before the update.
- `update_strategy_thesis` and `update_strategy_rules` in `tools/strategies.py` call `save_version` before writing.
- `list_versions` / `label_version` helpers + `list_strategy_versions` / `label_strategy_version` tools.
- API: `GET /api/strategies/{id}/versions` and `PATCH /api/strategies/{id}/versions/{version_id}`.
- UI: Versions tab with expandable cards (change type badge, timestamp, collapsible thesis+rules snapshot, inline label editing).

**Alternatives considered:**
- Event sourcing / full audit log (rejected — overkill; snapshots are sufficient for human review).
- Explicit `version_strategy` tool call (rejected — relies on Claude remembering to call it; auto-versioning is more reliable).

---

### Phase 4 — Strategy Dashboard Completion

**Decision:** Extend the right panel of the strategy page with two new tabs (Learnings, Versions), extend the Trades tab with a journal table, add a P&L figure to each sidebar entry, and add an archive shortcut that routes through the chat (keeping it Tier 3 / auditable).

**Rationale:** The strategy page was functional but data-sparse. Users needed to open Documents and read raw markdown to see learnings. Moving learnings and versions to dedicated tabs reduces friction. The trade journal table provides the most actionable post-trade view without requiring a separate page.

**Implementation:**
- `PanelSection` type extended to `"trades" | "learnings" | "versions" | "agent" | "documents" | "guardrails"`.
- `LearningsContent` — renders `strategy.learnings` markdown from the strategy doc (fetched via `GET /api/strategies/{id}`).
- `VersionsContent` — fetches from `GET /api/strategies/{id}/versions`; expandable cards with label editing.
- `TradesContent` extended — fetches `GET /api/strategies/{id}/trades` and renders a Symbol/Entry/Exit/P&L table beneath open positions.
- `Sidebar.tsx` — `total_realized` rendered as a right-aligned monospace figure next to each strategy name (green positive, red negative).
- `/api/strategies` list endpoint now enriches each strategy with `total_realized` and `total_trades` by calling `get_strategy_pnl` per strategy. Accepted as a perf tradeoff — Firestore parallel reads are fast and strategies lists are short.
- Archive: kebab `⋯` menu in strategy header navigates to splash mode with chat pre-filled with `"Archive the {name} strategy"`. Claude handles it as a Tier 3 action (propose → inline approval card → archive_strategy tool).

**Alternatives considered:**
- Full-page route per tab (rejected — increases navigation complexity; panel tabs are already established UX).
- Direct "Archive" API button (rejected — bypasses the approval flow; auditability is more important than one fewer click).

---

### Phase 5 — Portfolio Dashboard Enhancement

**Decision:** Reuse `total_realized` and `total_trades` already returned by the enriched `/api/strategies` list to update portfolio strategy cards. No new API endpoints needed.

**Rationale:** The portfolio page already called `/api/strategies` to render strategy cards. Adding P&L data required only adding two fields to the existing response — the frontend change was minimal.

**Implementation:**
- Portfolio strategy cards now show **All-time P&L** (from `total_realized`) and **Trades count** (from `total_trades`) instead of the previous global `agentPnl`.

---

## Consequences

**Positive:**
- All five phases implemented with zero new API surface beyond what was strictly necessary.
- Auto-versioning is invisible to Claude and requires no prompt engineering.
- Per-strategy autonomy enables production use cases where some strategies are safe to run autonomously while others need oversight.
- `@mention` injection works across any chat context without client coordination.

**Negative / Known Limitations:**
- `/api/strategies` list now does N Firestore reads for P&L (one per strategy). Acceptable at current scale; add caching if strategy count grows beyond ~20.
- `versions/` subcollection is not yet surfaced in Telegram commands — still file/Firestore only.
- `label_strategy_version` is Tier 2 (requires approval when not autonomous), which may feel heavy for a metadata-only operation. Can be relaxed to Tier 1 in a follow-up.
- No cross-strategy version diff view — each strategy's versions are siloed.

---

## Files Changed

| File | Change |
|---|---|
| `api/routes/chat.py` | `_extract_mentioned_strategies`, `_build_mention_context`, mention injection in WS loop, strategy tagging hint in `_build_status_context` |
| `agent/permissions.py` | `strategy_id` param + per-strategy autonomy lookup in Tier 2 branches; `set_strategy_autonomy` → Tier 3; `list_strategy_versions` → Tier 0; `label_strategy_version` → Tier 2 |
| `agent/runner.py` | Pass `strategy` as `strategy_id` to `needs_approval` |
| `agent/firestore_strategies.py` | `save_version`, `list_versions`, `label_version` |
| `agent/tools/strategies.py` | `update_strategy_thesis/rules` auto-snapshot; `set_strategy_autonomy`, `list_strategy_versions`, `label_strategy_version` tools + schemas |
| `api/routes/strategies.py` | `total_realized`+`total_trades` in list; `GET/PATCH /api/strategies/{id}/versions[/{version_id}]` |
| `web/app/s/[strategy]/page.tsx` | @mention autocomplete; PanelSection + PANEL_TABS extended; LearningsContent; VersionsContent; TradesContent journal table; autonomy badge in Guardrails; archive kebab menu; strategies+strategyDoc state |
| `web/components/Sidebar.tsx` | `total_realized` badge per strategy |
| `web/app/page.tsx` | Strategy cards show `total_realized` + `total_trades` |
