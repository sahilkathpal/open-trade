"use client"

import { useEffect, useState, useCallback } from "react"
import { useAuth } from "@/lib/auth"
import { STRATEGIES, getActiveStrategy, setActiveStrategy } from "@/lib/strategy"
import { AgentStatusBar } from "@/components/AgentStatusBar"
import { CapitalPanel } from "@/components/CapitalPanel"
import { RiskGauge } from "@/components/RiskGauge"
import { ProposalCard } from "@/components/ProposalCard"
import { PositionCard } from "@/components/PositionCard"
import { ActivityFeed } from "@/components/ActivityFeed"
import { MISCountdown } from "@/components/MISCountdown"
import { TokenUsageCard } from "@/components/TokenUsageCard"
import { WatchlistCard } from "@/components/WatchlistCard"
import { TriggerCard } from "@/components/TriggerCard"

interface TokenUsage {
  input_tokens: number
  output_tokens: number
  api_calls: number
  cost_usd: number
  by_job: Record<string, { input: number; output: number; calls: number }>
}

interface AppState {
  capital: { available_balance: number; used_margin: number }
  positions: Array<{
    symbol: string
    entry_price: number
    current_price: number
    quantity: number
    pnl: number
    stop_loss_price: number
    target_price: number
  }>
  pending_approvals: Record<
    string,
    {
      symbol: string
      security_id: string
      transaction_type: string
      quantity: number
      entry_price: number
      stop_loss_price: number
      thesis: string
      target_price: number
    }
  >
  market_open: boolean
  scheduler_status: { last_premarket: string | null; last_eod: string | null }
  upcoming_jobs: Array<{ id: string; next_run: string }>
  token_usage: TokenUsage
  dhan_configured: boolean
  token_expired: boolean
  catchup_available: boolean
  agent_pnl?: { realized: number; unrealized: number; total: number }
  daily_loss_limit?: number
  seed_capital?: number
  autonomous?: boolean
  paused?: boolean
  watchlist: Record<string, {
    security_id: string
    entry_min: number
    entry_max: number
    stop_loss_price: number
    target_price: number
    quantity: number
    thesis: string
    rsi_max?: number
    candle_close_above?: number
  }>
  triggers: Array<{
    id: string
    type: string
    reason: string
    expires_at: string
    symbol?: string
    threshold?: number
    at?: string
    buffer_pct?: number
    above_pct?: number
  }>
}

