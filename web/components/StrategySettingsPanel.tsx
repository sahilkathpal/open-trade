"use client"

import { useEffect, useState, useCallback } from "react"
import { useAuth } from "@/lib/auth"
import { AppState } from "@/lib/types"
import { SlidePanel } from "@/components/SlidePanel"

interface StrategySettingsPanelProps {
  open: boolean
  onClose: () => void
  state: AppState | null
  onStateRefresh: () => void
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
}: StrategySettingsPanelProps) {
  const { authFetch } = useAuth()

  // Local risk form state — initialized from state
  const [seedCapital, setSeedCapital] = useState<number>(state?.seed_capital ?? 0)
  const [dailyLossLimit, setDailyLossLimit] = useState<number>(state?.daily_loss_limit ?? 0)
  const [maxOpenPositions, setMaxOpenPositions] = useState<number>(2)
  const [savingRisk, setSavingRisk] = useState(false)
  const [riskSaved, setRiskSaved] = useState(false)

  // Autonomous toggle state
  const [autonomous, setAutonomous] = useState<boolean>(state?.autonomous ?? false)
  const [savingAuto, setSavingAuto] = useState(false)

  // Sync local state when state prop changes or panel opens
  useEffect(() => {
    if (open && state) {
      setSeedCapital(state.seed_capital ?? 0)
      setDailyLossLimit(state.daily_loss_limit ?? 0)
      setAutonomous(state.autonomous ?? false)
    }
  }, [open, state])

  // Fetch max_open_positions from /api/settings since it's not in AppState
  useEffect(() => {
    if (!open) return
    authFetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.max_open_positions != null) {
          setMaxOpenPositions(data.max_open_positions)
        }
      })
      .catch(() => {})
  }, [open, authFetch])

  const handleSaveRisk = useCallback(async () => {
    setSavingRisk(true)
    setRiskSaved(false)
    try {
      await authFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seed_capital: seedCapital,
          daily_loss_limit: dailyLossLimit,
          max_open_positions: maxOpenPositions,
        }),
      })
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
      // revert on failure
      setAutonomous(!next)
    } finally {
      setSavingAuto(false)
    }
  }, [autonomous, authFetch, onStateRefresh])

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title="Strategy Settings"
      width="w-[480px]"
    >
      {/* Notice banner */}
      <div className="bg-surface border border-border/50 rounded-lg mx-4 mt-4 px-4 py-3 text-xs text-text-muted">
        Settings currently apply globally across all strategies. Per-strategy settings are coming soon.
      </div>

      {/* Section: Risk Parameters */}
      <div className="mt-4">
        <div className={SECTION_HEADER_CLASS}>Risk Parameters</div>
        <div className="px-4 py-4 space-y-4">
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
              Max Open Positions
            </label>
            <input
              type="number"
              min={1}
              max={5}
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

      {/* Section: Autonomous Trading */}
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

      {/* Section: Telegram */}
      <div>
        <div className={SECTION_HEADER_CLASS}>Telegram</div>
        <div className="px-4 py-4">
          <p className="text-xs text-text-muted leading-relaxed mb-3">
            Connect Telegram for mobile notifications and to chat with your agent on the go.
          </p>
          <a
            href="/settings#telegram"
            className="text-xs font-mono text-accent-green hover:opacity-80 transition-opacity"
          >
            Manage in Settings &rarr;
          </a>
        </div>
      </div>
    </SlidePanel>
  )
}
