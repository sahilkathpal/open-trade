"use client"

import clsx from "clsx"
import { HeartbeatPulse } from "./HeartbeatPulse"

interface SchedulerStatus {
  last_premarket: string | null
  last_eod: string | null
}

interface AgentStatusBarProps {
  marketOpen: boolean
  agentStatus: "idle" | "running"
  schedulerStatus: SchedulerStatus | null
}

export function AgentStatusBar({ marketOpen, agentStatus, schedulerStatus }: AgentStatusBarProps) {
  const lastPremarket = schedulerStatus?.last_premarket
    ? new Date(schedulerStatus.last_premarket).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      })
    : "--:--"

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-14 bg-surface border-b border-border flex items-center justify-between px-6">
      <span className="font-semibold text-text-primary text-lg tracking-tight">
        open-trade
      </span>

      <div className="flex items-center gap-6 text-sm">
        {/* Market status */}
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "w-2 h-2 rounded-full",
              marketOpen ? "bg-accent-green" : "bg-text-muted"
            )}
          />
          <span className={clsx(marketOpen ? "text-accent-green" : "text-text-muted")}>
            {marketOpen ? "OPEN" : "CLOSED"}
          </span>
        </div>

        {/* Agent status */}
        <div className="flex items-center gap-2">
          <HeartbeatPulse status={agentStatus} />
          <span className="text-text-muted capitalize">{agentStatus}</span>
        </div>

        {/* Last pre-market */}
        <div className="text-text-muted">
          Pre-market: <span className="font-mono text-text-primary">{lastPremarket}</span>
        </div>
      </div>
    </div>
  )
}
