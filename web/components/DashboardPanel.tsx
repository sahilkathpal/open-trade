"use client"

import { useState } from "react"
import { SlidePanel } from "@/components/SlidePanel"
import { CapitalPanel } from "@/components/CapitalPanel"
import { RiskGauge } from "@/components/RiskGauge"
import { PositionCard } from "@/components/PositionCard"
import { WatchlistCard } from "@/components/WatchlistCard"
import { TriggerCard } from "@/components/TriggerCard"
import { ProposalCard } from "@/components/ProposalCard"
import { MISCountdown } from "@/components/MISCountdown"
import { useAuth } from "@/lib/auth"
import { AppState } from "@/lib/types"

interface DashboardPanelProps {
  open: boolean
  onClose: () => void
  state: AppState | null
  onStateRefresh: () => void
}

type Tab = "overview" | "positions" | "watchlist" | "triggers" | "approvals"

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "positions", label: "Positions" },
  { id: "watchlist", label: "Watchlist" },
  { id: "triggers", label: "Triggers" },
  { id: "approvals", label: "Approvals" },
]

function formatRelative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return "now"
  const sec = Math.round(ms / 1000)
  if (sec < 90) return `in ${sec}s`
  const min = Math.round(ms / 60000)
  if (min < 60) return `in ${min}m`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  const istOpts = { timeZone: "Asia/Kolkata" } as const
  const todayDate = new Date().toLocaleDateString("en-IN", istOpts)
  const tDate = new Date(iso).toLocaleDateString("en-IN", istOpts)
  const timeStr = new Date(iso).toLocaleTimeString("en-IN", { ...istOpts, hour: "2-digit", minute: "2-digit", hour12: false })
  if (todayDate === tDate) return remMin === 0 ? `in ${hr}h` : `in ${hr}h ${remMin}m`
  const tomorrowDate = new Date(Date.now() + 86400000).toLocaleDateString("en-IN", istOpts)
  if (tDate === tomorrowDate) return `tomorrow · ${timeStr}`
  const dateStr = new Date(iso).toLocaleDateString("en-IN", { ...istOpts, day: "numeric", month: "short" })
  return `${dateStr} · ${timeStr}`
}

