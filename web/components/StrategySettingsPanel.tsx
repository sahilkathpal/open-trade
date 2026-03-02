"use client"

import { useEffect, useState, useCallback } from "react"
import { useAuth } from "@/lib/auth"
import { AppState } from "@/lib/types"
import { SlidePanel } from "@/components/SlidePanel"

interface StrategySettingsPanelProps {
  state: AppState | null
  onStateRefresh: () => void
  /** When provided, shows per-strategy risk fields above the portfolio guardrails */
  strategy?: string
  /** Modal mode — required when not embedded */
  open?: boolean
  onClose?: () => void
  /** Embedded mode: renders content directly without a SlidePanel wrapper */
  embedded?: boolean
}

const INPUT_CLASS =
  "w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:border-text-muted"

const SECTION_HEADER_CLASS =
  "text-xs uppercase tracking-wider text-text-muted font-medium py-3 px-4 border-b border-border"

export function StrategySettingsPanel({
  open,
  onClose,
  state,
  onStateRefresh,
  strategy,
  embedded,
}: StrategySettingsPanelProps) {
  const { authFetch } = useAuth()

  // ── Per-strategy risk ──────────────────────────────────────────────────────
  const [strategyMaxPositions, setStrategyMaxPositions] = useState<number>(2)
  const [maxTradeSize, setMaxTradeSize] = useState<number>(25000)
  const [stopLossPct, setStopLossPct] = useState<number>(1.5)
  const [targetPct, setTargetPct] = useState<number | "">(3)
  const [savingStrategy, setSavingStrategy] = useState(false)
  const [strategySaved, setStrategySaved] = useState(false)

  // ── Portfolio guardrails ───────────────────────────────────────────────────
  const [seedCapital, setSeedCapital] = useState<number>(state?.seed_capital ?? 0)
  const [dailyLossLimit, setDailyLossLimit] = useState<number>(state?.daily_loss_limit ?? 0)
  const [maxOpenPositions, setMaxOpenPositions] = useState<number>(2)
  const [savingRisk, setSavingRisk] = useState(false)
  const [riskSaved, setRiskSaved] = useState(false)

  // ── Autonomous ─────────────────────────────────────────────────────────────
  const [autonomous, setAutonomous] = useState<boolean>(state?.autonomous ?? false)
  const [savingAuto, setSavingAuto] = useState(false)

  // Sync when panel opens (or on mount when embedded)
  useEffect(() => {
    if (!open && !embedded) return
    if (state) {
      setSeedCapital(state.seed_capital ?? 0)
      setDailyLossLimit(state.daily_loss_limit ?? 0)
      setAutonomous(state.autonomous ?? false)
    }
    authFetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        if (data.max_open_positions != null) setMaxOpenPositions(data.max_open_positions)
        if (strategy) {
          const sr = data.strategy_risk?.[strategy]
          if (sr) {
            if (sr.max_positions != null) setStrategyMaxPositions(sr.max_positions)
            if (sr.max_trade_size != null) setMaxTradeSize(sr.max_trade_size)
            if (sr.stop_loss_pct != null) setStopLossPct(sr.stop_loss_pct)
            if (sr.target_pct != null) setTargetPct(sr.target_pct)
          }
        }
      })
      .catch(() => {})
  }, [open, embedded, state, strategy, authFetch])

  const handleSaveStrategy = useCallback(async () => {
    if (!strategy) return
    setSavingStrategy(true)
    setStrategySaved(false)
    try {
      await Promise.all([
        authFetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy_risk: {
              [strategy]: {
                max_positions: strategyMaxPositions,
                max_trade_size: maxTradeSize,
                stop_loss_pct: stopLossPct,
                target_pct: targetPct === "" ? null : targetPct,
              },
            },
          }),
        }),
        new Promise((r) => setTimeout(r, 400)),
      ])
      setStrategySaved(true)
      onStateRefresh()
      setTimeout(() => setStrategySaved(false), 2000)
    } catch {
      // fail silently
    } finally {
      setSavingStrategy(false)
    }
  }, [strategy, authFetch, strategyMaxPositions, maxTradeSize, stopLossPct, targetPct, onStateRefresh])

  const handleSaveRisk = useCallback(async () => {
    setSavingRisk(true)
    setRiskSaved(false)
    try {
      await Promise.all([
        authFetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            seed_capital: seedCapital,
            daily_loss_limit: dailyLossLimit,
            max_open_positions: maxOpenPositions,
          }),
        }),
        new Promise((r) => setTimeout(r, 400)),
      ])
      setRiskSaved(true)
      onStateRefresh()
      setTimeout(() => setRiskSaved(false), 2000)
    } catch {
      // fail silently
    } finally {
      setSavingRisk(false)
    }
  }, [authFetch, seedCapital, dailyLossLimit, maxOpenPositions, onStateRefresh])

  const handleToggleAutonomous = useCallback(async () => {
    const next = !autonomous
    setAutonomous(next)
    setSavingAuto(true)
    try {
      await authFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autonomous: next }),
      })
      onStateRefresh()
    } catch {
      setAutonomous(!next)
    } finally {
      setSavingAuto(false)
    }
  }, [autonomous, authFetch, onStateRefresh])

  const body = (
    <>
      {/* ── Per-strategy risk ── */}
      {strategy && (
        <div className="mt-4">
          <div className={SECTION_HEADER_CLASS}>Strategy Risk</div>
          <div className="px-4 py-4 space-y-4">
            <p className="text-xs text-text-muted leading-relaxed">
              These limits apply to this strategy only. The agent will not exceed them
              when sizing or managing trades.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-text-muted block">
                  Max positions
                </label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={strategyMaxPositions}
                  onChange={(e) => setStrategyMaxPositions(Number(e.target.value))}
                  className={INPUT_CLASS}
                />
                <p className="text-[11px] text-text-muted">for this strategy</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-mono text-text-muted block">
                  Max trade size (INR)
                </label>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={maxTradeSize}
                  onChange={(e) => setMaxTradeSize(Number(e.target.value))}
                  className={INPUT_CLASS}
                />
                <p className="text-[11px] text-text-muted">notional per position</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-text-muted block">
                  Stop loss (%)
                </label>
                <input
                  type="number"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={stopLossPct}
                  onChange={(e) => setStopLossPct(Number(e.target.value))}
                  className={INPUT_CLASS}
                />
                <p className="text-[11px] text-text-muted">exit if loss exceeds</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-mono text-text-muted block">
                  Profit target (%) — optional
                </label>
                <input
                  type="number"
                  min={0.1}
                  max={20}
                  step={0.1}
                  value={targetPct}
                  placeholder="—"
                  onChange={(e) =>
                    setTargetPct(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  className={INPUT_CLASS}
                />
                <p className="text-[11px] text-text-muted">exit if gain exceeds</p>
              </div>
            </div>

            <button
              onClick={handleSaveStrategy}
              disabled={savingStrategy}
              className="bg-accent-green text-black text-xs font-semibold px-4 py-2 rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {savingStrategy ? "Saving..." : strategySaved ? "Saved" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* ── Portfolio guardrails ── */}
      <div className={strategy ? "" : "mt-4"}>
        <div className={SECTION_HEADER_CLASS}>Portfolio Guardrails</div>
        <div className="px-4 py-4 space-y-4">
          <p className="text-xs text-text-muted leading-relaxed">
            Hard limits that apply across all strategies. The agent cannot exceed these
            regardless of individual strategy settings.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-mono text-text-muted block">
              Agent Capital (INR)
            </label>
            <input
              type="number"
              value={seedCapital}
              onChange={(e) => setSeedCapital(Number(e.target.value))}
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-mono text-text-muted block">
              Daily Loss Limit (INR)
            </label>
            <input
              type="number"
              value={dailyLossLimit}
              onChange={(e) => setDailyLossLimit(Number(e.target.value))}
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-mono text-text-muted block">
              Max Open Positions (total)
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={maxOpenPositions}
              onChange={(e) => setMaxOpenPositions(Number(e.target.value))}
              className={INPUT_CLASS}
            />
          </div>

          <button
            onClick={handleSaveRisk}
            disabled={savingRisk}
            className="bg-accent-green text-black text-xs font-semibold px-4 py-2 rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {savingRisk ? "Saving..." : riskSaved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {/* ── Autonomous Trading ── */}
      <div>
        <div className={SECTION_HEADER_CLASS}>Autonomous Trading</div>
        <div className="px-4 py-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm text-text-primary font-medium">Autonomous Mode</div>
              <div className="text-xs text-text-muted mt-0.5 max-w-[280px]">
                When on, Claude will execute trades without waiting for your approval.
              </div>
            </div>
            <button
              onClick={handleToggleAutonomous}
              disabled={savingAuto}
              className={`relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none shrink-0 disabled:opacity-70 ${
                autonomous ? "bg-accent-green" : "bg-border"
              }`}
              role="switch"
              aria-checked={autonomous}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                  autonomous ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {autonomous ? (
            <p className="text-xs text-accent-green font-mono mt-3">
              Autonomous mode — Claude will trade independently within your risk limits.
            </p>
          ) : (
            <p className="text-xs text-text-muted font-mono mt-3">
              Manual mode — you&apos;ll approve each trade before execution.
            </p>
          )}
        </div>
      </div>
    </>
  )

  if (embedded) return <div>{body}</div>

  return (
    <SlidePanel
      open={open ?? false}
      onClose={onClose ?? (() => {})}
      title="Risk Guardrails"
      width="w-[480px]"
    >
      {body}
    </SlidePanel>
  )
}
