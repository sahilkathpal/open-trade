"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
  BarChart2,
  Bot,
  FileText,
  ShieldCheck,
  AlertCircle,
  TrendingUp,
  ArrowUp,
  ChevronLeft,
  RefreshCw,
  Zap,
  Wrench,
  X,
} from "lucide-react"
import { useAuth } from "@/lib/auth"
import { AppState, StrategyConfig, STRATEGY_CONFIGS } from "@/lib/types"
import { RiskGauge } from "@/components/RiskGauge"
import { ProposalCard } from "@/components/ProposalCard"
import { PositionCard } from "@/components/PositionCard"
import { TriggerCard } from "@/components/TriggerCard"
import { TokenUsageCard } from "@/components/TokenUsageCard"
import { MISCountdown } from "@/components/MISCountdown"
import { ActivityFeed } from "@/components/ActivityFeed"
import { MarkdownRenderer } from "@/components/MarkdownRenderer"
import { StrategySettingsPanel } from "@/components/StrategySettingsPanel"

type PanelSection = "trades" | "agent" | "documents" | "guardrails"

function formatINR(n: number): string {
  const abs = Math.abs(n)
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(abs)
  return (n < 0 ? "-" : "") + "\u20B9" + formatted
}

// ── Chat types ─────────────────────────────────────────────────────────────────

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

function getWsBase(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
  return apiUrl.replace(/^http/, "ws")
}

// ── Chat message components ────────────────────────────────────────────────────

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="bg-surface border border-border rounded-xl px-4 py-3 max-w-lg text-left">
        <p className="text-[11px] text-text-muted mb-1">You</p>
        <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  )
}

