"use client"

import clsx from "clsx"

interface MarketRegimeBadgeProps {
  content: string
}

export function MarketRegimeBadge({ content }: MarketRegimeBadgeProps) {
  // Extract overall bias from markdown
  const match = content.match(/Overall Market Bias:\s*(.+)/i)
  const bias = match ? match[1].trim() : "UNKNOWN"

  const lower = bias.toLowerCase()
  const isBullish = lower.includes("bullish") && !lower.includes("bearish")
  const isBearish = lower.includes("bearish") && !lower.includes("bullish")
  // Otherwise cautious / mixed

  return (
    <span
      className={clsx(
        "inline-block px-4 py-2 rounded-full text-sm font-semibold",
        isBullish && "bg-accent-green/20 text-accent-green",
        isBearish && "bg-accent-red/20 text-accent-red",
        !isBullish && !isBearish && "bg-accent-amber/20 text-accent-amber"
      )}
    >
      {bias}
    </span>
  )
}