export function DashboardPanel({
  open,
  onClose,
  state,
  onStateRefresh,
}: DashboardPanelProps) {
  const { authFetch } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>("overview")
  const [pauseLoading, setPauseLoading] = useState(false)

  const agentPnl = state?.agent_pnl ?? { realized: 0, unrealized: 0, total: 0 }
  const deployedNotional = (state?.positions ?? []).reduce(
    (sum, p) => sum + p.entry_price * p.quantity,
    0
  )

  const approvalEntries = Object.entries(state?.pending_approvals ?? {})
  const watchlistEntries = Object.entries(state?.watchlist ?? {})

  async function handlePauseResume() {
    if (!state) return
    setPauseLoading(true)
    try {
      const endpoint = state.paused ? "/api/resume" : "/api/pause"
      await authFetch(endpoint, { method: "POST" })
      onStateRefresh()
    } catch {
      // fail silently
    } finally {
      setPauseLoading(false)
    }
  }

  return (
    <>
      <SlidePanel title="Dashboard" width="w-[560px]" open={open} onClose={onClose}>
        {/* Tabs */}
        <div className="flex border-b border-border px-4 shrink-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-xs font-mono transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "text-text-primary border-b-2 border-text-primary"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {tab.label}
              {tab.id === "approvals" && approvalEntries.length > 0 && (
                <span className="ml-1.5 bg-accent-amber text-black rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
                  {approvalEntries.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-4 space-y-4">
          {/* Overview */}
          {activeTab === "overview" && state && (
            <>
              <CapitalPanel
                capital={state.capital}
                agentPnl={agentPnl}
                seedCapital={state.seed_capital ?? 0}
                deployedNotional={deployedNotional}
              />

              <RiskGauge
                seedCapital={state.seed_capital ?? 0}
                cumulativeRealized={state.cumulative_realized ?? 0}
                maxDrawdownPct={state.max_drawdown_pct ?? 10}
              />

              {/* Upcoming schedule */}
              <div className="bg-background rounded-lg border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase tracking-wider text-text-muted font-medium">
                    Upcoming Schedule
                  </span>
                  <button
                    onClick={handlePauseResume}
                    disabled={pauseLoading}
                    className={`text-xs font-mono px-3 py-1 rounded border transition-colors disabled:opacity-50 ${
                      state.paused
                        ? "border-accent-green text-accent-green hover:bg-accent-green/10"
                        : "border-accent-amber text-accent-amber hover:bg-accent-amber/10"
                    }`}
                  >
                    {pauseLoading ? "..." : state.paused ? "Resume" : "Pause"}
                  </button>
                </div>

                {state.upcoming_jobs.length === 0 ? (
                  <p className="text-text-muted text-xs font-mono">No scheduled jobs</p>
                ) : (
                  <div className="space-y-2">
                    {state.upcoming_jobs.map((job) => (
                      <div
                        key={job.id}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-text-muted font-mono">
                          {(job.label ?? job.id).split(":")[0]}
                        </span>
                        <span className="text-text-primary font-mono">
                          {formatRelative(job.next_run)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {state.paused && (
                  <p className="text-xs text-accent-amber font-mono mt-3">
                    Autonomous trading is paused
                  </p>
                )}
              </div>
            </>
          )}

          {/* Overview loading */}
          {activeTab === "overview" && !state && (
            <p className="text-text-muted text-sm text-center py-12">Loading...</p>
          )}

          {/* Positions */}
          {activeTab === "positions" && (
            <>
              {!state || state.positions.length === 0 ? (
                <p className="text-text-muted text-sm text-center py-12">
                  No open positions
                </p>
              ) : (
                state.positions.map((pos) => (
                  <PositionCard key={pos.symbol} position={pos} />
                ))
              )}
            </>
          )}

          {/* Watchlist */}
          {activeTab === "watchlist" && (
            <>
              {watchlistEntries.length === 0 ? (
                <p className="text-text-muted text-sm text-center py-12">
                  Nothing on watchlist
                </p>
              ) : (
                watchlistEntries.map(([symbol, entry]) => (
                  <WatchlistCard key={symbol} symbol={symbol} entry={entry} />
                ))
              )}
            </>
          )}

          {/* Triggers */}
          {activeTab === "triggers" && (
            <>
              {!state || state.triggers.length === 0 ? (
                <p className="text-text-muted text-sm text-center py-12">
                  No active triggers
                </p>
              ) : (
                <div className="space-y-2">
                  {state.triggers.map((trigger) => (
                    <TriggerCard key={trigger.id} trigger={trigger} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Approvals */}
          {activeTab === "approvals" && (
            <>
              {approvalEntries.length === 0 ? (
                <p className="text-text-muted text-sm text-center py-12">
                  No pending approvals
                </p>
              ) : (
                approvalEntries.map(([, proposal]) => (
                  <ProposalCard
                    key={proposal.symbol}
                    symbol={proposal.symbol}
                    transaction_type={proposal.transaction_type}
                    entry_price={proposal.entry_price}
                    stop_loss_price={proposal.stop_loss_price}
                    target_price={proposal.target_price}
                    quantity={proposal.quantity}
                    thesis={proposal.thesis}
                    maxLossPerTrade={state?.max_loss_per_trade}
                    onApproved={onStateRefresh}
                    onDenied={onStateRefresh}
                  />
                ))
              )}
            </>
          )}
        </div>
      </SlidePanel>

      {/* Fixed bottom-right countdown — rendered outside the panel so it's always visible */}
      <MISCountdown positions={state?.positions ?? []} />
    </>
  )
}