function AssistantMessage({
  content,
  toolCalls,
  isStreaming,
}: {
  content: string
  toolCalls?: ToolCallItem[]
  isStreaming?: boolean
}) {
  return (
    <div className="flex justify-start">
      <div className="border-l-2 border-accent-green pl-4 max-w-xl text-left">
        <div className="flex items-center gap-1.5 mb-1">
          <Zap size={11} className="text-accent-green" />
          <p className="text-[11px] text-accent-green">Claude</p>
          {isStreaming && (
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
          )}
        </div>
        {toolCalls && toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {toolCalls.map((tc, i) => (
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
        {content && <MarkdownRenderer content={content} />}
        {isStreaming && !content && (
          <p className="text-sm text-text-muted leading-relaxed">...</p>
        )}
      </div>
    </div>
  )
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
            <pre className="mt-2 text-xs text-text-muted bg-bg rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
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
          <span
            className={`text-xs font-medium ${
              request.status === "accepted" ? "text-accent-green" : "text-accent-red"
            }`}
          >
            {request.status === "accepted" ? "Accepted" : "Rejected"}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Chat ──────────────────────────────────────────────────────────────────────

const CHAT_SUGGESTIONS = [
  "Help me set up my trading strategy",
  "Review this week's trades and learnings",
  "Suggest improvements to my strategy",
]

function ChatArea({
  config,
  state,
  authFetch,
  strategyId,
  threadId,
}: {
  config: StrategyConfig
  state: AppState | null
  authFetch: ReturnType<typeof useAuth>["authFetch"]
  strategyId: string
  threadId: string | null
}) {
  const router = useRouter()
  const { user } = useAuth()

  const todayPnl = state?.agent_pnl?.total ?? 0
  const positionCount = state?.positions?.length ?? 0

  // Splash mode
  const [chatInput, setChatInput] = useState("")
  const [chatLoading, setChatLoading] = useState(false)

  // Chat mode
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

  // Keep userRef current without rebuilding connect on every auth re-render
  useEffect(() => { userRef.current = user }, [user])
  // streamingRef is updated directly in onmessage handlers (not via useEffect)
  // so the done handler always reads the latest value without waiting for a render cycle.

  // Create thread and navigate (optionally store a pending first message)
  const startChat = useCallback(async (message?: string) => {
    if (chatLoading) return
    setChatLoading(true)
    try {
      const res = await authFetch(`/api/threads/${strategyId}`, { method: "POST" })
      if (!res.ok) return
      const thread = await res.json()
      if (message?.trim()) {
        sessionStorage.setItem(`thread-init-${thread.id}`, message.trim())
      }
      router.push(`/s/${strategyId}?t=${thread.id}`)
    } catch { /* silent */ }
    finally { setChatLoading(false) }
  }, [authFetch, strategyId, router, chatLoading])

  // Reset chat state when threadId changes
  useEffect(() => {
    setMessages([])
    setStreaming(null)
    setInput("")
    setIsConnected(false)
    setIsThinking(false)
    reconnectDelayRef.current = 1000
  }, [threadId])

  // Load history when threadId is set
  useEffect(() => {
    if (!threadId) return
    let cancelled = false
    async function load() {
      try {
        const res = await authFetch(`/api/threads/${strategyId}/${threadId}/messages`)
        if (cancelled) return
        if (res.status === 404) {
          router.replace(`/s/${strategyId}`)
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
  }, [strategyId, threadId])  // authFetch intentionally omitted — reloading history on token refresh would overwrite live messages

  // WebSocket connection
  const connect = useCallback(async () => {
    if (!threadId) return
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current)
      reconnectRef.current = null
    }

    // Bump generation: any onclose from a previous socket will see a stale gen and skip reconnect
    const myGen = ++genRef.current
    wsRef.current?.close()

    const token = userRef.current ? await userRef.current.getIdToken() : null
    const wsBase = getWsBase()
    const wsUrl = `${wsBase}/ws/threads/${strategyId}/${threadId}${token ? `?token=${encodeURIComponent(token)}` : ""}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      reconnectDelayRef.current = 1000

      // Send pending initial message if any
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
      // If our generation has been superseded, this was an intentional close — don't reconnect
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
          // Flush any accumulated streaming content as a message first
          const current = streamingRef.current
          if (current && (current.content || current.toolCalls.length > 0)) {
            const id = `msg-${Date.now()}`
            setMessages((msgs) => [
              ...msgs,
              { id, role: "assistant", content: current.content, toolCalls: current.toolCalls },
            ])
          }
          streamingRef.current = { content: "", toolCalls: [] }
          setStreaming(null)
          // Add permission request as an inline message item
          const permMsg: ChatMessage = {
            id: `perm-${event.id}`,
            role: "assistant",
            content: "",
            permissionRequest: {
              id: event.id,
              tool: event.tool,
              inputs: event.inputs,
              status: "pending",
            },
          }
          setMessages((msgs) => [...msgs, permMsg])
        } else if (event.type === "done") {
          // Read from ref — always has the latest tokens (direct write, no render lag).
          // Never call setMessages inside a setStreaming updater — React Strict Mode
          // invokes updaters twice in dev, causing the message to be appended twice.
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
        } else if (event.type === "error") {
          setStreaming(null)
          setIsThinking(false)
        }
      } catch { /* ignore parse errors */ }
    }
  }, [strategyId, threadId])  // user removed — accessed via userRef to avoid rebuild on token refresh

  // Connect/disconnect based on threadId
  useEffect(() => {
    if (!threadId) {
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
      wsRef.current = null
      return
    }
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      genRef.current++  // invalidate current connection so its onclose doesn't reconnect
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [connect, threadId])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, streaming])

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

  // Respond to a permission request
  const respondToPermission = useCallback((requestId: string, approved: boolean) => {
    wsRef.current?.send(JSON.stringify({
      type: "permission_response",
      id: requestId,
      approved,
    }))
    // Update the permission card status
    setMessages((msgs) =>
      msgs.map((m) =>
        m.permissionRequest?.id === requestId
          ? {
              ...m,
              permissionRequest: {
                ...m.permissionRequest,
                status: approved ? "accepted" as const : "rejected" as const,
              },
            }
          : m
      )
    )
    // Resume streaming state since the agent will continue
    setStreaming({ content: "", toolCalls: [] })
  }, [])

  // ── SPLASH MODE ────────────────────────────────────────────────────────────
  if (!threadId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center px-8 pb-8">
          <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center mb-6 border border-border">
            <TrendingUp size={26} className="text-text-primary" />
          </div>

          <h1 className="text-[28px] font-semibold text-text-primary mb-2 text-center">
            {config.name}
          </h1>

          {state && (
            <div className="flex items-center gap-3 mb-8 text-sm text-text-muted">
              <span className={todayPnl >= 0 ? "text-accent-green" : "text-accent-red"}>
                {formatINR(todayPnl)} today
              </span>
              <span>·</span>
              <span>{positionCount} positions</span>
              {state.market_open && (
                <>
                  <span>·</span>
                  <span className="text-accent-green">Market open</span>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 w-full max-w-2xl">
            {CHAT_SUGGESTIONS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => startChat(prompt)}
                disabled={chatLoading}
                className="bg-surface rounded-xl p-4 text-left border border-border hover:border-border/80 transition-colors text-xs text-text-muted leading-relaxed disabled:opacity-50 disabled:cursor-wait"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 pb-6 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (chatInput.trim()) startChat(chatInput)
              else startChat()
            }}
            className="max-w-2xl mx-auto bg-surface rounded-2xl border border-border overflow-hidden"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask your agent anything..."
              disabled={chatLoading}
              className="w-full bg-transparent px-4 pt-4 pb-3 text-sm placeholder:text-text-muted focus:outline-none disabled:opacity-50 disabled:cursor-wait"
            />
            <div className="flex items-center justify-between px-3 pb-3">
              <span className="text-xs text-text-muted font-mono">{config.name}</span>
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
    )
  }

  // ── CHAT MODE ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Connection bar */}
      <div className="px-6 py-2 border-b border-border/40 flex items-center gap-2 shrink-0">
        {isConnected ? (
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green shrink-0" title="Connected" />
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-text-muted shrink-0 animate-pulse" title="Reconnecting..." />
        )}
        <span className="text-[11px] text-text-muted font-mono flex-1 truncate">
          {isConnected ? "Connected" : "Reconnecting..."}
        </span>
        <button
          onClick={() => router.push(`/s/${strategyId}`)}
          className="text-[11px] text-text-muted hover:text-text-primary transition-colors shrink-0"
        >
          ← New chat
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-text-muted text-sm">New thread</p>
            <p className="text-text-muted text-xs max-w-sm leading-relaxed">
              Ask about your P&L, market conditions, strategy, or anything on your mind.
            </p>
          </div>
        )}

        <div className="max-w-2xl mx-auto space-y-5">
          {messages.map((msg) =>
            msg.permissionRequest ? (
              <PermissionCard
                key={msg.id}
                request={msg.permissionRequest}
                onRespond={respondToPermission}
              />
            ) : msg.role === "user" ? (
              <UserMessage key={msg.id} content={msg.content} />
            ) : (
              <AssistantMessage key={msg.id} content={msg.content} toolCalls={msg.toolCalls} />
            )
          )}

          {streaming && (
            <AssistantMessage
              content={streaming.content}
              toolCalls={streaming.toolCalls}
              isStreaming
            />
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
                ? "Ask your agent anything..."
                : "Connecting..."
            }
            disabled={!isConnected || isThinking}
            className="w-full bg-transparent px-4 pt-4 pb-3 text-sm placeholder:text-text-muted focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-between px-3 pb-3">
            <span className="text-xs text-text-muted font-mono">{config.name}</span>
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

// ── Trades panel content ───────────────────────────────────────────────────────

function TradesContent({
  state,
  fetchState,
}: {
  state: AppState | null
  fetchState: () => void
}) {
  if (!state) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted text-sm">
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

  const pnlPct = seedCapital > 0 ? (agentPnl.total / seedCapital) * 100 : 0

  return (
    <div className="px-4 py-4 space-y-4">
      {/* 2-column stat summary — fits panel width */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface rounded-lg border border-border p-3">
          <div className="text-[11px] text-text-muted uppercase tracking-wider mb-1.5">P&L Today</div>
          <div className={`font-mono text-lg leading-none ${agentPnl.total >= 0 ? "text-accent-green" : "text-accent-red"}`}>
            {formatINR(agentPnl.total)}
          </div>
          <div className="text-[11px] text-text-muted font-mono mt-1">
            {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}% · {formatINR(agentPnl.realized)} realized
          </div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-3">
          <div className="text-[11px] text-text-muted uppercase tracking-wider mb-1.5">Capital</div>
          <div className="font-mono text-lg leading-none text-text-primary">
            {formatINR(seedCapital)}
          </div>
          <div className="text-[11px] text-text-muted font-mono mt-1">
            {formatINR(deployedNotional)} deployed
          </div>
        </div>
      </div>
      <RiskGauge dayPnl={agentPnl.total} limit={lossLimit} />

      {Object.keys(state.pending_approvals).length > 0 && (
        <div className="space-y-2">
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

      <div>
        <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
          Open Positions ({state.positions.length})
        </h2>
        {state.positions.length === 0 ? (
          <div className="bg-surface rounded-lg border border-border p-4 text-center text-text-muted text-sm">
            No open positions
          </div>
        ) : (
          <div className="space-y-2">
            {state.positions.map((p) => <PositionCard key={p.symbol} position={p} />)}
          </div>
        )}
      </div>

    </div>
  )
}

// ── Agent panel content ────────────────────────────────────────────────────────

const JOB_LABELS: Record<string, string> = {
  premarket: "Pre-market screening",
  execution: "Execution planning",
  heartbeat: "Heartbeat (every 1 min)",
  clear_proposals: "Clear proposals",
  eod: "EOD report",
}

function AgentContent({
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
      <div className="flex items-center justify-center py-12 text-text-muted text-sm">
        Loading...
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {state.token_usage && (
        <TokenUsageCard usage={state.token_usage} />
      )}

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

      {state.triggers.length > 0 && (
        <div>
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
            Monitoring Triggers ({state.triggers.length})
          </h2>
          <div className="space-y-2">
            {state.triggers.map((t) => (
              <TriggerCard key={t.id} trigger={t} />
            ))}
          </div>
        </div>
      )}

      <ActivityFeed />
    </div>
  )
}

// ── Documents panel content ────────────────────────────────────────────────────

function DocumentsContent({
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
      <div className="px-4 py-8 text-center text-text-muted text-sm">
        No documents yet. Claude will create documents as it starts trading.
      </div>
    )
  }

  const selectedDoc = config.documents.find((d) => d.id === selectedDocId)

  if (selectedDoc) {
    return (
      <div>
        <div className="sticky top-0 bg-surface z-10 flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <button
            onClick={() => { setSelectedDocId(null); setContent(null) }}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronLeft size={13} />
            Docs
          </button>
          <span className="text-border text-xs">·</span>
          <span className="text-xs text-text-primary truncate">{selectedDoc.title}</span>
          <button
            onClick={() => fetchDoc(selectedDoc.file)}
            className="ml-auto p-1 text-text-muted hover:text-text-primary transition-colors shrink-0"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="px-4 py-4">
          {loading && <p className="text-text-muted text-sm">Loading...</p>}
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
    <div className="px-4 py-4">
      <p className="text-xs text-text-muted mb-4">
        Claude writes and updates these documents as it learns and trades.
      </p>
      <div className="space-y-2">
        {config.documents.map((doc) => (
          <button
            key={doc.id}
            onClick={() => setSelectedDocId(doc.id)}
            className="w-full bg-surface rounded-lg p-4 text-left border border-border hover:border-border/80 transition-colors flex items-start gap-3"
          >
            <FileText size={15} className="text-text-muted mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-text-primary mb-0.5">{doc.title}</p>
              <p className="text-xs text-text-muted leading-relaxed">{doc.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PANEL_TABS: { id: PanelSection; label: string; icon: React.ElementType }[] = [
  { id: "trades",     label: "Trades",     icon: BarChart2   },
  { id: "agent",      label: "Agent",      icon: Bot         },
  { id: "documents",  label: "Docs",       icon: FileText    },
  { id: "guardrails", label: "Guardrails", icon: ShieldCheck },
]

const GENERIC_CONFIG: Omit<StrategyConfig, "id" | "name"> = {
  live: true,
  goal: "",
  subtitle: "",
  documents: [
    { id: "strategy", title: "Strategy", file: "STRATEGY.md", description: "Strategy rules and criteria." },
    { id: "journal",  title: "Journal",  file: "JOURNAL.md",  description: "Trade log." },
    { id: "learnings", title: "Learnings", file: "LEARNINGS.md", description: "Distilled observations." },
  ],
}

export default function StrategyPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const strategyId = params.strategy as string
  const threadId = searchParams.get("t")
  const [registryName, setRegistryName] = useState<string | null>(null)

  const hardcodedConfig = STRATEGY_CONFIGS[strategyId]
  const config: StrategyConfig = hardcodedConfig ?? {
    id: strategyId,
    name: registryName ?? strategyId,
    ...GENERIC_CONFIG,
  }

  const { authFetch } = useAuth()
  const [state, setState] = useState<AppState | null>(null)
  const [catchupLoading, setCatchupLoading] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelSection, setPanelSection] = useState<PanelSection>("trades")
  const [panelWidth, setPanelWidth] = useState(360)
  const resizeDragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizeDragRef.current = { startX: e.clientX, startWidth: panelWidth }
    const onMove = (ev: MouseEvent) => {
      if (!resizeDragRef.current) return
      const delta = resizeDragRef.current.startX - ev.clientX
      setPanelWidth(Math.min(Math.max(resizeDragRef.current.startWidth + delta, 280), 720))
    }
    const onUp = () => {
      resizeDragRef.current = null
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }, [panelWidth])

  // For strategies not in STRATEGY_CONFIGS, fetch the name from the registry
  useEffect(() => {
    if (hardcodedConfig) return
    authFetch("/api/strategies")
      .then((r) => r.ok ? r.json() : [])
      .then((list: {id: string; name: string}[]) => {
        const entry = list.find((s) => s.id === strategyId)
        if (entry) setRegistryName(entry.name)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyId])

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

  const togglePanel = useCallback((section: PanelSection) => {
    if (panelOpen && panelSection === section) {
      setPanelOpen(false)
    } else {
      setPanelSection(section)
      setPanelOpen(true)
    }
  }, [panelOpen, panelSection])

  const runCatchup = useCallback(async () => {
    setCatchupLoading(true)
    try {
      await authFetch("/api/run/catchup", { method: "POST" })
    } finally {
      setCatchupLoading(false)
    }
  }, [authFetch])

  // Risk color for Guardrails button
  const dayLoss = state ? (state.agent_pnl?.total ?? 0) : 0
  const lossUsed = dayLoss < 0 ? Math.abs(dayLoss) : 0
  const lossLimit = state?.daily_loss_limit ?? 0
  const lossPct = lossLimit > 0 ? (lossUsed / lossLimit) * 100 : 0
  const riskLevel = lossPct > 80 ? "alert" : lossPct > 50 ? "caution" : "safe"

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
            onClick={() => togglePanel("guardrails")}
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
            onClick={() => togglePanel("guardrails")}
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

      {/* Header: panel toggle buttons */}
      <div className="border-b border-border shrink-0 flex items-center justify-end px-4 py-1.5 gap-1">
        {PANEL_TABS.map(({ id, label, icon: Icon }) => {
          const isActive = panelOpen && panelSection === id
          const isGuardrails = id === "guardrails"
          const guardColor = isGuardrails
            ? riskLevel === "alert"   ? "text-accent-red"
            : riskLevel === "caution" ? "text-accent-amber"
            : "text-accent-green"
            : ""
          return (
            <button
              key={id}
              onClick={() => togglePanel(id)}
              title={label}
              className={[
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                isActive
                  ? "bg-surface border border-border text-text-primary"
                  : "text-text-muted hover:text-text-primary hover:bg-surface/60",
                isGuardrails && !isActive ? guardColor : "",
              ].join(" ")}
            >
              <Icon size={13} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          )
        })}
      </div>

      {/* Main: chat + right panel */}
      <div className="flex-1 overflow-hidden flex min-h-0">

        {/* Chat — always shown, fills available width */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <ChatArea
            config={config}
            state={state}
            authFetch={authFetch}
            strategyId={strategyId}
            threadId={threadId}
          />
        </div>

        {/* Right panel */}
        {panelOpen && (
          <div
            className="shrink-0 border-l border-border flex flex-col overflow-hidden relative"
            style={{ width: panelWidth }}
          >
            {/* Drag-to-resize handle on left edge */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-white/10 active:bg-white/20 transition-colors"
              onMouseDown={handleResizeStart}
            />

            {/* Panel title bar — section label + close */}
            {(() => {
              const active = PANEL_TABS.find(t => t.id === panelSection)!
              const Icon = active.icon
              return (
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                    <Icon size={13} />
                    {active.label}
                  </div>
                  <button
                    onClick={() => setPanelOpen(false)}
                    className="text-text-muted hover:text-text-primary transition-colors"
                    title="Close panel"
                  >
                    <X size={13} />
                  </button>
                </div>
              )
            })()}

            {/* Section content */}
            <div className="flex-1 overflow-y-auto">
              {panelSection === "trades" && (
                <TradesContent state={state} fetchState={fetchState} />
              )}
              {panelSection === "agent" && (
                <AgentContent state={state} fetchState={fetchState} authFetch={authFetch} />
              )}
              {panelSection === "documents" && (
                <DocumentsContent strategy={strategyId} authFetch={authFetch} />
              )}
              {panelSection === "guardrails" && (
                <StrategySettingsPanel
                  embedded
                  state={state}
                  onStateRefresh={fetchState}
                  strategy={strategyId}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <MISCountdown positions={state?.positions ?? []} />
    </div>
  )
}
