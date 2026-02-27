"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  BarChart2,
  Bot,
  FileText,
  ShieldCheck,
  AlertCircle,
  TrendingUp,
  ArrowUp,
  MessageSquare,
  ChevronLeft,
  RefreshCw,
} from "lucide-react"
import { useAuth } from "@/lib/auth"
import { AppState, StrategyConfig, STRATEGY_CONFIGS } from "@/lib/types"
import { CapitalPanel } from "@/components/CapitalPanel"
import { RiskGauge } from "@/components/RiskGauge"
import { ProposalCard } from "@/components/ProposalCard"
import { PositionCard } from "@/components/PositionCard"
import { WatchlistCard } from "@/components/WatchlistCard"
import { TriggerCard } from "@/components/TriggerCard"
import { TokenUsageCard } from "@/components/TokenUsageCard"
import { MISCountdown } from "@/components/MISCountdown"
import { ActivityFeed } from "@/components/ActivityFeed"
import { MarkdownRenderer } from "@/components/MarkdownRenderer"
import { StrategySettingsPanel } from "@/components/StrategySettingsPanel"

type ActiveTab = "chat" | "trades" | "agent" | "documents"

function formatINR(n: number): string {
  const abs = Math.abs(n)
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(abs)
  return (n < 0 ? "-" : "") + "\u20B9" + formatted
}

// ── Chat tab ──────────────────────────────────────────────────────────────────

