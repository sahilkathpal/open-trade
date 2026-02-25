"use client"

import { useEffect, useState } from "react"
import { getActiveStrategy, getStrategyLabel, type StrategyId } from "@/lib/strategy"

export function StrategyBadge() {
  const [label, setLabel] = useState<string>("")

  useEffect(() => {
    setLabel(getStrategyLabel(getActiveStrategy() as StrategyId))
  }, [])

  if (!label) return null

  return (
    <span className="inline-block text-xs font-mono text-text-muted border border-border rounded px-2 py-0.5">
      {label}
    </span>
  )
}
