"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Lock, ArrowRight } from "lucide-react"
import clsx from "clsx"
import { useAuth } from "@/lib/auth"
import { AppState, STRATEGY_CONFIGS, COMING_SOON_STRATEGIES } from "@/lib/types"

export default function PortfolioPage() {
  const { authFetch } = useAuth()
  const [state, setState] = useState<AppState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    authFetch("/api/state")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load state")
        const data = await res.json()
        setState(data)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [authFetch])

  const intraday = STRATEGY_CONFIGS["intraday"]

  const todayPnl = state?.agent_pnl?.total ?? 0
  const openPositions = state?.positions?.length ?? 0
  const activeStrategies = 1

  return (
    <div className="px-6 py-8 max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-mono text-xl text-text-primary font-semibold">Portfolio</h1>
        <p className="text-text-muted text-sm mt-1">All your strategies in one place</p>
      </div>

      {/* Stats row */}
      {loading ? (
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-surface border border-border rounded-lg px-4 py-4 animate-pulse">
              <div className="h-3 bg-border rounded w-2/3 mb-2" />
              <div className="h-5 bg-border rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-surface border border-border rounded-lg px-4 py-4">
            <p className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-1">
              Today&apos;s P&amp;L
            </p>
            <p
              className={clsx(
                "text-lg font-mono font-semibold",
                todayPnl > 0
                  ? "text-accent-green"
                  : todayPnl < 0
                  ? "text-accent-red"
                  : "text-text-primary"
              )}
            >
              {todayPnl >= 0 ? "+" : ""}
              {"\u20b9"}
              {todayPnl.toLocaleString("en-IN", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })}
            </p>
          </div>
          <div className="bg-surface border border-border rounded-lg px-4 py-4">
            <p className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-1">
              Open Positions
            </p>
            <p className="text-lg font-mono font-semibold text-text-primary">
              {openPositions}
            </p>
          </div>
          <div className="bg-surface border border-border rounded-lg px-4 py-4">
            <p className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-1">
              Active Strategies
            </p>
            <p className="text-lg font-mono font-semibold text-text-primary">
              {activeStrategies}
            </p>
          </div>
        </div>
      )}

      {/* Active strategy */}
      <div className="mb-8">
        <p className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-3">
          Active
        </p>

        <Link
          href="/s/intraday"
          className="group block bg-surface border border-border rounded-lg px-5 py-4 hover:border-accent-green/40 transition-colors"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[9px] font-mono font-semibold tracking-widest px-1.5 py-0.5 rounded bg-accent-green/15 text-accent-green border border-accent-green/25">
                  LIVE
                </span>
              </div>
              <h2 className="font-mono font-semibold text-text-primary text-[15px] mb-0.5">
                {intraday.name}
              </h2>
              <p className="text-text-muted text-[12px] font-mono mb-3">
                {intraday.subtitle}
              </p>
              <div className="flex items-center gap-3">
                {/* P&L chip */}
                <span
                  className={clsx(
                    "text-[11px] font-mono px-2 py-0.5 rounded border",
                    todayPnl > 0
                      ? "bg-accent-green/10 text-accent-green border-accent-green/20"
                      : todayPnl < 0
                      ? "bg-accent-red/10 text-accent-red border-accent-red/20"
                      : "bg-background text-text-muted border-border"
                  )}
                >
                  {todayPnl >= 0 ? "+" : ""}
                  {"\u20b9"}
                  {loading
                    ? "—"
                    : todayPnl.toLocaleString("en-IN", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                  {" today"}
                </span>
                {/* Positions chip */}
                <span className="text-[11px] font-mono px-2 py-0.5 rounded border bg-background text-text-muted border-border">
                  {loading ? "—" : openPositions}{" "}
                  {openPositions === 1 ? "position" : "positions"}
                </span>
              </div>
            </div>
            <ArrowRight
              size={16}
              className="text-text-muted group-hover:text-text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1"
            />
          </div>
        </Link>
      </div>

      {/* Error state */}
      {error && (
        <p className="text-[12px] font-mono text-accent-amber mb-6">
          Could not load live data: {error}
        </p>
      )}

      {/* Coming soon */}
      <div>
        <p className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-3">
          Coming Soon
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {COMING_SOON_STRATEGIES.map((s) => (
            <div
              key={s.id}
              className="opacity-60 bg-surface border border-border rounded-lg px-4 py-4 cursor-not-allowed select-none"
            >
              <div className="flex items-center gap-2 mb-2">
                <Lock size={12} className="text-text-muted shrink-0" />
                <h3 className="font-mono text-[13px] font-semibold text-text-primary truncate">
                  {s.name}
                </h3>
              </div>
              <p className="text-[11px] text-text-muted leading-relaxed">
                {s.goal}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
