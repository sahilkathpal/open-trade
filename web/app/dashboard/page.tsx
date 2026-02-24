"use client"

import { useEffect, useState, useCallback } from "react"
import { AgentStatusBar } from "@/components/AgentStatusBar"
import { CapitalPanel } from "@/components/CapitalPanel"
import { RiskGauge } from "@/components/RiskGauge"
import { ProposalCard } from "@/components/ProposalCard"
import { PositionCard } from "@/components/PositionCard"
import { ActivityFeed } from "@/components/ActivityFeed"
import { MISCountdown } from "@/components/MISCountdown"
import { TokenUsageCard } from "@/components/TokenUsageCard"

interface TokenUsage {
  input_tokens: number
  output_tokens: number
  api_calls: number
  cost_usd: number
  by_job: Record<string, { input: number; output: number; calls: number }>
}

interface AppState {
  capital: { available_balance: number; used_margin: number; day_pnl: number }
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
}

export default function DashboardPage() {
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState(false)
  const [agentStatus, setAgentStatus] = useState<"idle" | "running">("idle")

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/state")
      if (!res.ok) throw new Error("fetch failed")
      const data = await res.json()
      setState(data)
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

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
        schedulerStatus={state.scheduler_status}
      />

      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Row 1: Capital metrics */}
        <div className="grid grid-cols-3 gap-4">
          <CapitalPanel capital={state.capital} />
          <RiskGauge dayPnl={state.capital.day_pnl} limit={500} />
        </div>

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
                <h3 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">
                  Upcoming Schedule
                </h3>
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
                        <span className="font-mono text-accent-amber">{labels[job.id] ?? job.id}</span>
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
      </div>

      <MISCountdown positions={state.positions} />
    </>
  )
}