export default function DashboardPage() {
  const { authFetch } = useAuth()
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState(false)
  const [agentStatus, setAgentStatus] = useState<"idle" | "running">("idle")
  const [catchupLoading, setCatchupLoading] = useState(false)
  const [pauseLoading, setPauseLoading] = useState(false)
  const [activeTab, setActiveTab] = useState(() =>
    STRATEGIES.findIndex((s) => s.id === getActiveStrategy())
  )

  const handleTabChange = (i: number) => {
    setActiveTab(i)
    setActiveStrategy(STRATEGIES[i].id)
  }

  const runCatchup = useCallback(async () => {
    setCatchupLoading(true)
    setAgentStatus("running")
    try {
      await authFetch("/api/run/catchup", { method: "POST" })
    } finally {
      setCatchupLoading(false)
    }
  }, [authFetch])

  const fetchState = useCallback(async () => {
    try {
      const res = await authFetch("/api/state")
      if (!res.ok) throw new Error("fetch failed")
      const data = await res.json()
      setState(data)
      setError(false)
    } catch {
      setError(true)
    }
  }, [authFetch])

  const togglePause = useCallback(async () => {
    if (!state) return
    setPauseLoading(true)
    try {
      await authFetch(state.paused ? "/api/resume" : "/api/pause", { method: "POST" })
      await fetchState()
    } finally {
      setPauseLoading(false)
    }
  }, [state, authFetch, fetchState])

  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, 10000)
    return () => clearInterval(interval)
  }, [fetchState])

  // SSE listener for agent status
  useEffect(() => {
    let es: EventSource | null = null

    function connect() {
      es = new EventSource("/api/activity")
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === "job_start") setAgentStatus("running")
          else if (data.type === "job_end") setAgentStatus("idle")
        } catch {
          // skip
        }
      }
      es.onerror = () => {
        es?.close()
        setTimeout(connect, 5000)
      }
    }

    connect()
    return () => es?.close()
  }, [])

  if (error && !state) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-accent-red text-lg mb-2">API Offline</div>
          <p className="text-text-muted text-sm">Cannot connect to the API server</p>
        </div>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-text-muted">Loading...</div>
      </div>
    )
  }

  return (
    <>
      <AgentStatusBar
        marketOpen={state.market_open}
        agentStatus={agentStatus}
        autonomous={state.autonomous ?? false}
      />

      <div className="space-y-6 max-w-7xl mx-auto pt-6">
        {/* Broker not configured banner */}
        {!state.dhan_configured && (
          <div className="flex items-center justify-between bg-accent-amber/10 border border-accent-amber/30 rounded-lg px-4 py-3 text-sm">
            <span className="text-accent-amber">Broker not connected — add your Dhan credentials to start trading.</span>
            <a href="/settings" className="text-accent-amber font-medium underline underline-offset-2 hover:opacity-80">Go to Settings →</a>
          </div>
        )}

        {/* Token expired banner */}
        {state.dhan_configured && state.token_expired && (
          <div className="flex items-center justify-between bg-accent-red/10 border border-accent-red/30 rounded-lg px-4 py-3 text-sm">
            <span className="text-accent-red">Dhan access token has expired — trading is paused until you update it.</span>
            <a href="/settings" className="text-accent-red font-medium underline underline-offset-2 hover:opacity-80">Update Token →</a>
          </div>
        )}

        {/* Catchup banner — market open but no analysis done today */}
        {state.catchup_available && (
          <div className="flex items-center justify-between bg-accent-green/10 border border-accent-green/30 rounded-lg px-4 py-3 text-sm">
            <div>
              <span className="text-accent-green font-medium">Market is open</span>
              <span className="text-text-muted ml-2">— no analysis has run today. Start a session to screen candidates and plan entries.</span>
            </div>
            <button
              onClick={runCatchup}
              disabled={catchupLoading}
              className="ml-4 shrink-0 bg-accent-green text-black text-xs font-semibold px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {catchupLoading ? "Starting..." : "Start Today's Session"}
            </button>
          </div>
        )}

        {/* Strategy tabs */}
        {(() => {
          const tabs = [
            { ...STRATEGIES[0], sub: "NSE large-cap · MIS · exits by 3:10 PM",     comingSoon: null },
            { ...STRATEGIES[1], sub: "Multi-day positions · overnight risk mgmt",   comingSoon: "Multi-day position strategy with overnight risk management." },
            { ...STRATEGIES[2], sub: "Bring your own logic",                        comingSoon: "Create your own strategy by chatting with your agent." },
          ]
          return (
            <>
              <div className="flex items-end gap-1 border-b border-border">
                {tabs.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => handleTabChange(i)}
                    className={[
                      "flex flex-col items-start px-4 pt-3 pb-2.5 rounded-t-lg border border-b-0 text-left transition-colors",
                      activeTab === i
                        ? "bg-surface border-border text-text-primary"
                        : "border-transparent text-text-muted hover:text-text-primary",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{t.label}</span>
                      {t.live
                        ? <span className="text-[10px] font-mono text-accent-green border border-accent-green/40 rounded px-1.5 py-0.5">● LIVE</span>
                        : <span className="text-[10px] font-mono text-text-muted border border-border rounded px-1.5 py-0.5">SOON</span>
                      }
                    </div>
                    <span className="text-[11px] text-text-muted mt-0.5">{t.sub}</span>
                  </button>
                ))}
              </div>

              {tabs[activeTab].comingSoon && (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="text-4xl mb-4 opacity-20">◎</div>
                  <p className="font-mono text-sm text-text-primary mb-2">{tabs[activeTab].label}</p>
                  <p className="text-sm text-text-muted max-w-sm">{tabs[activeTab].comingSoon}</p>
                </div>
              )}
            </>
          )
        })()}

        {activeTab === 0 && <>

        {/* Row 1: Capital metrics */}
        {(() => {
          const agentPnl = state.agent_pnl ?? { realized: 0, unrealized: 0, total: 0 }
          const lossLimit = state.daily_loss_limit ?? 500
          const seedCapital = state.seed_capital ?? 10000
          const deployedNotional = state.positions.reduce((sum, p) => sum + p.entry_price * p.quantity, 0)
          return (
            <div className="grid grid-cols-3 gap-4">
              <CapitalPanel capital={state.capital} agentPnl={agentPnl} seedCapital={seedCapital} deployedNotional={deployedNotional} />
              <RiskGauge dayPnl={agentPnl.total} limit={lossLimit} />
            </div>
          )
        })()}

        {/* Row 2: Pending proposals */}
        {Object.keys(state.pending_approvals).length > 0 && (
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
              Pending Approvals
            </h2>
            {Object.entries(state.pending_approvals).map(([symbol, params]) => (
              <ProposalCard
                key={symbol}
                {...params}
                onApproved={fetchState}
                onDenied={fetchState}
              />
            ))}
          </div>
        )}

        {/* Row 2b: Watchlist */}
        {state.watchlist && Object.keys(state.watchlist).length > 0 && (
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
              Watchlist ({Object.keys(state.watchlist).length})
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(state.watchlist).map(([symbol, entry]) => (
                <WatchlistCard key={symbol} symbol={symbol} entry={entry} />
              ))}
            </div>
          </div>
        )}

        {/* Row 2c: Triggers */}
        {state.triggers && state.triggers.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
              Monitoring Triggers ({state.triggers.length})
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {state.triggers.map((t) => (
                <TriggerCard key={t.id} trigger={t} />
              ))}
            </div>
          </div>
        )}

        {/* Row 3: Positions + Activity + Token Usage */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">
              Open Positions ({state.positions.length})
            </h2>
            {state.positions.length === 0 ? (
              <div className="bg-surface rounded-lg border border-border p-8 text-center text-text-muted text-sm">
                No open positions
              </div>
            ) : (
              state.positions.map((p) => <PositionCard key={p.symbol} position={p} />)
            )}
            {/* Token usage below positions */}
            <div className="mt-4">
              {state.token_usage && <TokenUsageCard usage={state.token_usage} />}
            </div>
          </div>
          <div className="col-span-2 space-y-4">
            <ActivityFeed />
            {state.upcoming_jobs.length > 0 && (
              <div className="bg-surface rounded-lg border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-text-muted uppercase tracking-wider">
                    Upcoming Schedule
                  </h3>
                  <button
                    onClick={togglePause}
                    disabled={pauseLoading}
                    className={state.paused
                      ? "text-xs font-mono text-accent-green border border-accent-green/30 bg-accent-green/10 rounded px-2 py-0.5 hover:bg-accent-green/20 transition-colors disabled:opacity-50"
                      : "text-xs font-mono text-text-muted border border-border rounded px-2 py-0.5 hover:text-accent-amber hover:border-accent-amber/30 transition-colors disabled:opacity-50"
                    }
                  >
                    {pauseLoading ? "..." : state.paused ? "Resume" : "Pause"}
                  </button>
                </div>
                {state.paused && (
                  <p className="text-xs font-mono text-accent-amber mb-2">Paused — jobs will not run</p>
                )}
                <div className="space-y-1">
                  {state.upcoming_jobs.map((job) => {
                    const t = new Date(job.next_run)
                    const timeStr = t.toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Kolkata",
                      hour12: false,
                    })
                    const dateStr = t.toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      timeZone: "Asia/Kolkata",
                    })
                    const isToday = new Date().toDateString() === t.toDateString()
                    const labels: Record<string, string> = {
                      premarket: "Pre-market screening",
                      execution: "Execution planning",
                      heartbeat: "Heartbeat",
                      clear_proposals: "Clear proposals",
                      eod: "EOD report",
                    }
                    return (
                      <div key={job.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0">
                        <span className={state.paused ? "font-mono text-text-muted line-through" : "font-mono text-accent-amber"}>
                          {labels[job.id] ?? job.id}
                        </span>
                        <span className="text-text-muted font-mono">
                          {isToday ? "" : dateStr + " · "}{timeStr} IST
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        </>}
      </div>

      <MISCountdown positions={state.positions} />
    </>
  )
}
