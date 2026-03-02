"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { TrendingUp, ArrowUp, ArrowRight, ShieldCheck } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { AppState, COMING_SOON_STRATEGIES } from "@/lib/types"
import { StrategySettingsPanel } from "@/components/StrategySettingsPanel"

function formatINR(n: number): string {
  const abs = Math.abs(n)
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(abs)
  return (n < 0 ? "-" : "") + "\u20B9" + formatted
}

export default function PortfolioPage() {
  const { authFetch } = useAuth()
  const router = useRouter()
  const [state, setState] = useState<AppState | null>(null)
  const [maxPositions, setMaxPositions] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chatInput, setChatInput] = useState("")
  const [chatLoading, setChatLoading] = useState(false)

  const fetchState = useCallback(async () => {
    try {
      const res = await authFetch("/api/state")
      if (!res.ok) return
      setState(await res.json())
    } catch { /* silent */ }
  }, [authFetch])

  const fetchSettings = useCallback(async () => {
    try {
      const res = await authFetch("/api/settings")
      if (!res.ok) return
      const data = await res.json()
      setMaxPositions(data.max_open_positions ?? 2)
    } catch { /* silent */ }
  }, [authFetch])

  useEffect(() => {
    fetchState()
    fetchSettings()
    const interval = setInterval(fetchState, 10000)
    return () => clearInterval(interval)
  }, [fetchState, fetchSettings])

  const startIntradayChat = useCallback(async (message?: string) => {
    setChatLoading(true)
    try {
      const res = await authFetch("/api/threads/intraday", { method: "POST" })
      if (!res.ok) return
      const thread = await res.json()
      if (message?.trim()) {
        sessionStorage.setItem(`thread-init-${thread.id}`, message.trim())
      }
      router.push(`/s/intraday?t=${thread.id}`)
    } catch {
      // silent
    } finally {
      setChatLoading(false)
    }
  }, [authFetch, router])

  const agentPnl = state?.agent_pnl?.total ?? 0
  const positionCount = state?.positions?.length ?? 0
  const triggerCount = state?.triggers?.length ?? 0
  const seedCapital = state?.seed_capital ?? 0
  const dailyLossLimit = state?.daily_loss_limit ?? 0
  const deployedNotional = state?.positions?.reduce(
    (sum, p) => sum + p.entry_price * p.quantity, 0
  ) ?? 0
  const dailyLossUsed = agentPnl < 0 ? Math.abs(agentPnl) : 0
  const lossPct = dailyLossLimit > 0 ? (dailyLossUsed / dailyLossLimit) * 100 : 0
  const riskLevel = lossPct > 80 ? "alert" : lossPct > 50 ? "caution" : "safe"
  const riskColor = riskLevel === "alert" ? "text-accent-red" : riskLevel === "caution" ? "text-accent-amber" : "text-accent-green"
  const riskBorderColor = riskLevel === "alert" ? "border-l-accent-red" : riskLevel === "caution" ? "border-l-accent-amber" : "border-l-accent-green"
  const lossBarColor = riskLevel === "alert" ? "bg-accent-red" : riskLevel === "caution" ? "bg-accent-amber" : "bg-accent-green"
  const riskLabel = riskLevel === "alert" ? "Alert" : riskLevel === "caution" ? "Caution" : "Safe"

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex flex-col items-center px-8 py-12 max-w-2xl mx-auto w-full gap-10">

        {/* ── Portfolio header ─────────────────────────────────── */}
        <div className="w-full">
          <p className="text-xs text-text-muted uppercase tracking-wider mb-4">Portfolio</p>

          {state ? (
            <div className="flex items-baseline gap-6">
              <div>
                <span
                  className={[
                    "text-4xl font-semibold tabular-nums",
                    agentPnl >= 0 ? "text-accent-green" : "text-accent-red",
                  ].join(" ")}
                >
                  {agentPnl >= 0 ? "+" : ""}{formatINR(agentPnl)}
                </span>
                <span className="text-sm text-text-muted ml-2">today</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-text-muted">
                <span>{formatINR(deployedNotional)} deployed</span>
                <span>·</span>
                <span>{positionCount} position{positionCount !== 1 ? "s" : ""}</span>
                {state.market_open && (
                  <>
                    <span>·</span>
                    <span className="text-accent-green">Market open</span>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="h-10 w-48 bg-surface rounded-lg animate-pulse" />
          )}
        </div>

        {/* ── Risk guardrails ──────────────────────────────────── */}
        <div className="w-full">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className={state ? riskColor : "text-text-muted"} />
              <p className="text-xs text-text-muted uppercase tracking-wider">Guardrails</p>
              {state && (
                <span className={["text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-full border", riskColor,
                  riskLevel === "alert"   ? "bg-accent-red/10 border-accent-red/30" :
                  riskLevel === "caution" ? "bg-accent-amber/10 border-accent-amber/30" :
                                            "bg-accent-green/10 border-accent-green/30",
                ].join(" ")}>
                  {riskLabel}
                </span>
              )}
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              Edit
            </button>
          </div>

          <div className={[
            "bg-surface rounded-xl border-l-4 border border-border p-5 grid grid-cols-3 gap-6",
            state ? riskBorderColor : "border-l-border",
          ].join(" ")}>
            {/* Agent capital */}
            <div>
              <p className="text-xs text-text-muted mb-2">Agent capital</p>
              {state ? (
                <p className="text-xl font-semibold text-text-primary font-mono">
                  {formatINR(seedCapital)}
                </p>
              ) : (
                <div className="h-6 w-24 bg-background rounded animate-pulse" />
              )}
              <p className="text-[11px] text-text-muted mt-1.5">Max Claude can trade</p>
            </div>

            {/* Daily loss limit */}
            <div>
              <p className="text-xs text-text-muted mb-2">Daily loss limit</p>
              {state ? (
                <>
                  <p className="text-xl font-semibold text-text-primary font-mono">
                    {formatINR(dailyLossLimit)}
                  </p>
                  <div className="mt-2 h-1.5 bg-border rounded-full overflow-hidden">
                    <div
                      className={["h-full rounded-full transition-all", lossBarColor].join(" ")}
                      style={{ width: `${Math.min(100, lossPct)}%` }}
                    />
                  </div>
                  <p className={["text-[11px] mt-1.5", dailyLossUsed > 0 ? riskColor : "text-text-muted"].join(" ")}>
                    {dailyLossUsed > 0
                      ? `${formatINR(dailyLossUsed)} used · ${Math.round(lossPct)}%`
                      : "None used today"}
                  </p>
                </>
              ) : (
                <div className="h-6 w-24 bg-background rounded animate-pulse" />
              )}
            </div>

            {/* Max positions */}
            <div>
              <p className="text-xs text-text-muted mb-2">Max positions</p>
              {maxPositions !== null ? (
                <>
                  <p className="text-xl font-semibold text-text-primary font-mono">
                    {positionCount} / {maxPositions}
                  </p>
                  <div className="mt-2 h-1.5 bg-border rounded-full overflow-hidden">
                    <div
                      className={[
                        "h-full rounded-full transition-all",
                        positionCount >= maxPositions ? "bg-accent-red" : "bg-accent-green",
                      ].join(" ")}
                      style={{ width: `${Math.min(100, (positionCount / maxPositions) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-text-muted mt-1.5">
                    {maxPositions - positionCount} slot{maxPositions - positionCount !== 1 ? "s" : ""} available
                  </p>
                </>
              ) : (
                <div className="h-6 w-12 bg-background rounded animate-pulse" />
              )}
            </div>
          </div>
        </div>

        {/* ── Active strategy ──────────────────────────────────── */}
        <div className="w-full">
          <p className="text-xs text-text-muted uppercase tracking-wider mb-3">Active</p>
          <Link
            href="/s/intraday"
            className="block bg-surface rounded-xl border border-border p-5 hover:border-border/80 transition-colors group"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp size={14} className="text-text-muted" />
                  <span className="text-xs text-text-muted">Intraday Momentum</span>
                  {state?.market_open && (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                  )}
                </div>
                <p className="text-sm text-text-muted">NSE large-cap · MIS · exits by 3:10 PM</p>
              </div>
              <ArrowRight
                size={16}
                className="text-text-muted group-hover:text-text-primary group-hover:translate-x-0.5 transition-all"
              />
            </div>

            {state ? (
              <div className="flex items-center gap-5 text-xs font-mono">
                <div>
                  <span className="text-text-muted">P&L </span>
                  <span className={agentPnl >= 0 ? "text-accent-green" : "text-accent-red"}>
                    {agentPnl >= 0 ? "+" : ""}{formatINR(agentPnl)}
                  </span>
                </div>
                <div>
                  <span className="text-text-muted">Positions </span>
                  <span className="text-text-primary">{positionCount}</span>
                </div>
                <div>
                  <span className="text-text-muted">Triggers </span>
                  <span className="text-text-primary">{triggerCount}</span>
                </div>
              </div>
            ) : (
              <div className="h-4 w-64 bg-background rounded animate-pulse" />
            )}
          </Link>
        </div>

        {/* ── Coming soon strategies ───────────────────────────── */}
        <div className="w-full">
          <p className="text-xs text-text-muted uppercase tracking-wider mb-3">Coming soon</p>
          <div className="flex items-stretch gap-3">
            {COMING_SOON_STRATEGIES.map((s) => (
              <div
                key={s.id}
                className="flex-1 bg-surface rounded-xl p-4 border border-border opacity-40 cursor-not-allowed"
              >
                <p className="text-sm font-medium text-text-primary mb-1">{s.name}</p>
                <p className="text-xs text-text-muted leading-relaxed">{s.subtitle}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Chat bar ─────────────────────────────────────────── */}
        <div className="w-full">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              startIntradayChat(chatInput || undefined)
            }}
            className="bg-surface rounded-2xl border border-border overflow-hidden"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask about your portfolio or start a new chat..."
              disabled={chatLoading}
              className="w-full bg-transparent px-4 pt-4 pb-3 text-sm placeholder:text-text-muted focus:outline-none disabled:opacity-50 disabled:cursor-wait"
            />
            <div className="flex items-center justify-between px-3 pb-3">
              <span className="text-xs text-text-muted">Intraday strategy</span>
              <button
                type="submit"
                disabled={chatLoading}
                className="w-7 h-7 rounded-lg bg-text-primary/10 flex items-center justify-center hover:bg-text-primary/20 transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                <ArrowUp size={14} className="text-text-primary" />
              </button>
            </div>
          </form>
        </div>

      </div>

      <StrategySettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        state={state}
        onStateRefresh={fetchState}
      />
    </div>
  )
}
