"use client"

import { useState, useCallback, useEffect } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { LayoutDashboard, Zap, MessageSquare, ArrowUp } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { AppState, STRATEGY_CONFIGS } from "@/lib/types"
import { DashboardPanel } from "@/components/DashboardPanel"
import { ActivityPanel } from "@/components/ActivityPanel"

type ActivePanel = "dashboard" | "activity" | null

export default function ThreadPage() {
  const params = useParams()
  const strategyId = params.strategy as string
  const threadId = params.threadId as string
  const config = STRATEGY_CONFIGS[strategyId]

  const { authFetch } = useAuth()
  const [state, setState] = useState<AppState | null>(null)
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

  const togglePanel = (panel: Exclude<ActivePanel, null>) => {
    setActivePanel((prev) => (prev === panel ? null : panel))
  }

  const strategyName = config?.name ?? strategyId
  const strategyHref = `/s/${strategyId}`

  const threadTitle =
    threadId === "new"
      ? "New Thread"
      : threadId
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")

  const actionBtnBase =
    "text-xs font-mono px-3 py-1.5 rounded-md border border-border text-text-muted hover:text-text-primary hover:border-border/80 transition-colors flex items-center gap-1.5"
  const actionBtnActive =
    "text-xs font-mono px-3 py-1.5 rounded-md border border-border bg-surface text-text-primary flex items-center gap-1.5"

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-sm font-mono">
          <Link
            href={strategyHref}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            {strategyName}
          </Link>
          <span className="text-text-muted">/</span>
          <span className="text-text-primary">{threadTitle}</span>
        </nav>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => togglePanel("activity")}
            className={activePanel === "activity" ? actionBtnActive : actionBtnBase}
          >
            <Zap size={13} />
            Activity
          </button>
          <button
            onClick={() => togglePanel("dashboard")}
            className={activePanel === "dashboard" ? actionBtnActive : actionBtnBase}
          >
            <LayoutDashboard size={13} />
            Dashboard
          </button>
        </div>
      </div>

      {/* ── Coming soon banner ────────────────────────────── */}
      <div className="bg-surface border-b border-border px-6 py-3 flex items-center gap-3 shrink-0">
        <Zap size={13} className="text-accent-amber shrink-0" />
        <p className="text-xs text-text-muted">
          <span className="text-text-primary">Direct chat with your agent is launching soon.</span>
          {" "}Use Telegram to send messages to your agent in the meantime — approve proposals,
          ask questions, or trigger analysis.
        </p>
        <Link
          href="/settings"
          className="text-xs font-mono text-text-muted hover:text-text-primary transition-colors shrink-0 underline underline-offset-2"
        >
          Connect Telegram →
        </Link>
      </div>

      {/* ── Messages area ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* Empty state */}
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
          <MessageSquare size={48} className="text-border" />
          <p className="text-text-muted text-sm">No messages yet</p>
          <p className="text-text-muted text-xs max-w-sm leading-relaxed">
            When chat launches, your conversations with Claude will appear here. Each thread
            captures a complete discussion — from thesis to execution.
          </p>

          {/* Demo messages — visible but faded */}
          <div className="mt-8 w-full max-w-2xl space-y-5 opacity-40 pointer-events-none select-none">

            {/* User message */}
            <div className="flex justify-end">
              <div className="bg-surface border border-border rounded-xl px-4 py-3 max-w-md text-left">
                <p className="text-[11px] text-text-muted mb-1">You</p>
                <p className="text-sm text-text-primary leading-relaxed">
                  I saw there&apos;s news about defense spending in the Middle East. Could you look
                  into which Indian defense stocks might benefit?
                </p>
              </div>
            </div>

            {/* Claude message */}
            <div className="flex justify-start">
              <div className="border-l-2 border-accent-green pl-4 max-w-lg text-left">
                <div className="flex items-center gap-1.5 mb-1">
                  <Zap size={11} className="text-accent-green" />
                  <p className="text-[11px] text-accent-green">Claude</p>
                </div>
                <p className="text-sm text-text-primary leading-relaxed">
                  Interesting angle. I checked the news — the conflict involves Iran and affects
                  Middle Eastern defense contractors primarily. For Indian defense, the relevant
                  plays would be HAL, BEL, and Bharat Forge...
                </p>
                {/* Tool call chip */}
                <div className="mt-2 inline-flex items-center bg-background rounded px-2 py-0.5">
                  <span className="text-xs font-mono text-text-muted">search_news · 3 results</span>
                </div>
              </div>
            </div>

            {/* User message 2 */}
            <div className="flex justify-end">
              <div className="bg-surface border border-border rounded-xl px-4 py-3 max-w-md text-left">
                <p className="text-[11px] text-text-muted mb-1">You</p>
                <p className="text-sm text-text-primary leading-relaxed">
                  What about Data Patterns?
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Input area ──────────────────────────────────── */}
      <div className="sticky bottom-0 bg-background border-t border-border px-6 py-4 flex items-center gap-3 shrink-0">
        <input
          type="text"
          disabled
          placeholder="Chat with your agent — coming soon"
          className="flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none cursor-not-allowed opacity-50"
        />
        <button
          disabled
          className="rounded-lg bg-surface border border-border p-2.5 text-text-muted cursor-not-allowed opacity-50"
        >
          <ArrowUp size={16} />
        </button>
      </div>

      {/* ── Panels ──────────────────────────────────────── */}
      <ActivityPanel
        open={activePanel === "activity"}
        onClose={() => setActivePanel(null)}
      />
      <DashboardPanel
        open={activePanel === "dashboard"}
        onClose={() => setActivePanel(null)}
        state={state}
        onStateRefresh={fetchState}
      />
    </div>
  )
}
