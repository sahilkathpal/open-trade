"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import {
  Settings,
  LogOut,
  ChevronDown,
  ChevronRight,
  Plus,
  MessageSquare,
  Lock,
  BarChart2,
} from "lucide-react"
import { useState } from "react"
import clsx from "clsx"
import { useAuth } from "@/lib/auth"
import { STRATEGY_CONFIGS, COMING_SOON_STRATEGIES } from "@/lib/types"

export function Sidebar() {
  const pathname = usePathname()
  const { user, signOut } = useAuth()
  const [intradayExpanded, setIntradayExpanded] = useState(true)

  const isPortfolioActive = pathname === "/"
  const isIntradayActive = pathname?.startsWith("/s/intraday")
  const isSettingsActive = pathname?.startsWith("/settings")

  const intraday = STRATEGY_CONFIGS["intraday"]

  return (
    <nav className="w-56 bg-surface border-r border-border h-screen flex flex-col shrink-0">
      {/* Wordmark */}
      <div className="px-4 pt-5 pb-4 flex items-baseline gap-2">
        <span className="font-mono font-semibold text-sm text-text-primary tracking-tight">
          HARNESS
        </span>
        <span className="text-[10px] font-mono text-text-muted">β</span>
      </div>

      <div className="border-t border-border" />

      {/* Portfolio link */}
      <div className="px-2 pt-2 pb-1">
        <Link
          href="/"
          className={clsx(
            "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
            isPortfolioActive
              ? "bg-background text-text-primary"
              : "text-text-muted hover:text-text-primary hover:bg-background/50"
          )}
        >
          <BarChart2 size={15} />
          <span>Portfolio</span>
        </Link>
      </div>

      <div className="border-t border-border mx-3 mt-1" />

      {/* Strategies section */}
      <div className="flex-1 overflow-y-auto px-2 pt-3 pb-2">
        <p className="px-3 pb-2 text-[11px] font-mono uppercase tracking-wider text-text-muted">
          Strategies
        </p>

        {/* Intraday Momentum — expandable, live */}
        <div>
          <button
            onClick={() => setIntradayExpanded((v) => !v)}
            className={clsx(
              "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left",
              isIntradayActive
                ? "bg-background text-text-primary"
                : "text-text-muted hover:text-text-primary hover:bg-background/50"
            )}
          >
            {intradayExpanded ? (
              <ChevronDown size={13} className="shrink-0 text-text-muted" />
            ) : (
              <ChevronRight size={13} className="shrink-0 text-text-muted" />
            )}
            <span className="flex-1 truncate font-mono text-[13px]">
              {intraday.name}
            </span>
            <span className="shrink-0 text-[9px] font-mono font-semibold tracking-widest px-1.5 py-0.5 rounded bg-accent-green/15 text-accent-green border border-accent-green/25">
              LIVE
            </span>
          </button>

          {intradayExpanded && (
            <div className="ml-5 mt-0.5 flex flex-col gap-0.5">
              {/* Disabled example threads */}
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] text-text-muted opacity-50 cursor-not-allowed select-none"
                title="Coming soon"
              >
                <MessageSquare size={12} className="shrink-0" />
                <span className="truncate">Planning for tomorrow</span>
              </div>
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] text-text-muted opacity-50 cursor-not-allowed select-none"
                title="Coming soon"
              >
                <MessageSquare size={12} className="shrink-0" />
                <span className="truncate">Defense sector thesis</span>
              </div>

              {/* New chat — disabled */}
              <div className="relative group">
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] text-text-muted opacity-50 cursor-not-allowed select-none"
                >
                  <Plus size={12} className="shrink-0" />
                  <span>New chat</span>
                </div>
                <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-surface border border-border rounded text-[11px] font-mono text-text-muted whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                  Coming soon
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Coming soon strategies */}
        {COMING_SOON_STRATEGIES.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm opacity-40 cursor-not-allowed select-none mt-0.5"
          >
            <Lock size={12} className="shrink-0 text-text-muted" />
            <span className="flex-1 truncate font-mono text-[13px] text-text-muted">
              {s.name}
            </span>
            <span className="shrink-0 text-[9px] font-mono font-semibold tracking-widest px-1.5 py-0.5 rounded bg-surface border border-border text-text-muted">
              SOON
            </span>
          </div>
        ))}

        {/* New strategy — disabled */}
        <div className="mt-2 px-3">
          <div
            className="flex items-center gap-2 text-[12px] font-mono text-text-muted opacity-40 cursor-not-allowed select-none"
          >
            <Plus size={12} className="shrink-0" />
            <span>New strategy</span>
          </div>
        </div>
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
            className="text-[11px] font-mono text-text-muted truncate mb-2"
            title={user.email}
          >
            {user.email}
          </p>
        )}
        <button
          onClick={signOut}
          className="flex items-center gap-2 text-[12px] font-mono text-text-muted hover:text-accent-red transition-colors"
        >
          <LogOut size={13} />
          <span>Sign out</span>
        </button>
      </div>
    </nav>
  )
}
