"use client"

import { useEffect, useState, useCallback, useRef } from "react"
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
  Pause,
  Play,
  BookOpen,
  GitBranch,
  MoreHorizontal,
  Tag,
  Clock,
} from "lucide-react"
import { useAuth } from "@/lib/auth"
import { AppState, StrategyConfig, StrategyProposalItem } from "@/lib/types"
import { PositionCard } from "@/components/PositionCard"
import { TriggerCard } from "@/components/TriggerCard"
import { MISCountdown } from "@/components/MISCountdown"
import { ActivityFeed } from "@/components/ActivityFeed"
import { MarkdownRenderer } from "@/components/MarkdownRenderer"
import { StrategySettingsPanel } from "@/components/StrategySettingsPanel"
import { PermissionCard, PermissionRequestItem } from "@/components/PermissionCard"
import { StrategyProposalCard, useStrategyProposalResponder } from "@/components/StrategyProposalCard"

type PanelSection = "trades" | "learnings" | "versions" | "agent" | "documents" | "guardrails"

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

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCallItem[]
  permissionRequest?: PermissionRequestItem
  strategyProposal?: StrategyProposalItem
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


// ── Chat ──────────────────────────────────────────────────────────────────────


function ChatArea({
  config,
  state,
  authFetch,
  strategyId,
  threadId,
  strategies,
  prefilledInput,
  onPrefilledConsumed,
}: {
  config: StrategyConfig
  state: AppState | null
  authFetch: ReturnType<typeof useAuth>["authFetch"]
  strategyId: string
  threadId: string | null
  strategies: { id: string; name: string }[]
  prefilledInput?: string
  onPrefilledConsumed?: () => void
}) {
  const router = useRouter()
  const { user } = useAuth()
  const respondToStrategyProposal = useStrategyProposalResponder(authFetch)

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

  // @mention autocomplete
  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionVisible, setMentionVisible] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Apply prefilled input in splash mode
  useEffect(() => {
    if (prefilledInput && !threadId) {
      setChatInput(prefilledInput)
      onPrefilledConsumed?.()
    }
  }, [prefilledInput, threadId, onPrefilledConsumed])

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
        } else if (event.type === "permission_request" || event.type === "strategy_proposal") {
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
          if (event.type === "strategy_proposal") {
            // Inline strategy proposal card
            const proposalMsg: ChatMessage = {
              id: `proposal-${event.id}`,
              role: "assistant",
              content: "",
              strategyProposal: {
                id: event.id,
                tool: event.tool,
                inputs: event.inputs,
                status: "pending",
              },
            }
            setMessages((msgs) => [...msgs, proposalMsg])
          } else {
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
          }
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

  // Respond to a strategy proposal (API call, not WS)
  const handleStrategyProposalRespond = useCallback(async (proposalId: string, approved: boolean) => {
    const ok = await respondToStrategyProposal(proposalId, approved)
    if (ok) {
      setMessages((msgs) =>
        msgs.map((m) =>
          m.strategyProposal?.id === proposalId
            ? {
                ...m,
                strategyProposal: {
                  ...m.strategyProposal!,
                  status: approved ? "accepted" as const : "rejected" as const,
                },
              }
            : m
        )
      )
      // Send the decision back to the WS so the agent can continue
      wsRef.current?.send(JSON.stringify({
        type: "permission_response",
        id: proposalId,
        approved,
      }))
      setStreaming({ content: "", toolCalls: [] })
    }
  }, [respondToStrategyProposal])

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
            msg.strategyProposal ? (
              <StrategyProposalCard
                key={msg.id}
                proposal={msg.strategyProposal}
                onRespond={handleStrategyProposalRespond}
              />
            ) : msg.permissionRequest ? (
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
      <div className="px-6 pb-6 shrink-0 relative">
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage() }}
          className="max-w-2xl mx-auto bg-surface rounded-2xl border border-border overflow-hidden"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              const val = e.target.value
              setInput(val)
              // @mention detection
              const cursor = e.target.selectionStart ?? val.length
              const before = val.slice(0, cursor)
              const match = before.match(/@([\w-]*)$/)
              if (match) {
                setMentionQuery(match[1].toLowerCase())
                setMentionVisible(true)
              } else {
                setMentionVisible(false)
              }
            }}
            onKeyDown={(e) => { if (e.key === "Escape") setMentionVisible(false) }}
            onBlur={() => setTimeout(() => setMentionVisible(false), 150)}
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
        {/* @mention dropdown */}
        {mentionVisible && strategies.length > 0 && (() => {
          const filtered = strategies.filter(s =>
            s.id.toLowerCase().includes(mentionQuery) || s.name.toLowerCase().includes(mentionQuery)
          )
          if (!filtered.length) return null
          return (
            <div className="absolute bottom-full left-6 right-6 mb-1 bg-surface border border-border rounded-xl shadow-lg overflow-hidden z-50 max-h-48 overflow-y-auto">
              {filtered.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    const cursor = inputRef.current?.selectionStart ?? input.length
                    const before = input.slice(0, cursor)
                    const after = input.slice(cursor)
                    const withoutAt = before.replace(/@[\w-]*$/, "")
                    setInput(withoutAt + "@" + s.id + " " + after)
                    setMentionVisible(false)
                    setTimeout(() => inputRef.current?.focus(), 0)
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-background/50 transition-colors flex items-center gap-3"
                >
                  <span className="text-accent-green text-sm font-mono">@{s.id}</span>
                  <span className="text-xs text-text-muted">{s.name}</span>
                </button>
              ))}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ── Trades panel content ───────────────────────────────────────────────────────

function TradesContent({
  state,
  fetchState,
  strategyId,
  strategyAllocation,
  maxRiskPct,
  onOpenGuardrails,
  authFetch,
}: {
  state: AppState | null
  fetchState: () => void
  strategyId: string
  strategyAllocation?: number
  maxRiskPct: number
  onOpenGuardrails: () => void
  authFetch: ReturnType<typeof useAuth>["authFetch"]
}) {
  const [trades, setTrades] = useState<{
    trade_id?: string
    symbol: string
    entry_price: number
    exit_price: number
    quantity: number
    realized_pnl: number
    exited_at?: string
    placed_at?: string
    product_type?: string
  }[]>([])
  const [tradesLoading, setTradesLoading] = useState(true)

  useEffect(() => {
    authFetch(`/api/strategies/${strategyId}/trades`)
      .then(r => r.json())
      .then(data => setTrades(Array.isArray(data) ? data : []))
      .catch(() => setTrades([]))
      .finally(() => setTradesLoading(false))
  }, [strategyId, authFetch])

  if (!state) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted text-sm">
        Loading...
      </div>
    )
  }

  const agentPnl = state.agent_pnl ?? { realized: 0, unrealized: 0, total: 0 }
  const deployedNotional = state.positions.reduce(
    (sum, p) => sum + p.entry_price * p.quantity,
    0
  )
  const cumulativeRealized = state.strategy_cumulative_realized?.[strategyId] ?? null

  const isAllocated = strategyAllocation != null && strategyAllocation > 0
  const pnlPct = isAllocated ? (agentPnl.total / strategyAllocation!) * 100 : null

  return (
    <div className="px-4 py-4 space-y-4">

      {/* Unallocated warning */}
      {!isAllocated && (
        <div className="rounded-lg border border-accent-amber/40 bg-accent-amber/5 px-4 py-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-accent-amber">No capital allocated</p>
            <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
              Claude will not place trades until you set an allocation for this strategy.
            </p>
          </div>
          <button
            onClick={onOpenGuardrails}
            className="shrink-0 text-[11px] font-medium text-accent-amber underline underline-offset-2 hover:opacity-80 transition-opacity mt-0.5"
          >
            Set →
          </button>
        </div>
      )}

      {/* 2-column stat summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface rounded-lg border border-border p-3">
          <div className="text-[11px] text-text-muted uppercase tracking-wider mb-1.5">P&L Today</div>
          <div className={`font-mono text-lg leading-none ${agentPnl.total >= 0 ? "text-accent-green" : "text-accent-red"}`}>
            {formatINR(agentPnl.total)}
          </div>
          <div className="text-[11px] text-text-muted font-mono mt-1">
            {pnlPct != null
              ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% · `
              : ""}
            {formatINR(agentPnl.realized)} realized
          </div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-3">
          <div className="text-[11px] text-text-muted uppercase tracking-wider mb-1.5">Allocated</div>
          {isAllocated ? (
            <>
              <div className="font-mono text-lg leading-none text-text-primary">
                {formatINR(strategyAllocation!)}
              </div>
              <div className="text-[11px] text-text-muted font-mono mt-1">
                {formatINR(deployedNotional)} deployed
              </div>
            </>
          ) : (
            <div className="font-mono text-lg leading-none text-text-muted">—</div>
          )}
        </div>
      </div>

      {/* Cumulative realized P&L for this strategy */}
      {cumulativeRealized !== null && (
        <div className="bg-surface rounded-lg border border-border p-3">
          <div className="text-[11px] text-text-muted uppercase tracking-wider mb-1.5">All-time Realized</div>
          <div className={`font-mono text-base leading-none ${cumulativeRealized >= 0 ? "text-accent-green" : "text-accent-red"}`}>
            {formatINR(cumulativeRealized)}
          </div>
          <div className="text-[11px] text-text-muted font-mono mt-1">
            since strategy started
          </div>
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

      {/* Trades journal */}
      <div>
        <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
          Trade History {!tradesLoading && trades.length > 0 && `(${trades.length})`}
        </h2>
        {tradesLoading ? (
          <div className="bg-surface rounded-lg border border-border p-4 text-center text-text-muted text-sm">Loading...</div>
        ) : trades.length === 0 ? (
          <div className="bg-surface rounded-lg border border-border p-4 text-center text-text-muted text-sm">
            No completed trades yet
          </div>
        ) : (
          <div className="bg-surface rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-mono text-text-muted font-normal">Symbol</th>
                  <th className="px-3 py-2 text-right font-mono text-text-muted font-normal">Entry</th>
                  <th className="px-3 py-2 text-right font-mono text-text-muted font-normal">Exit</th>
                  <th className="px-3 py-2 text-right font-mono text-text-muted font-normal">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={t.trade_id ?? i} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 font-mono text-text-primary">{t.symbol}</td>
                    <td className="px-3 py-2 text-right font-mono text-text-muted">₹{t.entry_price?.toFixed(0)}</td>
                    <td className="px-3 py-2 text-right font-mono text-text-muted">
                      {t.exit_price ? `₹${t.exit_price.toFixed(0)}` : "—"}
                    </td>
                    <td className={["px-3 py-2 text-right font-mono", (t.realized_pnl ?? 0) >= 0 ? "text-accent-green" : "text-accent-red"].join(" ")}>
                      {(t.realized_pnl ?? 0) >= 0 ? "+" : ""}{formatINR(t.realized_pnl ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}

// ── Agent panel content ────────────────────────────────────────────────────────

function formatLastRun(iso: string): string {
  const istOpts = { timeZone: "Asia/Kolkata" } as const
  const todayDate = new Date().toLocaleDateString("en-IN", istOpts)
  const tDate = new Date(iso).toLocaleDateString("en-IN", istOpts)
  const timeStr = new Date(iso).toLocaleTimeString("en-IN", { ...istOpts, hour: "2-digit", minute: "2-digit", hour12: false })
  if (todayDate === tDate) return timeStr
  const tomorrowDate = new Date(Date.now() + 86400000).toLocaleDateString("en-IN", istOpts)
  if (tDate === tomorrowDate) return `tomorrow · ${timeStr}`
  const dateStr = new Date(iso).toLocaleDateString("en-IN", { ...istOpts, weekday: "short" })
  return `${dateStr} · ${timeStr}`
}

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
      fetchState()
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
      <div className="bg-surface rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">
              Schedule
            </h3>
            {!state.paused && (
              <span className={[
                "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                state.autonomous
                  ? "text-accent-green border-accent-green/30 bg-accent-green/10"
                  : "text-text-muted border-border",
              ].join(" ")}>
                {state.autonomous ? "autonomous" : "manual"}
              </span>
            )}
          </div>
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
            {state.upcoming_jobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0"
              >
                <div className="flex flex-col gap-0.5">
                  <span
                    className={
                      state.paused
                        ? "font-mono text-text-muted line-through"
                        : "font-mono text-text-primary"
                    }
                  >
                    {(job.label ?? job.id).split(":")[0]}
                  </span>
                  {job.last_run && (
                    <span className="font-mono text-[10px] text-text-muted">
                      last run {formatLastRun(job.last_run)}
                    </span>
                  )}
                </div>
                <span className="text-text-muted font-mono">
                  {formatRelative(job.next_run)}
                </span>
              </div>
            ))}
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

// ── Learnings panel content ────────────────────────────────────────────────────

function LearningsContent({
  strategyDoc,
}: {
  strategyDoc: { learnings?: string } | null
}) {
  if (!strategyDoc) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted text-sm">
        Loading...
      </div>
    )
  }
  const learnings = strategyDoc.learnings?.trim()
  return (
    <div className="px-4 py-4">
      {learnings ? (
        <MarkdownRenderer content={learnings} />
      ) : (
        <div className="text-center py-12">
          <BookOpen size={24} className="text-text-muted mx-auto mb-3" />
          <p className="text-text-muted text-sm">No learnings yet</p>
          <p className="text-text-muted text-xs mt-1 max-w-xs mx-auto leading-relaxed">
            Claude writes these after reviewing trades in EOD jobs.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Versions panel content ─────────────────────────────────────────────────────

interface VersionItem {
  version_id: string
  thesis: string
  rules: string
  label: string | null
  created_at: string
  change: string
}

function VersionsContent({
  strategyId,
  authFetch,
}: {
  strategyId: string
  authFetch: ReturnType<typeof useAuth>["authFetch"]
}) {
  const [versions, setVersions] = useState<VersionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [labelInput, setLabelInput] = useState("")

  useEffect(() => {
    authFetch(`/api/strategies/${strategyId}/versions`)
      .then(r => r.json())
      .then(data => setVersions(Array.isArray(data) ? data : []))
      .catch(() => setVersions([]))
      .finally(() => setLoading(false))
  }, [strategyId, authFetch])

  const saveLabel = useCallback(async (versionId: string) => {
    try {
      await authFetch(`/api/strategies/${strategyId}/versions/${versionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: labelInput }),
      })
      setVersions(vs => vs.map(v => v.version_id === versionId ? { ...v, label: labelInput } : v))
      setEditingLabel(null)
      setLabelInput("")
    } catch { /* silent */ }
  }, [authFetch, strategyId, labelInput])

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-text-muted text-sm">Loading...</div>
  }

  if (versions.length === 0) {
    return (
      <div className="px-4 py-4 text-center">
        <GitBranch size={24} className="text-text-muted mx-auto mb-3" />
        <p className="text-text-muted text-sm">No version history yet</p>
        <p className="text-text-muted text-xs mt-1 leading-relaxed">
          Versions are saved automatically when thesis or rules are updated.
        </p>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-2">
      {versions.map(v => (
        <div key={v.version_id} className="bg-surface rounded-lg border border-border overflow-hidden">
          <div
            className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-background/30 transition-colors"
            onClick={() => setExpanded(expanded === v.version_id ? null : v.version_id)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={[
                  "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                  v.change === "thesis" ? "text-accent-green border-accent-green/30 bg-accent-green/10"
                  : v.change === "rules" ? "text-accent-amber border-accent-amber/30 bg-accent-amber/10"
                  : "text-text-muted border-border",
                ].join(" ")}>
                  {v.change}
                </span>
                {v.label && (
                  <span className="text-[11px] text-text-muted font-mono truncate">{v.label}</span>
                )}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-text-muted">
                <Clock size={10} />
                <span>{fmtDate(v.created_at)}</span>
              </div>
            </div>
            <ChevronLeft
              size={13}
              className={["text-text-muted transition-transform", expanded === v.version_id ? "-rotate-90" : "rotate-180"].join(" ")}
            />
          </div>

          {expanded === v.version_id && (
            <div className="border-t border-border px-4 py-3 space-y-3">
              {v.thesis && (
                <div>
                  <p className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-1">Thesis</p>
                  <pre className="text-[12px] text-text-primary leading-relaxed whitespace-pre-wrap font-sans">{v.thesis}</pre>
                </div>
              )}
              {v.rules && (
                <div>
                  <p className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-1">Rules</p>
                  <pre className="text-[12px] text-text-primary leading-relaxed whitespace-pre-wrap font-sans">{v.rules}</pre>
                </div>
              )}
              <div className="pt-1">
                {editingLabel === v.version_id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={labelInput}
                      onChange={e => setLabelInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveLabel(v.version_id); if (e.key === "Escape") setEditingLabel(null) }}
                      placeholder="e.g. v1.0 - original"
                      className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border/80"
                      autoFocus
                    />
                    <button
                      onClick={() => saveLabel(v.version_id)}
                      className="text-xs text-accent-green hover:opacity-80"
                    >Save</button>
                    <button
                      onClick={() => setEditingLabel(null)}
                      className="text-xs text-text-muted hover:text-text-primary"
                    >Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingLabel(v.version_id); setLabelInput(v.label ?? "") }}
                    className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
                  >
                    <Tag size={11} />
                    {v.label ? "Edit label" : "Add label"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Documents panel content ────────────────────────────────────────────────────

const FILE_TITLES: Record<string, string> = {
  "JOURNAL.md":   "Trade Journal",
  "LEARNINGS.md": "Learnings",
  "ACTIVITY.md":  "Activity Log",
  "SOUL.md":      "Soul",
  "HEARTBEAT.md": "Heartbeat",
}

function fileTitle(filename: string): string {
  return FILE_TITLES[filename] ?? filename.replace(/\.md$/i, "").replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function DocumentsContent({
  authFetch,
  strategyId,
}: {
  authFetch: ReturnType<typeof useAuth>["authFetch"]
  strategyId: string
}) {
  const [files, setFiles] = useState<{ filename: string; last_modified: string }[]>([])
  const [filesLoading, setFilesLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [contentLoading, setContentLoading] = useState(false)

  useEffect(() => {
    authFetch("/api/memory")
      .then((r) => r.json())
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setFilesLoading(false))
  }, [authFetch])

  const fetchDoc = useCallback(
    async (filename: string) => {
      setContentLoading(true)
      setContent(null)
      try {
        const res = await authFetch(`/api/memory/${filename}`)
        if (!res.ok) { setContent(""); return }
        const json = await res.json()
        setContent(json.content ?? "")
      } catch {
        setContent("")
      } finally {
        setContentLoading(false)
      }
    },
    [authFetch]
  )

  useEffect(() => {
    if (selected) fetchDoc(selected)
  }, [selected, fetchDoc])

  if (selected) {
    return (
      <div>
        <div className="sticky top-0 bg-surface z-10 flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <button
            onClick={() => { setSelected(null); setContent(null) }}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronLeft size={13} />
            Docs
          </button>
          <span className="text-border text-xs">·</span>
          <span className="text-xs text-text-primary truncate">{fileTitle(selected)}</span>
          <button
            onClick={() => fetchDoc(selected)}
            className="ml-auto p-1 text-text-muted hover:text-text-primary transition-colors shrink-0"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="px-4 py-4">
          {contentLoading && <p className="text-text-muted text-sm">Loading...</p>}
          {!contentLoading && !content && (
            <p className="text-text-muted text-sm">No content yet.</p>
          )}
          {!contentLoading && content && <MarkdownRenderer content={content} />}
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-4">
      {filesLoading ? (
        <p className="text-text-muted text-sm text-center py-8">Loading...</p>
      ) : files.length === 0 ? (
        <p className="text-text-muted text-sm text-center py-8">
          No documents yet. Claude will create these as it starts trading.
        </p>
      ) : (
        <div className="space-y-2">
          {files.filter((f) => {
            const upper = f.filename.toUpperCase()
            if (upper.startsWith("STRATEGY_")) {
              if (strategyId === "portfolio") return true
              return upper.startsWith(`STRATEGY_${strategyId.toUpperCase()}`)
            }
            return true
          }).map((f) => (
            <button
              key={f.filename}
              onClick={() => setSelected(f.filename)}
              className="w-full bg-surface rounded-lg px-4 py-3 text-left border border-border hover:border-border/80 transition-colors flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileText size={14} className="text-text-muted shrink-0" />
                <span className="text-sm text-text-primary truncate">{fileTitle(f.filename)}</span>
              </div>
              <span className="text-[10px] font-mono text-text-muted shrink-0">
                {f.filename}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PANEL_TABS: { id: PanelSection; label: string; icon: React.ElementType }[] = [
  { id: "trades",     label: "Trades",     icon: BarChart2   },
  { id: "learnings",  label: "Learnings",  icon: BookOpen    },
  { id: "versions",   label: "Versions",   icon: GitBranch   },
  { id: "agent",      label: "Agent",      icon: Bot         },
  { id: "documents",  label: "Docs",       icon: FileText    },
  { id: "guardrails", label: "Guardrails", icon: ShieldCheck },
]

const GENERIC_CONFIG: Omit<StrategyConfig, "id" | "name"> = {
  live: true,
  goal: "",
  subtitle: "",
}

export default function StrategyPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const strategyId = params.strategy as string
  const threadId = searchParams.get("t")
  const [registryName, setRegistryName] = useState<string | null>(null)
  const [strategyPaused, setStrategyPaused] = useState(false)
  const [strategies, setStrategies] = useState<{id: string; name: string}[]>([])
  const [strategyDoc, setStrategyDoc] = useState<{learnings?: string; autonomy?: string; thesis?: string; rules?: string} | null>(null)
  const [archiveMenuOpen, setArchiveMenuOpen] = useState(false)
  const [prefilledChat, setPrefilledChat] = useState("")

  const config: StrategyConfig = {
    id: strategyId,
    name: registryName ?? strategyId,
    ...GENERIC_CONFIG,
  }

  const { authFetch } = useAuth()
  const [state, setState] = useState<AppState | null>(null)
  const [catchupLoading, setCatchupLoading] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelSection, setPanelSection] = useState<PanelSection>("trades")
  const [strategyAllocation, setStrategyAllocation] = useState<number>(0)
  const [maxRiskPct, setMaxRiskPct] = useState<number>(2)
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

  // Fetch strategy registry: name (for dynamic strategies) + paused status
  useEffect(() => {
    authFetch("/api/strategies")
      .then((r) => r.ok ? r.json() : [])
      .then((list: {id: string; name: string; status: string}[]) => {
        setStrategies(list)
        const entry = list.find((s) => s.id === strategyId)
        if (entry) {
          setRegistryName(entry.name)
          setStrategyPaused(entry.status === "paused")
        }
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

  const fetchStrategySettings = useCallback(async () => {
    try {
      const res = await authFetch("/api/settings")
      if (!res.ok) return
      const data = await res.json()
      const alloc = data.strategy_allocations?.[strategyId]
      if (alloc != null) setStrategyAllocation(alloc)
      const pct = data.strategy_risk?.[strategyId]?.max_risk_per_trade_pct
      if (pct != null) setMaxRiskPct(pct)
    } catch {
      // silent
    }
  }, [authFetch, strategyId])

  const fetchStrategyDoc = useCallback(async () => {
    try {
      const res = await authFetch(`/api/strategies/${strategyId}`)
      if (!res.ok) return
      setStrategyDoc(await res.json())
    } catch { /* silent */ }
  }, [authFetch, strategyId])

  useEffect(() => {
    fetchState()
    fetchStrategySettings()
    fetchStrategyDoc()
    const interval = setInterval(fetchState, 10000)
    return () => clearInterval(interval)
  }, [fetchState, fetchStrategySettings, fetchStrategyDoc])

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

  const togglePause = useCallback(async () => {
    const newStatus = strategyPaused ? "active" : "paused"
    try {
      await authFetch(`/api/strategies/${strategyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      setStrategyPaused(!strategyPaused)
    } catch { /* silent */ }
  }, [authFetch, strategyId, strategyPaused])

  // Risk color for Guardrails button — amber when strategy has no allocation set
  const riskLevel = strategyAllocation === 0 ? "caution" : "safe"

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

      {strategyPaused && (
        <div className="flex items-center justify-between bg-accent-amber/10 border-b border-accent-amber/30 px-5 py-2.5 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <Pause size={13} className="text-accent-amber shrink-0" />
            <span className="text-accent-amber font-medium">Strategy paused</span>
            <span className="text-text-muted">— no new trades will be placed.</span>
          </div>
          <button
            onClick={togglePause}
            className="ml-4 shrink-0 text-accent-amber font-medium underline underline-offset-2 hover:opacity-80"
          >
            Resume
          </button>
        </div>
      )}

      {state && state.catchup_available && !strategyPaused && (
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
      <div className="border-b border-border shrink-0 flex items-center justify-between px-4 py-1.5">
        {/* Pause/Resume toggle */}
        <button
          onClick={togglePause}
          className={[
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
            strategyPaused
              ? "text-accent-amber hover:text-text-primary hover:bg-surface/60"
              : "text-text-muted hover:text-text-primary hover:bg-surface/60",
          ].join(" ")}
          title={strategyPaused ? "Resume strategy" : "Pause strategy"}
        >
          {strategyPaused ? <Play size={13} /> : <Pause size={13} />}
          <span className="hidden sm:inline">{strategyPaused ? "Resume" : "Pause"}</span>
        </button>

        <div className="flex items-center gap-1">
        {PANEL_TABS.map(({ id, label, icon: Icon }) => {
          const isActive = panelOpen && panelSection === id
          const isGuardrails = id === "guardrails"
          const guardColor = isGuardrails
            ? riskLevel === "caution" ? "text-accent-amber"
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
        {/* Archive menu */}
        <div className="relative ml-1">
          <button
            onClick={() => setArchiveMenuOpen(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-text-muted hover:text-text-primary hover:bg-surface/60 transition-colors"
            title="More options"
          >
            <MoreHorizontal size={13} />
          </button>
          {archiveMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-surface border border-border rounded-xl shadow-lg z-50 py-1 w-44">
              <button
                onClick={() => {
                  setArchiveMenuOpen(false)
                  setPrefilledChat(`Archive the ${config.name} strategy`)
                  router.push(`/s/${strategyId}`)
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-accent-red hover:bg-background/50 transition-colors"
              >
                Archive strategy
              </button>
            </div>
          )}
        </div>
        </div>
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
            strategies={strategies}
            prefilledInput={prefilledChat}
            onPrefilledConsumed={() => setPrefilledChat("")}
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
                <TradesContent
                  state={state}
                  fetchState={fetchState}
                  strategyId={strategyId}
                  strategyAllocation={strategyAllocation}
                  maxRiskPct={maxRiskPct}
                  onOpenGuardrails={() => togglePanel("guardrails")}
                  authFetch={authFetch}
                />
              )}
              {panelSection === "agent" && (
                <AgentContent state={state} fetchState={fetchState} authFetch={authFetch} />
              )}
              {panelSection === "learnings" && (
                <LearningsContent strategyDoc={strategyDoc} />
              )}
              {panelSection === "versions" && (
                <VersionsContent strategyId={strategyId} authFetch={authFetch} />
              )}
              {panelSection === "documents" && (
                <DocumentsContent authFetch={authFetch} strategyId={strategyId} />
              )}
              {panelSection === "guardrails" && (
                <div>
                  {strategyDoc && (
                    <div className="px-4 pt-4 pb-2">
                      <div className="bg-surface rounded-lg border border-border px-4 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-text-muted uppercase tracking-wider mb-0.5">Autonomy</p>
                          <p className="text-sm text-text-primary">
                            {strategyDoc.autonomy === "autonomous" ? "Autonomous — no approval required" : "Approval required for trades"}
                          </p>
                        </div>
                        <span className={[
                          "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                          strategyDoc.autonomy === "autonomous"
                            ? "text-accent-green border-accent-green/30 bg-accent-green/10"
                            : "text-text-muted border-border",
                        ].join(" ")}>
                          {strategyDoc.autonomy === "autonomous" ? "autonomous" : "approval"}
                        </span>
                      </div>
                    </div>
                  )}
                  <StrategySettingsPanel
                    embedded
                    state={state}
                    onStateRefresh={() => { fetchState(); fetchStrategySettings() }}
                    strategy={strategyId}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <MISCountdown positions={state?.positions ?? []} />
    </div>
  )
}
