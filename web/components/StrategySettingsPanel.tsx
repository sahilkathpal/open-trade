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
  const [maxRiskPerTradePct, setMaxRiskPerTradePct] = useState<number>(2)
  const [strategyAllocation, setStrategyAllocation] = useState<number>(0)
  const [otherAllocated, setOtherAllocated] = useState<number>(0) // sum of other strategies
  const [savingStrategy, setSavingStrategy] = useState(false)
  const [strategySaved, setStrategySaved] = useState(false)

  // ── Portfolio guardrails ───────────────────────────────────────────────────
  const [seedCapital, setSeedCapital] = useState<number>(state?.seed_capital ?? 0)
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
      setAutonomous(state.autonomous ?? false)
    }
    authFetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        if (strategy) {
          const sr = data.strategy_risk?.[strategy]
          if (sr?.max_risk_per_trade_pct != null) setMaxRiskPerTradePct(sr.max_risk_per_trade_pct)
          const allocations: Record<string, number> = data.strategy_allocations ?? {}
          setStrategyAllocation(allocations[strategy] ?? 0)
          // Sum of all OTHER strategies' allocations
          const other = Object.entries(allocations)
            .filter(([k]) => k !== strategy)
            .reduce((sum, [, v]) => sum + (v ?? 0), 0)
          setOtherAllocated(other)
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
              [strategy]: { max_risk_per_trade_pct: maxRiskPerTradePct },
            },
            strategy_allocations: { [strategy]: strategyAllocation },
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
  }, [strategy, authFetch, maxRiskPerTradePct, strategyAllocation, onStateRefresh])

  const handleSaveRisk = useCallback(async () => {
    setSavingRisk(true)
    setRiskSaved(false)
    try {
      await Promise.all([
        authFetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seed_capital: seedCapital }),
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
  }, [authFetch, seedCapital, onStateRefresh])

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
              These limits apply to this strategy only. The agent will not trade until
              capital is allocated.
            </p>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <label className="text-xs font-mono text-text-muted block">
                  Capital allocation (₹)
                </label>
                {seedCapital > 0 && (
                  <span className="text-[11px] text-text-muted font-mono">
                    {(() => {
                      const remaining = seedCapital - otherAllocated
                      return remaining > 0
                        ? `₹${remaining.toLocaleString("en-IN")} available`
                        : "fully allocated"
                    })()}
                  </span>
                )}
              </div>
              <input
                type="number"
                min={0}
                step={1000}
                value={strategyAllocation || ""}
                placeholder="0"
                onChange={(e) => setStrategyAllocation(Number(e.target.value))}
                className={INPUT_CLASS}
              />
              {strategyAllocation === 0 && (
                <p className="text-[11px] text-accent-amber">
                  Not set — trades will be blocked until you allocate capital
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <label className="text-xs font-mono text-text-muted block">
                  Max risk per trade (%)
                </label>
                {strategyAllocation > 0 && maxRiskPerTradePct > 0 && (
                  <span className="text-[11px] text-text-muted font-mono">
                    ≤ ₹{Math.round(strategyAllocation * maxRiskPerTradePct / 100).toLocaleString("en-IN")} per trade
                  </span>
                )}
              </div>
              <input
                type="number"
                min={0.5}
                max={10}
                step={0.5}
                value={maxRiskPerTradePct || ""}
                placeholder="2"
                onChange={(e) => setMaxRiskPerTradePct(Number(e.target.value))}
                className={INPUT_CLASS}
              />
              <p className="text-[11px] text-text-muted">
                Max loss if stop is hit, as % of allocation · default 2%
              </p>
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

      {/* ── Portfolio guardrails — hidden when embedded in strategy page ── */}
      {!embedded && (
        <div className={strategy ? "" : "mt-4"}>
          <div className={SECTION_HEADER_CLASS}>Guardrails</div>
          <div className="px-4 py-4 space-y-4">
            <p className="text-xs text-text-muted leading-relaxed">
              Enforced by code, not AI. Claude cannot change these.
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

            {/* Static guardrail labels */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span className="text-accent-green">&#10003;</span>
                <span>Stop loss required on all trades</span>
                <span className="text-[10px] text-text-muted/60 ml-auto">always active</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span className="text-accent-green">&#10003;</span>
                <span>No entries before 9:30 AM IST</span>
                <span className="text-[10px] text-text-muted/60 ml-auto">always active</span>
              </div>
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
      )}

      {/* ── Autonomous Trading — hidden when embedded in strategy page ── */}
      {!embedded && <div>
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
      </div>}
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