function ChatTab({
  config,
  state,
}: {
  config: StrategyConfig
  state: AppState | null
}) {
  const todayPnl = state?.agent_pnl?.total ?? 0
  const positionCount = state?.positions?.length ?? 0
  const watchlistCount = state?.watchlist ? Object.keys(state.watchlist).length : 0

  return (
    <div className="flex flex-col h-full">
      {/* Centered content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pb-8">
        <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center mb-6 border border-border">
          <TrendingUp size={26} className="text-text-primary" />
        </div>

        <h1 className="text-[28px] font-semibold text-text-primary mb-2 text-center">
          {config.name}
        </h1>
        <p className="text-text-muted text-sm text-center mb-8">
          {config.subtitle}
        </p>

        {state && (
          <div className="flex items-center gap-3 mb-8 text-xs text-text-muted">
            <span className={todayPnl >= 0 ? "text-accent-green" : "text-accent-red"}>
              {formatINR(todayPnl)} today
            </span>
            <span>·</span>
            <span>{positionCount} positions</span>
            <span>·</span>
            <span>{watchlistCount} watching</span>
            {state.market_open && (
              <>
                <span>·</span>
                <span className="text-accent-green">Market open</span>
              </>
            )}
          </div>
        )}

        {/* Suggestion cards */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-2xl">
          {[
            "What's the market brief for today?",
            "Review this week's trades and learnings",
            "Suggest improvements to my strategy",
          ].map((prompt) => (
            <button
              key={prompt}
              disabled
              className="bg-surface rounded-xl p-4 text-left border border-border/50 cursor-not-allowed opacity-70 text-xs text-text-muted leading-relaxed"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="px-6 pb-6 shrink-0">
        <div className="max-w-2xl mx-auto bg-surface rounded-2xl border border-border overflow-hidden">
          <input
            type="text"
            disabled
            placeholder="Ask your agent anything — chat coming soon"
            className="w-full bg-transparent px-4 pt-4 pb-3 text-sm placeholder:text-text-muted focus:outline-none cursor-not-allowed"
          />
          <div className="flex items-center justify-between px-3 pb-3">
            <span className="text-xs text-text-muted font-mono">{config.name}</span>
            <button
              disabled
              className="w-7 h-7 rounded-lg bg-text-muted/20 flex items-center justify-center cursor-not-allowed"
            >
              <ArrowUp size={14} className="text-text-muted" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Trades tab ────────────────────────────────────────────────────────────────

function TradesTab({
  state,
  fetchState,
}: {
  state: AppState | null
  fetchState: () => void
}) {
  if (!state) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        Loading...
      </div>
    )
  }

  const agentPnl = state.agent_pnl ?? { realized: 0, unrealized: 0, total: 0 }
  const lossLimit = state.daily_loss_limit ?? 500
  const seedCapital = state.seed_capital ?? 10000
  const deployedNotional = state.positions.reduce(
    (sum, p) => sum + p.entry_price * p.quantity,
    0
  )

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 max-w-5xl mx-auto w-full">
      {/* Capital + Risk */}
      <div className="grid grid-cols-2 gap-4">
        <CapitalPanel
          capital={state.capital}
          agentPnl={agentPnl}
          seedCapital={seedCapital}
          deployedNotional={deployedNotional}
        />
        <RiskGauge dayPnl={agentPnl.total} limit={lossLimit} />
      </div>

      {/* Pending approvals */}
      {Object.keys(state.pending_approvals).length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider">
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

      {/* Positions + Watchlist */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
            Open Positions ({state.positions.length})
          </h2>
          {state.positions.length === 0 ? (
            <div className="bg-surface rounded-lg border border-border p-6 text-center text-text-muted text-sm">
              No open positions
            </div>
          ) : (
            state.positions.map((p) => <PositionCard key={p.symbol} position={p} />)
          )}
        </div>
        <div>
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
            Watchlist ({Object.keys(state.watchlist).length})
          </h2>
          {Object.keys(state.watchlist).length === 0 ? (
            <div className="bg-surface rounded-lg border border-border p-6 text-center text-text-muted text-sm">
              Nothing on watchlist
            </div>
          ) : (
            Object.entries(state.watchlist).map(([symbol, entry]) => (
              <WatchlistCard key={symbol} symbol={symbol} entry={entry} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Agent tab ─────────────────────────────────────────────────────────────────

const JOB_LABELS: Record<string, string> = {
  premarket: "Pre-market screening",
  execution: "Execution planning",
  heartbeat: "Heartbeat (every 1 min)",
  clear_proposals: "Clear proposals",
  eod: "EOD report",
}

function AgentTab({
  state,
  fetchState,
  authFetch,
}: {
  state: AppState | null
  fetchState: () => void
  authFetch: ReturnType<typeof useAuth>["authFetch"]
}) {
  const [pauseLoading, setPauseLoading] = useState(false)

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

  if (!state) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        Loading...
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 max-w-5xl mx-auto w-full">
      {/* Token usage + schedule side by side */}
      <div className="grid grid-cols-2 gap-4">
        {/* Token usage */}
        {state.token_usage && (
          <TokenUsageCard usage={state.token_usage} />
        )}

        {/* Schedule */}
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">
              Schedule
            </h3>
            <button
              onClick={togglePause}
              disabled={pauseLoading}
              className={
                state.paused
                  ? "text-xs font-mono text-accent-green border border-accent-green/30 bg-accent-green/10 rounded px-2 py-0.5 hover:bg-accent-green/20 disabled:opacity-50"
                  : "text-xs font-mono text-text-muted border border-border rounded px-2 py-0.5 hover:text-accent-amber hover:border-accent-amber/30 disabled:opacity-50"
              }
            >
              {pauseLoading ? "..." : state.paused ? "Resume" : "Pause"}
            </button>
          </div>
          {state.paused && (
            <p className="text-xs font-mono text-accent-amber mb-2">
              Paused — jobs will not run
            </p>
          )}
          {state.upcoming_jobs.length === 0 ? (
            <p className="text-xs text-text-muted">No upcoming jobs</p>
          ) : (
            <div className="space-y-1">
              {state.upcoming_jobs.map((job) => {
                const t = new Date(job.next_run)
                const timeStr = t.toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Kolkata",
                  hour12: false,
                })
                const isToday = new Date().toDateString() === t.toDateString()
                const dateStr = t.toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  timeZone: "Asia/Kolkata",
                })
                return (
                  <div
                    key={job.id}
                    className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0"
                  >
                    <span
                      className={
                        state.paused
                          ? "font-mono text-text-muted line-through"
                          : "font-mono text-accent-amber"
                      }
                    >
                      {JOB_LABELS[job.id] ?? job.id}
                    </span>
                    <span className="text-text-muted font-mono">
                      {isToday ? "" : dateStr + " · "}
                      {timeStr} IST
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Triggers */}
      {state.triggers.length > 0 && (
        <div>
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
            Monitoring Triggers ({state.triggers.length})
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {state.triggers.map((t) => (
              <TriggerCard key={t.id} trigger={t} />
            ))}
          </div>
        </div>
      )}

      {/* Activity feed */}
      <ActivityFeed />
    </div>
  )
}

// ── Documents tab ─────────────────────────────────────────────────────────────

function DocumentsTab({
  strategy,
  authFetch,
}: {
  strategy: string
  authFetch: ReturnType<typeof useAuth>["authFetch"]
}) {
  const config = STRATEGY_CONFIGS[strategy]
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchDoc = useCallback(
    async (file: string) => {
      setLoading(true)
      setContent(null)
      try {
        const res = await authFetch(`/api/memory/${file}`)
        if (!res.ok) {
          setContent("")
          return
        }
        const raw = await res.text()
        try {
          const json = JSON.parse(raw)
          setContent(json.content ?? "")
        } catch {
          setContent(raw)
        }
      } catch {
        setContent("")
      } finally {
        setLoading(false)
      }
    },
    [authFetch]
  )

  useEffect(() => {
    if (selectedDocId) {
      const doc = config?.documents.find((d) => d.id === selectedDocId)
      if (doc) fetchDoc(doc.file)
    }
  }, [selectedDocId, config, fetchDoc])

  if (!config || config.documents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        No documents yet. Claude will create documents as it starts trading.
      </div>
    )
  }

  const selectedDoc = config.documents.find((d) => d.id === selectedDocId)

  if (selectedDoc) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
          <button
            onClick={() => { setSelectedDocId(null); setContent(null) }}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronLeft size={13} />
            Documents
          </button>
          <span className="text-border">·</span>
          <span className="text-xs text-text-primary">{selectedDoc.title}</span>
          <button
            onClick={() => fetchDoc(selectedDoc.file)}
            className="ml-auto p-1 text-text-muted hover:text-text-primary transition-colors"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6 max-w-4xl mx-auto w-full">
          {loading && (
            <p className="text-text-muted text-sm">Loading...</p>
          )}
          {!loading && !content && (
            <p className="text-text-muted text-sm">
              No content yet. Claude will write this document as it starts trading.
            </p>
          )}
          {!loading && content && <MarkdownRenderer content={content} />}
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 py-6 max-w-4xl mx-auto w-full">
      <p className="text-xs text-text-muted mb-6">
        Claude writes and updates these documents as it learns and trades.
      </p>
      <div className="grid grid-cols-3 gap-4">
        {config.documents.map((doc) => (
          <button
            key={doc.id}
            onClick={() => setSelectedDocId(doc.id)}
            className="bg-surface rounded-xl p-5 text-left border border-border hover:border-border/80 transition-colors"
          >
            <FileText size={18} className="text-text-muted mb-3" />
            <p className="text-sm font-medium text-text-primary mb-1.5">{doc.title}</p>
            <p className="text-xs text-text-muted leading-relaxed">{doc.description}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS: { id: ActiveTab; label: string; icon: React.ElementType }[] = [
  { id: "chat",      label: "Chat",      icon: MessageSquare },
  { id: "trades",    label: "Trades",    icon: BarChart2     },
  { id: "agent",     label: "Agent",     icon: Bot           },
  { id: "documents", label: "Documents", icon: FileText      },
]

export default function StrategyPage() {
  const params = useParams()
  const strategyId = params.strategy as string
  const config = STRATEGY_CONFIGS[strategyId]

  const { authFetch } = useAuth()
  const [state, setState] = useState<AppState | null>(null)
  const [catchupLoading, setCatchupLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>("chat")
  const [settingsOpen, setSettingsOpen] = useState(false)

  const fetchState = useCallback(async () => {
    try {
      const res = await authFetch("/api/state")
      if (!res.ok) return
      const data = await res.json()
      setState(data)
    } catch {
      // silent
    }
  }, [authFetch])

  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, 10000)
    return () => clearInterval(interval)
  }, [fetchState])

  const runCatchup = useCallback(async () => {
    setCatchupLoading(true)
    try {
      await authFetch("/api/run/catchup", { method: "POST" })
    } finally {
      setCatchupLoading(false)
    }
  }, [authFetch])

  if (!config) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-text-primary text-sm mb-1">Strategy not found</p>
          <p className="text-text-muted text-xs">
            No strategy with id &quot;{strategyId}&quot; exists.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block text-xs text-accent-green hover:underline"
          >
            Go to Portfolio
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">

      {/* Banners */}
      {state && !state.dhan_configured && (
        <div className="flex items-center justify-between bg-accent-amber/10 border-b border-accent-amber/30 px-5 py-2.5 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle size={13} className="text-accent-amber shrink-0" />
            <span className="text-accent-amber">
              Broker not configured — add your Dhan credentials to start trading.
            </span>
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-accent-amber font-medium underline underline-offset-2 hover:opacity-80 shrink-0 ml-4"
          >
            Settings
          </button>
        </div>
      )}

      {state && state.dhan_configured && state.token_expired && (
        <div className="flex items-center justify-between bg-accent-red/10 border-b border-accent-red/30 px-5 py-2.5 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle size={13} className="text-accent-red shrink-0" />
            <span className="text-accent-red">
              Dhan access token has expired — trading is paused until you update it.
            </span>
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-accent-red font-medium underline underline-offset-2 hover:opacity-80 shrink-0 ml-4"
          >
            Update Token
          </button>
        </div>
      )}

      {state && state.catchup_available && (
        <div className="flex items-center justify-between bg-accent-green/10 border-b border-accent-green/30 px-5 py-2.5 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-accent-green font-medium">Market is open</span>
            <span className="text-text-muted">
              — no analysis has run today. Start a session to screen candidates.
            </span>
          </div>
          <button
            onClick={runCatchup}
            disabled={catchupLoading}
            className="ml-4 shrink-0 bg-accent-green text-black text-xs font-semibold px-3 py-1 rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {catchupLoading ? "Starting..." : "Start Today's Session"}
          </button>
        </div>
      )}

      {/* Tab header */}
      {(() => {
        const dayLoss = state ? (state.agent_pnl?.total ?? 0) : 0
        const lossUsed = dayLoss < 0 ? Math.abs(dayLoss) : 0
        const lossLimit = state?.daily_loss_limit ?? 0
        const lossPct = lossLimit > 0 ? (lossUsed / lossLimit) * 100 : 0
        const riskLevel = lossPct > 80 ? "alert" : lossPct > 50 ? "caution" : "safe"
        const shieldColor = !state ? "text-text-muted"
          : riskLevel === "alert"   ? "text-accent-red"
          : riskLevel === "caution" ? "text-accent-amber"
          : "text-accent-green"
        const shieldBg = !state ? "bg-transparent border-border"
          : riskLevel === "alert"   ? "bg-accent-red/10 border-accent-red/30"
          : riskLevel === "caution" ? "bg-accent-amber/10 border-accent-amber/30"
          : "bg-accent-green/10 border-accent-green/30"
        return (
          <div className="border-b border-border shrink-0 flex items-center justify-between px-4">
            <div className="flex items-center">
              {TABS.map(({ id, label, icon: Icon }) => {
                const isActive = activeTab === id
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={[
                      "flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 transition-colors -mb-px",
                      isActive
                        ? "border-text-primary text-text-primary"
                        : "border-transparent text-text-muted hover:text-text-primary",
                    ].join(" ")}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              className={[
                "flex items-center gap-1.5 mr-1 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors hover:opacity-80",
                shieldColor, shieldBg,
              ].join(" ")}
              title="Risk guardrails"
            >
              <ShieldCheck size={14} />
              <span>Guardrails</span>
            </button>
          </div>
        )
      })()}

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {activeTab === "chat" && (
          <ChatTab config={config} state={state} />
        )}
        {activeTab === "trades" && (
          <TradesTab state={state} fetchState={fetchState} />
        )}
        {activeTab === "agent" && (
          <AgentTab state={state} fetchState={fetchState} authFetch={authFetch} />
        )}
        {activeTab === "documents" && (
          <DocumentsTab strategy={strategyId} authFetch={authFetch} />
        )}
      </div>

      <MISCountdown positions={state?.positions ?? []} />

      <StrategySettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        state={state}
        onStateRefresh={fetchState}
        strategy={strategyId}
      />
    </div>
  )
}
