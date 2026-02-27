"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import {
  Settings,
  LogOut,
  ChevronDown,
  ChevronRight,
  Plus,
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
          vibe trade
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
        <p className="px-3 pb-2 text-[11px] uppercase tracking-wider text-text-muted">
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
            <span className="flex-1 truncate text-[13px]">
              {intraday.name}
            </span>
          </button>

          {intradayExpanded && (
            <div className="ml-5 mt-0.5 flex flex-col gap-0.5">
              {/* Disabled example threads — no icon, just indented text */}
              <div
                className="pl-6 pr-3 py-1.5 rounded-md text-[12px] text-text-muted opacity-50 cursor-not-allowed select-none truncate"
                title="Coming soon"
              >
                Planning for tomorrow
              </div>
              <div
                className="pl-6 pr-3 py-1.5 rounded-md text-[12px] text-text-muted opacity-50 cursor-not-allowed select-none truncate"
                title="Coming soon"
              >
                Defense sector thesis
              </div>

              {/* New chat — disabled */}
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] text-text-muted opacity-50 cursor-not-allowed select-none"
              >
                <Plus size={12} className="shrink-0" />
                <span>New chat</span>
              </div>
            </div>
          )}
        </div>

        {/* Coming soon strategies — muted text only, no lock, no badge */}
        {COMING_SOON_STRATEGIES.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm opacity-30 cursor-not-allowed select-none mt-0.5"
          >
            <span className="flex-1 truncate text-[13px] text-text-muted">
              {s.name}
            </span>
          </div>
        ))}

        {/* New strategy — disabled */}
        <div className="mt-2 px-3">
          <div
            className="flex items-center gap-2 text-[12px] text-text-muted opacity-30 cursor-not-allowed select-none"
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
