"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  Settings,
  LogOut,
  ChevronDown,
  ChevronRight,
  Plus,
  BarChart2,
  MessageSquare,
  Pause,
  Play,
} from "lucide-react"
import { useState, useEffect, useCallback } from "react"
import clsx from "clsx"
import { useAuth } from "@/lib/auth"

interface ThreadMeta {
  id: string
  strategy: string
  title: string
  created_at: string
  status: "idle" | "thinking"
}

interface StrategyEntry {
  id: string
  name: string
  status: string
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function Sidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user, signOut, authFetch } = useAuth()

  const currentThreadId = searchParams.get("t")
  const isPortfolioActive = pathname === "/"
  const isPortfolioThread = isPortfolioActive && !!currentThreadId
  const isSettingsActive = pathname?.startsWith("/settings")
  const activeStrategyId = pathname?.startsWith("/s/") ? pathname.split("/")[2] : null
  const activeThreadId = activeStrategyId ? currentThreadId : null
  const activePortfolioThreadId = isPortfolioThread ? currentThreadId : null

  // Portfolio threads
  const [portfolioExpanded, setPortfolioExpanded] = useState(false)
  const [portfolioThreads, setPortfolioThreads] = useState<ThreadMeta[]>([])
  const [newPortfolioChatLoading, setNewPortfolioChatLoading] = useState(false)

  // Dynamic strategies
  const [strategies, setStrategies] = useState<StrategyEntry[]>([])
  const [expandedStrategies, setExpandedStrategies] = useState<Record<string, boolean>>({})
  const [strategyThreads, setStrategyThreads] = useState<Record<string, ThreadMeta[]>>({})
  const [chatLoading, setChatLoading] = useState<Record<string, boolean>>({})

  // Pause state
  const [paused, setPaused] = useState(false)
  const [pauseLoading, setPauseLoading] = useState(false)

  // Auto-expand portfolio section when on a portfolio thread
  useEffect(() => {
    if (isPortfolioThread) setPortfolioExpanded(true)
  }, [isPortfolioThread])

  const loadPortfolioThreads = useCallback(async () => {
    try {
      const res = await authFetch("/api/threads/portfolio")
      if (!res.ok) return
      const data = await res.json()
      setPortfolioThreads(data)
    } catch { /* silent */ }
  }, [authFetch])

  useEffect(() => {
    if (portfolioExpanded) loadPortfolioThreads()
  }, [portfolioExpanded, loadPortfolioThreads])

  useEffect(() => {
    if (isPortfolioThread && activePortfolioThreadId) loadPortfolioThreads()
  }, [activePortfolioThreadId, isPortfolioThread, loadPortfolioThreads])

  const handleNewPortfolioChat = useCallback(async () => {
    setNewPortfolioChatLoading(true)
    try {
      const res = await authFetch("/api/threads/portfolio", { method: "POST" })
      if (!res.ok) return
      const thread = await res.json()
      setPortfolioExpanded(true)
      router.push(`/?t=${thread.id}`)
      setTimeout(loadPortfolioThreads, 300)
    } catch { /* silent */ }
    finally {
      setNewPortfolioChatLoading(false)
    }
  }, [authFetch, router, loadPortfolioThreads])

  // Strategy loading
  const loadThreadsForStrategy = useCallback(async (strategyId: string) => {
    try {
      const res = await authFetch(`/api/threads/${strategyId}`)
      if (!res.ok) return
      const data = await res.json()
      setStrategyThreads((prev) => ({ ...prev, [strategyId]: data }))
    } catch { /* silent */ }
  }, [authFetch])

  const loadStrategies = useCallback(async () => {
    try {
      const res = await authFetch("/api/strategies")
      if (!res.ok) return
      const data: StrategyEntry[] = await res.json()
      setStrategies(data)
      // Auto-expand the active strategy
      if (activeStrategyId) {
        setExpandedStrategies((prev) => ({ ...prev, [activeStrategyId]: true }))
      }
    } catch { /* silent */ }
  }, [authFetch, activeStrategyId])

  useEffect(() => {
    loadStrategies()
    window.addEventListener("strategies-updated", loadStrategies)
    return () => window.removeEventListener("strategies-updated", loadStrategies)
  }, [loadStrategies])

  // Load threads for expanded strategies
  useEffect(() => {
    Object.keys(expandedStrategies).forEach((sid) => {
      if (expandedStrategies[sid]) loadThreadsForStrategy(sid)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(expandedStrategies), loadThreadsForStrategy])

  // Reload threads for active strategy when thread changes
  useEffect(() => {
    if (activeStrategyId && activeThreadId) loadThreadsForStrategy(activeStrategyId)
  }, [activeThreadId, activeStrategyId, loadThreadsForStrategy])

  // Fetch pause state
  const fetchPauseState = useCallback(async () => {
    try {
      const res = await authFetch("/api/state")
      if (!res.ok) return
      const data = await res.json()
      setPaused(data.paused ?? false)
    } catch { /* silent */ }
  }, [authFetch])

  useEffect(() => {
    fetchPauseState()
    const interval = setInterval(fetchPauseState, 15000)
    return () => clearInterval(interval)
  }, [fetchPauseState])

  const handlePauseResume = useCallback(async () => {
    setPauseLoading(true)
    try {
      const endpoint = paused ? "/api/resume" : "/api/pause"
      await authFetch(endpoint, { method: "POST" })
      setPaused(!paused)
    } catch { /* silent */ }
    finally { setPauseLoading(false) }
  }, [paused, authFetch])

  const handleNewChat = useCallback(async (strategyId: string) => {
    setChatLoading((prev) => ({ ...prev, [strategyId]: true }))
    try {
      const res = await authFetch(`/api/threads/${strategyId}`, { method: "POST" })
      if (!res.ok) return
      const thread = await res.json()
      setExpandedStrategies((prev) => ({ ...prev, [strategyId]: true }))
      router.push(`/s/${strategyId}?t=${thread.id}`)
      setTimeout(() => loadThreadsForStrategy(strategyId), 300)
    } catch { /* silent */ }
    finally {
      setChatLoading((prev) => ({ ...prev, [strategyId]: false }))
    }
  }, [authFetch, router, loadThreadsForStrategy])

  return (
    <nav className="w-56 bg-surface border-r border-border h-screen flex flex-col shrink-0">
      {/* Wordmark */}
      <div className="px-4 pt-5 pb-4 flex items-baseline gap-2">
        <span className="font-mono font-semibold text-sm text-text-primary tracking-tight">
          vibe trade
        </span>
        <span className="text-[10px] font-mono text-text-muted">β</span>
      </div>

      <div className="border-t border-border" />

      {/* Portfolio link + threads */}
      <div className="px-2 pt-2 pb-1">
        <div className="flex items-center">
          <button
            onClick={() => setPortfolioExpanded((v) => !v)}
            className={clsx(
              "flex-1 flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left",
              isPortfolioActive && !isPortfolioThread
                ? "bg-background text-text-primary"
                : isPortfolioThread
                ? "text-text-primary"
                : "text-text-muted hover:text-text-primary hover:bg-background/50"
            )}
          >
            {portfolioExpanded ? (
              <ChevronDown size={13} className="shrink-0 text-text-muted" />
            ) : (
              <ChevronRight size={13} className="shrink-0 text-text-muted" />
            )}
            <BarChart2 size={15} className="shrink-0" />
            <Link href="/" className="flex-1" onClick={(e) => e.stopPropagation()}>
              Portfolio
            </Link>
          </button>
        </div>

        {portfolioExpanded && (
          <div className="ml-5 mt-0.5 flex flex-col gap-0.5">
            {portfolioThreads.map((thread) => {
              const isActive = activePortfolioThreadId === thread.id
              return (
                <Link
                  key={thread.id}
                  href={`/?t=${thread.id}`}
                  className={clsx(
                    "flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md text-[12px] truncate transition-colors",
                    isActive
                      ? "bg-background text-text-primary"
                      : "text-text-muted hover:text-text-primary hover:bg-background/50"
                  )}
                  title={thread.title}
                >
                  <MessageSquare size={11} className="shrink-0 text-text-muted" />
                  <span className="flex-1 truncate">{thread.title}</span>
                  <span className="text-[10px] text-text-muted shrink-0">
                    {relativeTime(thread.created_at)}
                  </span>
                </Link>
              )
            })}

            <button
              onClick={handleNewPortfolioChat}
              disabled={newPortfolioChatLoading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] text-text-muted hover:text-text-primary hover:bg-background/50 transition-colors disabled:opacity-50 disabled:cursor-wait text-left"
            >
              <Plus size={12} className="shrink-0" />
              <span>{newPortfolioChatLoading ? "Creating..." : "New chat"}</span>
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-border mx-3 mt-1" />

      {/* Strategies section */}
      <div className="flex-1 overflow-y-auto px-2 pt-3 pb-2">
        <p className="px-3 pb-2 text-[11px] uppercase tracking-wider text-text-muted">
          Strategies
        </p>

        {/* Dynamic registered strategies */}
        {strategies.map((strategy) => {
          const isActive = pathname?.startsWith(`/s/${strategy.id}`)
          const isExpanded = expandedStrategies[strategy.id] ?? false
          const threads = strategyThreads[strategy.id] ?? []
          const isLoading = chatLoading[strategy.id] ?? false

          return (
            <div key={strategy.id}>
              <button
                onClick={() =>
                  setExpandedStrategies((prev) => ({
                    ...prev,
                    [strategy.id]: !prev[strategy.id],
                  }))
                }
                className={clsx(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left",
                  isActive
                    ? "bg-background text-text-primary"
                    : "text-text-muted hover:text-text-primary hover:bg-background/50"
                )}
              >
                {isExpanded ? (
                  <ChevronDown size={13} className="shrink-0 text-text-muted" />
                ) : (
                  <ChevronRight size={13} className="shrink-0 text-text-muted" />
                )}
                <span className="flex-1 truncate text-[13px]">{strategy.name}</span>
              </button>

              {isExpanded && (
                <div className="ml-5 mt-0.5 flex flex-col gap-0.5">
                  {threads.map((thread) => {
                    const isThreadActive =
                      activeStrategyId === strategy.id && activeThreadId === thread.id
                    return (
                      <Link
                        key={thread.id}
                        href={`/s/${strategy.id}?t=${thread.id}`}
                        className={clsx(
                          "flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md text-[12px] truncate transition-colors",
                          isThreadActive
                            ? "bg-background text-text-primary"
                            : "text-text-muted hover:text-text-primary hover:bg-background/50"
                        )}
                        title={thread.title}
                      >
                        <MessageSquare size={11} className="shrink-0 text-text-muted" />
                        <span className="flex-1 truncate">{thread.title}</span>
                        <span className="text-[10px] text-text-muted shrink-0">
                          {relativeTime(thread.created_at)}
                        </span>
                      </Link>
                    )
                  })}

                  <button
                    onClick={() => handleNewChat(strategy.id)}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] text-text-muted hover:text-text-primary hover:bg-background/50 transition-colors disabled:opacity-50 disabled:cursor-wait text-left"
                  >
                    <Plus size={12} className="shrink-0" />
                    <span>{isLoading ? "Creating..." : "New chat"}</span>
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {strategies.length === 0 && (
          <p className="px-3 py-2 text-[12px] text-text-muted opacity-50">
            Create a new strategy to see it here
          </p>
        )}
      </div>

      <div className="border-t border-border" />

      {/* Pause / Resume */}
      <div className="px-2 py-2">
        <button
          onClick={handlePauseResume}
          disabled={pauseLoading}
          className={clsx(
            "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors disabled:opacity-50",
            paused
              ? "text-accent-amber hover:bg-accent-amber/10"
              : "text-text-muted hover:text-text-primary hover:bg-background/50"
          )}
        >
          {paused ? <Play size={15} /> : <Pause size={15} />}
          <span className="font-mono text-xs">
            {pauseLoading ? "..." : paused ? "PAUSED" : "Pause agent"}
          </span>
        </button>
      </div>

      <div className="border-t border-border" />

      {/* Settings */}
      <div className="px-2 py-2">
        <Link
          href="/settings"
          className={clsx(
            "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
            isSettingsActive
              ? "bg-background text-text-primary"
              : "text-text-muted hover:text-text-primary hover:bg-background/50"
          )}
        >
          <Settings size={15} />
          <span>Settings</span>
        </Link>
      </div>

      <div className="border-t border-border" />

      {/* User section */}
      <div className="px-4 py-3">
        {user?.email && (
          <p
            className="text-[11px] text-text-muted truncate mb-2"
            title={user.email}
          >
            {user.email}
          </p>
        )}
        <button
          onClick={signOut}
          className="flex items-center gap-2 text-[12px] text-text-muted hover:text-accent-red transition-colors"
        >
          <LogOut size={13} />
          <span>Sign out</span>
        </button>
      </div>
    </nav>
  )
}
