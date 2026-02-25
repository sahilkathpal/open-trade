"use client"

import clsx from "clsx"
import { motion } from "framer-motion"

interface AgentStatusBarProps {
  marketOpen: boolean
  agentStatus: "idle" | "running"
  autonomous: boolean
}

export function AgentStatusBar({ marketOpen, agentStatus, autonomous }: AgentStatusBarProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-14 bg-surface border-b border-border flex items-center justify-between px-6">
      <span className="font-semibold text-text-primary text-lg tracking-tight">
        vibe-trade
      </span>

      <div className="flex items-center gap-2">
        {/* Market */}
        <div className={clsx(
          "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono",
          marketOpen
            ? "bg-accent-green/10 text-accent-green"
            : "bg-border/40 text-text-muted"
        )}>
          <span className={clsx(
            "w-1.5 h-1.5 rounded-full",
            marketOpen ? "bg-accent-green" : "bg-text-muted"
          )} />
          {marketOpen ? "Market open" : "Market closed"}
        </div>

        {/* Agent */}
        <div className={clsx(
          "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono",
          agentStatus === "running"
            ? "bg-accent-amber/10 text-accent-amber"
            : "bg-border/40 text-text-muted"
        )}>
          {agentStatus === "running" ? (
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-accent-amber inline-block"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
          )}
          {agentStatus === "running" ? "Agent running" : "Agent idle"}
        </div>

        {/* Autonomous */}
        <div className={clsx(
          "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono",
          autonomous
            ? "bg-accent-green/10 text-accent-green"
            : "bg-border/40 text-text-muted"
        )}>
          <span className={clsx(
            "w-1.5 h-1.5 rounded-full",
            autonomous ? "bg-accent-green" : "bg-text-muted"
          )} />
          {autonomous ? "Autonomous" : "Manual approval"}
        </div>
      </div>
    </div>
  )
}
