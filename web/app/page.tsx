"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { TrendingUp, ArrowUp, ArrowRight, ShieldCheck, ChevronLeft, Zap, Wrench } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { AppState, COMING_SOON_STRATEGIES } from "@/lib/types"
import { StrategySettingsPanel } from "@/components/StrategySettingsPanel"
import { MarkdownRenderer } from "@/components/MarkdownRenderer"

function formatINR(n: number): string {
  const abs = Math.abs(n)
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(abs)
  return (n < 0 ? "-" : "") + "\u20B9" + formatted
}

// ── Chat types ──────────────────────────────────────────────────────────────

interface ToolCallItem {
  tool: string
  summary: string
}

interface PermissionRequestItem {
  id: string
  tool: string
  inputs: Record<string, unknown>
  status: "pending" | "accepted" | "rejected"
}

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCallItem[]
  permissionRequest?: PermissionRequestItem
}

function formatPermissionDescription(tool: string, inputs: Record<string, unknown>): string {
  if (tool === "write_memory" && inputs.filename === "STRATEGY.md") {
    return "Update STRATEGY.md"
  }
  if (tool === "write_schedule") {
    const cron = inputs.cron ?? ""
    const reason = inputs.reason ?? ""
    const prompt = inputs.prompt ?? ""
    return `Create schedule: ${reason}\nCron: ${cron}${prompt ? `\nPrompt: ${String(prompt).slice(0, 200)}${String(prompt).length > 200 ? "..." : ""}` : ""}`
  }
  if (tool === "write_trigger" && inputs.mode === "hard") {
    const symbol = inputs.symbol ?? ""
    const type = inputs.type ?? ""
    const action = inputs.action ?? ""
    return `Hard trigger: ${type}${symbol ? ` on ${symbol}` : ""}${action ? ` → ${action}` : ""}`
  }
  return `${tool}(${JSON.stringify(inputs).slice(0, 100)})`
}

function PermissionCard({
  request,
  onRespond,
}: {
  request: PermissionRequestItem
  onRespond: (id: string, approved: boolean) => void
}) {
  const description = formatPermissionDescription(request.tool, request.inputs)
  const isPending = request.status === "pending"
  return (
    <div className="flex justify-start">
      <div className="bg-surface border border-accent-amber/40 rounded-xl px-4 py-3 max-w-lg w-full">
        <div className="flex items-center gap-1.5 mb-2">
          <ShieldCheck size={12} className="text-accent-amber" />
          <span className="text-[11px] font-medium text-accent-amber">Permission Required</span>
        </div>
        <p className="text-xs font-mono text-text-muted mb-1">{request.tool}</p>
        <p className="text-sm text-text-primary whitespace-pre-wrap mb-3 leading-relaxed">{description}</p>
        {request.tool === "write_memory" && request.inputs.content != null && (
          <details className="mb-3">
            <summary className="text-xs text-text-muted cursor-pointer hover:text-text-primary">
              Show content
            </summary>
            <pre className="mt-2 text-xs text-text-muted bg-background rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
              {String(request.inputs.content as string)}
            </pre>
          </details>
        )}
        {isPending ? (
          <div className="flex gap-2">
            <button
              onClick={() => onRespond(request.id, true)}
              className="px-3 py-1.5 text-xs font-medium bg-accent-green/20 text-accent-green border border-accent-green/30 rounded-lg hover:bg-accent-green/30 transition-colors"
            >
              Accept
            </button>
            <button
              onClick={() => onRespond(request.id, false)}
              className="px-3 py-1.5 text-xs font-medium bg-accent-red/20 text-accent-red border border-accent-red/30 rounded-lg hover:bg-accent-red/30 transition-colors"
            >
              Reject
            </button>
          </div>
        ) : (
          <span className={`text-xs font-medium ${request.status === "accepted" ? "text-accent-green" : "text-accent-red"}`}>
            {request.status === "accepted" ? "Accepted" : "Rejected"}
          </span>
        )}
      </div>
    </div>
  )
}

function getWsBase(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
  return apiUrl.replace(/^http/, "ws")
}

