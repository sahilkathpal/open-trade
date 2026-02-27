"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  LayoutDashboard,
  Zap,
  FileText,
  Settings,
  MessageSquare,
  ChevronRight,
  AlertCircle,
} from "lucide-react"
import { useAuth } from "@/lib/auth"
import { AppState, STRATEGY_CONFIGS } from "@/lib/types"
import { DashboardPanel } from "@/components/DashboardPanel"
import { ActivityPanel } from "@/components/ActivityPanel"
import { DocumentsPanel } from "@/components/DocumentsPanel"
import { StrategySettingsPanel } from "@/components/StrategySettingsPanel"

type ActivePanel = "dashboard" | "activity" | "documents" | "settings" | null

function formatINR(n: number): string {
  const abs = Math.abs(n)
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(abs)
  return (n < 0 ? "-" : "") + "\u20B9" + formatted
}

export default function StrategyPage() {
  const params = useParams()
  const strategyId = params.strategy as string
  const config = STRATEGY_CONFIGS[strategyId]

  const { authFetch } = useAuth()
  const [state, setState] = useState<AppState | null>(null)
  const [catchupLoading, setCatchupLoading] = useState(false)
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)

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

  const togglePanel = (panel: Exclude<ActivePanel, null>) => {
    setActivePanel((prev) => (prev === panel ? null : panel))
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-text-primary font-mono text-sm mb-1">Strategy not found</p>
          <p className="text-text-muted text-xs">
            No strategy with id &quot;{strategyId}&quot; exists.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block text-xs font-mono text-accent-green hover:underline"
          >
            Go to Portfolio
          </Link>
        </div>
      </div>
    )
  }

  const todayPnl = state?.agent_pnl?.total ?? null
  const positionCount = state?.positions?.length ?? 0
  const watchlistCount = state?.watchlist ? Object.keys(state.watchlist).length : 0
  const triggerCount = state?.triggers?.length ?? 0

  const actionBtnBase =
    "text-xs font-mono px-3 py-1.5 rounded-md border border-border text-text-muted hover:text-text-primary hover:border-border/80 transition-colors flex items-center gap-1.5"
  const actionBtnActive =
    "text-xs font-mono px-3 py-1.5 rounded-md border border-border bg-surface text-text-primary flex items-center gap-1.5"

  return (
    <>
      <div className="px-6 py-6 max-w-5xl mx-auto">

        {/* ── Header row ─────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-xs font-mono text-text-muted">
            <Link href="/" className="hover:text-text-primary transition-colors">
              Portfolio
            </Link>
            <span>/</span>
            <span className="text-text-primary">{config.name}</span>
          </nav>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => togglePanel("dashboard")}
              className={activePanel === "dashboard" ? actionBtnActive : actionBtnBase}
            >
              <LayoutDashboard size={13} />
              Dashboard
            </button>
            <button
              onClick={() => togglePanel("activity")}
              className={activePanel === "activity" ? actionBtnActive : actionBtnBase}
            >
              <Zap size={13} />
              Activity
            </button>
            <button
              onClick={() => togglePanel("documents")}
              className={activePanel === "documents" ? actionBtnActive : actionBtnBase}
            >
              <FileText size={13} />
              Documents
            </button>
            <button
              onClick={() => togglePanel("settings")}
              className={activePanel === "settings" ? actionBtnActive : actionBtnBase}
            >
              <Settings size={13} />
              Settings
            </button>
          </div>
        </div>

        {/* ── Strategy title block ────────────────────────── */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            {config.live && (
              <span className="text-[10px] font-mono text-accent-green border border-accent-green/40 rounded px-1.5 py-0.5 leading-none">
                ● LIVE
              </span>
            )}
          </div>
          <h1 className="text-xl font-mono font-semibold text-text-primary mb-1.5">
            {config.name}
          </h1>
          <p className="text-text-muted text-sm max-w-lg leading-relaxed">{config.goal}</p>
        </div>

        {/* ── Stats row ───────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          {/* Today's P&L */}
          <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3.5 py-2">
            <span className="text-xs text-text-muted font-mono">Today&apos;s P&amp;L</span>
            {todayPnl !== null ? (
              <span
                className={[
                  "text-sm font-mono font-semibold",
                  todayPnl >= 0 ? "text-accent-green" : "text-accent-red",
                ].join(" ")}
              >
                {formatINR(todayPnl)}
              </span>
            ) : (
              <span className="text-sm font-mono text-text-muted">—</span>
            )}
          </div>

          {/* Open Positions */}
          <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3.5 py-2">
            <span className="text-xs text-text-muted font-mono">Open Positions</span>
            <span className="text-sm font-mono font-semibold text-text-primary">
              {positionCount}
            </span>
          </div>

          {/* Watchlist */}
          <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3.5 py-2">
            <span className="text-xs text-text-muted font-mono">Watchlist</span>
            <span className="text-sm font-mono font-semibold text-text-primary">
              {watchlistCount}
            </span>
          </div>

          {/* Triggers */}
          <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3.5 py-2">
            <span className="text-xs text-text-muted font-mono">Triggers</span>
            <span className="text-sm font-mono font-semibold text-text-primary">
              {triggerCount}
            </span>
          </div>
        </div>

        {/* ── Agent status row ───────────────────────────── */}
        {state && (
          <div className="flex items-center gap-4 mb-6 text-xs font-mono text-text-muted">
            {/* Market status */}
            <div className="flex items-center gap-1.5">
              <span
                className={[
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  state.market_open ? "bg-accent-green" : "bg-text-muted",
                ].join(" ")}
              />
              <span>Market: {state.market_open ? "OPEN" : "CLOSED"}</span>
            </div>

            <span className="text-border">·</span>

            {/* Mode */}
            <div className="flex items-center gap-1.5">
              <span>Mode: {state.autonomous ? "Autonomous ON" : "Autonomous OFF"}</span>
            </div>

            {/* Paused badge */}
            {state.paused && (
              <>
                <span className="text-border">·</span>
                <span className="px-2 py-0.5 rounded bg-accent-amber/10 border border-accent-amber/30 text-accent-amber">
                  Paused
                </span>
              </>
            )}
          </div>
        )}

        {/* ── Banners ─────────────────────────────────────── */}
        {state && !state.dhan_configured && (
          <div className="flex items-center justify-between bg-accent-amber/10 border border-accent-amber/30 rounded-lg px-4 py-3 text-sm mb-4">
            <div className="flex items-center gap-2.5">
              <AlertCircle size={15} className="text-accent-amber shrink-0" />
              <span className="text-accent-amber">
                Broker not configured — add your Dhan credentials to start trading.
              </span>
            </div>
            <button
              onClick={() => togglePanel("settings")}
              className="text-accent-amber font-mono text-xs font-medium underline underline-offset-2 hover:opacity-80 shrink-0 ml-4"
            >
              Settings →
            </button>
          </div>
        )}

        {state && state.dhan_configured && state.token_expired && (
          <div className="flex items-center justify-between bg-accent-red/10 border border-accent-red/30 rounded-lg px-4 py-3 text-sm mb-4">
            <div className="flex items-center gap-2.5">
              <AlertCircle size={15} className="text-accent-red shrink-0" />
              <span className="text-accent-red">
                Dhan access token has expired — trading is paused until you update it.
              </span>
            </div>
            <button
              onClick={() => togglePanel("settings")}
              className="text-accent-red font-mono text-xs font-medium underline underline-offset-2 hover:opacity-80 shrink-0 ml-4"
            >
              Update Token →
            </button>
          </div>
        )}

        {state && state.catchup_available && (
          <div className="flex items-center justify-between bg-accent-green/10 border border-accent-green/30 rounded-lg px-4 py-3 text-sm mb-4">
            <div>
              <span className="text-accent-green font-medium">Market is open</span>
              <span className="text-text-muted ml-2">
                — no analysis has run today. Start a session to screen candidates and plan entries.
              </span>
            </div>
            <button
              onClick={runCatchup}
              disabled={catchupLoading}
              className="ml-4 shrink-0 bg-accent-green text-black text-xs font-semibold font-mono px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {catchupLoading ? "Starting..." : "Start Today's Session"}
            </button>
          </div>
        )}

        <div className="border-t border-border my-8" />

        {/* ── Chats section ───────────────────────────────── */}
        <section className="mb-10">
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-muted mb-4">
            Chats
          </h2>

          {/* Coming soon banner */}
          <div className="bg-surface border border-border rounded-lg p-5 mb-4">
            <p className="text-sm text-text-primary font-medium mb-1.5">
              Chat directly with your agent — coming soon
            </p>
            <p className="text-xs text-text-muted leading-relaxed max-w-xl">
              Ask Claude to analyze a news event, adjust your strategy, review the week&apos;s
              trades, or just think through a thesis together. Each conversation becomes part of
              this strategy&apos;s history.
            </p>
            <button
              disabled
              className="mt-4 text-xs font-mono px-3 py-1.5 rounded-md border border-border text-text-muted cursor-not-allowed opacity-50"
            >
              Start a chat
            </button>
          </div>

          {/* Demo thread items */}
          <div className="space-y-2 opacity-50 pointer-events-none select-none">
            <div className="flex items-center gap-3 bg-surface border border-border rounded-lg px-4 py-3">
              <MessageSquare size={14} className="text-text-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary truncate">
                  Planning for tomorrow&apos;s session
                </p>
                <p className="text-xs text-text-muted mt-0.5">Yesterday, 10:32 PM</p>
              </div>
              <ChevronRight size={14} className="text-text-muted shrink-0" />
            </div>

            <div className="flex items-center gap-3 bg-surface border border-border rounded-lg px-4 py-3">
              <MessageSquare size={14} className="text-text-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary truncate">
                  Defense sector thesis — Iran risk
                </p>
                <p className="text-xs text-text-muted mt-0.5">3 days ago</p>
              </div>
              <ChevronRight size={14} className="text-text-muted shrink-0" />
            </div>
          </div>
        </section>

        <div className="border-t border-border my-8" />

        {/* ── Documents section ───────────────────────────── */}
        <section>
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="font-mono text-xs uppercase tracking-wider text-text-muted">
              Strategy Documents
            </h2>
          </div>
          <p className="text-text-muted text-xs mb-4">
            Claude writes and updates these as it learns.
          </p>

          <div className="grid grid-cols-3 gap-4">
            {config.documents.map((doc) => (
              <div
                key={doc.id}
                className="bg-surface border border-border rounded-lg p-4 flex flex-col"
              >
                <div className="flex items-start gap-2 mb-2">
                  <FileText size={14} className="text-text-muted shrink-0 mt-0.5" />
                  <p className="font-mono text-sm font-medium text-text-primary leading-snug">
                    {doc.title}
                  </p>
                </div>
                <p className="text-xs text-text-muted leading-relaxed flex-1">{doc.description}</p>
                <button
                  onClick={() => togglePanel("documents")}
                  className="mt-3 text-xs font-mono text-text-muted hover:text-accent-green transition-colors self-start"
                >
                  View →
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Panels ──────────────────────────────────────── */}
      <DashboardPanel
        open={activePanel === "dashboard"}
        onClose={() => setActivePanel(null)}
        state={state}
        onStateRefresh={fetchState}
      />
      <ActivityPanel
        open={activePanel === "activity"}
        onClose={() => setActivePanel(null)}
      />
      <DocumentsPanel
        open={activePanel === "documents"}
        onClose={() => setActivePanel(null)}
        strategy={strategyId}
      />
      <StrategySettingsPanel
        open={activePanel === "settings"}
        onClose={() => setActivePanel(null)}
        state={state}
        onStateRefresh={fetchState}
      />
    </>
  )
}