const PORTFOLIO_SUGGESTIONS = [
  "Help me set up my trading strategy",
  "How is my portfolio performing?",
  "Review this week's trades",
]

// ── Portfolio Chat Area ─────────────────────────────────────────────────────

function PortfolioChatArea({
  authFetch,
  threadId,
}: {
  authFetch: ReturnType<typeof useAuth>["authFetch"]
  threadId: string
}) {
  const router = useRouter()
  const { user } = useAuth()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState<{ content: string; toolCalls: ToolCallItem[] } | null>(null)
  const [input, setInput] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const [isThinking, setIsThinking] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const reconnectDelayRef = useRef(1000)
  const mountedRef = useRef(true)
  const userRef = useRef(user)
  const genRef = useRef(0)
  const streamingRef = useRef<{ content: string; toolCalls: ToolCallItem[] } | null>(null)

  useEffect(() => { userRef.current = user }, [user])

  // Reset chat state when threadId changes
  useEffect(() => {
    setMessages([])
    setStreaming(null)
    setInput("")
    setIsConnected(false)
    setIsThinking(false)
    reconnectDelayRef.current = 1000
  }, [threadId])

  // Load history
  useEffect(() => {
    if (!threadId) return
    let cancelled = false
    async function load() {
      try {
        const res = await authFetch(`/api/threads/portfolio/${threadId}/messages`)
        if (cancelled) return
        if (res.status === 404) {
          router.replace("/")
          return
        }
        if (!res.ok) return
        const data = await res.json()
        const loaded: ChatMessage[] = data.messages.map(
          (m: { role: string; content: string }, i: number) => ({
            id: `loaded-${i}`,
            role: m.role as "user" | "assistant",
            content: m.content,
          })
        )
        setMessages(loaded)
      } catch { /* silent */ }
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId])

  // WebSocket connection
  const connect = useCallback(async () => {
    if (!threadId) return
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current)
      reconnectRef.current = null
    }

    const myGen = ++genRef.current
    wsRef.current?.close()

    const token = userRef.current ? await userRef.current.getIdToken() : null
    const wsBase = getWsBase()
    const wsUrl = `${wsBase}/ws/threads/portfolio/${threadId}${token ? `?token=${encodeURIComponent(token)}` : ""}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      reconnectDelayRef.current = 1000

      const pending = sessionStorage.getItem(`thread-init-${threadId}`)
      if (pending) {
        sessionStorage.removeItem(`thread-init-${threadId}`)
        setTimeout(() => {
          const content = pending.trim()
          if (!content) return
          setMessages((prev) => [...prev, { id: `msg-init-${Date.now()}`, role: "user", content }])
          setIsThinking(true)
          setStreaming({ content: "", toolCalls: [] })
          ws.send(JSON.stringify({ content }))
        }, 50)
      }
    }

    ws.onclose = () => {
      if (genRef.current !== myGen) return
      setIsConnected(false)
      setIsThinking(false)
      if (!mountedRef.current) return
      const delay = reconnectDelayRef.current
      reconnectDelayRef.current = Math.min(delay * 2, 30000)
      reconnectRef.current = setTimeout(() => connect(), delay)
    }

    ws.onerror = () => { /* onclose handles reconnect */ }

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)
        if (event.type === "token") {
          const updated = {
            content: (streamingRef.current?.content ?? "") + event.content,
            toolCalls: streamingRef.current?.toolCalls ?? [],
          }
          streamingRef.current = updated
          setStreaming(updated)
        } else if (event.type === "tool_call") {
          const updated = {
            content: streamingRef.current?.content ?? "",
            toolCalls: [...(streamingRef.current?.toolCalls ?? []), { tool: event.tool, summary: event.summary ?? "" }],
          }
          streamingRef.current = updated
          setStreaming(updated)
        } else if (event.type === "permission_request") {
          // Flush any accumulated streaming content first
          const current = streamingRef.current
          if (current && (current.content || current.toolCalls.length > 0)) {
            const id = `msg-${Date.now()}`
            setMessages((msgs) => [...msgs, { id, role: "assistant", content: current.content, toolCalls: current.toolCalls }])
          }
          streamingRef.current = { content: "", toolCalls: [] }
          setStreaming(null)
          setMessages((msgs) => [...msgs, {
            id: `perm-${event.id}`,
            role: "assistant",
            content: "",
            permissionRequest: { id: event.id, tool: event.tool, inputs: event.inputs, status: "pending" },
          }])
        } else if (event.type === "done") {
          const current = streamingRef.current
          streamingRef.current = null
          setStreaming(null)
          setIsThinking(false)
          if (current && (current.content || current.toolCalls.length > 0)) {
            const id = `msg-${Date.now()}`
            setMessages((msgs) => [
              ...msgs,
              { id, role: "assistant", content: current.content, toolCalls: current.toolCalls },
            ])
          }
          // Notify sidebar to refresh strategies (in case register_strategy was called)
          window.dispatchEvent(new CustomEvent("strategies-updated"))
        } else if (event.type === "error") {
          setStreaming(null)
          setIsThinking(false)
        }
      } catch { /* ignore parse errors */ }
    }
  }, [threadId])

  // Connect/disconnect
  useEffect(() => {
    if (!threadId) return
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      genRef.current++
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [connect, threadId])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, streaming])

  // Respond to permission request
  const respondToPermission = useCallback((requestId: string, approved: boolean) => {
    wsRef.current?.send(JSON.stringify({ type: "permission_response", id: requestId, approved }))
    setMessages((msgs) =>
      msgs.map((m) =>
        m.permissionRequest?.id === requestId
          ? { ...m, permissionRequest: { ...m.permissionRequest, status: approved ? "accepted" : "rejected" } }
          : m
      )
    )
    if (approved) {
      setIsThinking(true)
      setStreaming({ content: "", toolCalls: [] })
    }
  }, [])

  // Send message
  const sendMessage = useCallback(() => {
    const content = input.trim()
    if (!content || !isConnected || isThinking) return
    const id = `msg-${Date.now()}`
    setMessages((prev) => [...prev, { id, role: "user", content }])
    setInput("")
    setIsThinking(true)
    setStreaming({ content: "", toolCalls: [] })
    wsRef.current?.send(JSON.stringify({ content }))
  }, [input, isConnected, isThinking])

  return (
    <div className="flex flex-col h-full">
      {/* Connection bar */}
      <div className="px-6 py-2 border-b border-border/40 flex items-center gap-2 shrink-0">
        <Link
          href="/"
          className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary transition-colors shrink-0"
        >
          <ChevronLeft size={13} />
          Portfolio
        </Link>
        <span className="flex-1" />
        {isConnected ? (
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green shrink-0" title="Connected" />
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-text-muted shrink-0 animate-pulse" title="Reconnecting..." />
        )}
        <span className="text-[11px] text-text-muted font-mono">
          {isConnected ? "Connected" : "Reconnecting..."}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-text-muted text-sm">New thread</p>
            <p className="text-text-muted text-xs max-w-sm leading-relaxed">
              Ask about your portfolio, strategy setup, or anything on your mind.
            </p>
          </div>
        )}

        <div className="max-w-2xl mx-auto space-y-5">
          {messages.map((msg) =>
            msg.role === "user" ? (
              <div key={msg.id} className="flex justify-end">
                <div className="bg-surface border border-border rounded-xl px-4 py-3 max-w-lg text-left">
                  <p className="text-[11px] text-text-muted mb-1">You</p>
                  <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ) : msg.permissionRequest ? (
              <PermissionCard
                key={msg.id}
                request={msg.permissionRequest}
                onRespond={respondToPermission}
              />
            ) : (
              <div key={msg.id} className="flex justify-start">
                <div className="border-l-2 border-accent-green pl-4 max-w-xl text-left">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Zap size={11} className="text-accent-green" />
                    <p className="text-[11px] text-accent-green">Claude</p>
                  </div>
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {msg.toolCalls.map((tc, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 bg-surface border border-border rounded px-2 py-0.5 text-[11px] font-mono text-text-muted"
                        >
                          <Wrench size={10} className="shrink-0" />
                          {tc.tool}
                          {tc.summary ? ` · ${tc.summary}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {msg.content && <MarkdownRenderer content={msg.content} />}
                </div>
              </div>
            )
          )}

          {streaming && (
            <div className="flex justify-start">
              <div className="border-l-2 border-accent-green pl-4 max-w-xl text-left">
                <div className="flex items-center gap-1.5 mb-1">
                  <Zap size={11} className="text-accent-green" />
                  <p className="text-[11px] text-accent-green">Claude</p>
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
                </div>
                {streaming.toolCalls.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {streaming.toolCalls.map((tc, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 bg-surface border border-border rounded px-2 py-0.5 text-[11px] font-mono text-text-muted"
                      >
                        <Wrench size={10} className="shrink-0" />
                        {tc.tool}
                        {tc.summary ? ` · ${tc.summary}` : ""}
                      </span>
                    ))}
                  </div>
                )}
                {streaming.content ? (
                  <MarkdownRenderer content={streaming.content} />
                ) : (
                  <p className="text-sm text-text-muted leading-relaxed">...</p>
                )}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="px-6 pb-6 shrink-0">
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage() }}
          className="max-w-2xl mx-auto bg-surface rounded-2xl border border-border overflow-hidden"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              isThinking
                ? "Claude is thinking..."
                : isConnected
                ? "Ask about your portfolio or set up a strategy..."
                : "Connecting..."
            }
            disabled={!isConnected || isThinking}
            className="w-full bg-transparent px-4 pt-4 pb-3 text-sm placeholder:text-text-muted focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-between px-3 pb-3">
            <span className="text-xs text-text-muted font-mono">Portfolio</span>
            <button
              type="submit"
              disabled={!isConnected || isThinking || !input.trim()}
              className="w-7 h-7 rounded-lg bg-text-primary/10 flex items-center justify-center hover:bg-text-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowUp size={14} className="text-text-primary" />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Portfolio Page ───────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const { authFetch } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const threadId = searchParams.get("t")
  const [state, setState] = useState<AppState | null>(null)
  const [maxPositions, setMaxPositions] = useState<number | null>(null)
  const [strategies, setStrategies] = useState<{id: string; name: string; status: string}[]>([])
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

  const fetchStrategies = useCallback(async () => {
    try {
      const res = await authFetch("/api/strategies")
      if (!res.ok) return
      setStrategies(await res.json())
    } catch { /* silent */ }
  }, [authFetch])

  useEffect(() => {
    fetchState()
    fetchSettings()
    fetchStrategies()
    const interval = setInterval(fetchState, 10000)
    return () => clearInterval(interval)
  }, [fetchState, fetchSettings, fetchStrategies])

  const startPortfolioChat = useCallback(async (message?: string) => {
    setChatLoading(true)
    try {
      const res = await authFetch("/api/threads/portfolio", { method: "POST" })
      if (!res.ok) return
      const thread = await res.json()
      if (message?.trim()) {
        sessionStorage.setItem(`thread-init-${thread.id}`, message.trim())
      }
      router.push(`/?t=${thread.id}`)
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

  // ── Chat mode: render PortfolioChatArea when ?t= is present ──
  if (threadId) {
    return <PortfolioChatArea authFetch={authFetch} threadId={threadId} />
  }

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

        {/* ── Active strategies ─────────────────────────────────── */}
        {strategies.filter((s) => s.status === "active").length > 0 && (
          <div className="w-full">
            <p className="text-xs text-text-muted uppercase tracking-wider mb-3">Active</p>
            <div className="flex flex-col gap-3">
              {strategies.filter((s) => s.status === "active").map((strategy) => (
                <Link
                  key={strategy.id}
                  href={`/s/${strategy.id}`}
                  className="block bg-surface rounded-xl border border-border p-5 hover:border-border/80 transition-colors group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <TrendingUp size={14} className="text-text-muted" />
                      <span className="text-xs text-text-muted">{strategy.name}</span>
                      {state?.market_open && (
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                      )}
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
              ))}
            </div>
          </div>
        )}

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
              startPortfolioChat(chatInput || undefined)
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
              <span className="text-xs text-text-muted">Portfolio</span>
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
        onStateRefresh={() => { fetchState(); fetchSettings() }}
      />
    </div>
  )
}
