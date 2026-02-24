"use client"

import clsx from "clsx"

interface RiskGaugeProps {
  dayPnl: number
  limit: number
}

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function RiskGauge({ dayPnl, limit }: RiskGaugeProps) {
  const pct = Math.min((Math.abs(dayPnl) / limit) * 100, 100)
  const color =
    pct > 80 ? "bg-accent-red" : pct > 50 ? "bg-accent-amber" : "bg-accent-green"
  const textColor =
    pct > 80 ? "text-accent-red" : pct > 50 ? "text-accent-amber" : "text-accent-green"

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <div className="text-text-muted text-xs uppercase tracking-wider mb-3">Risk Gauge</div>
      <div className="flex items-center justify-between text-xs text-text-muted mb-1">
        <span>Loss limit -{formatINR(limit)}</span>
        <span>Safe</span>
      </div>
      <div className="relative h-3 rounded-full bg-border overflow-hidden">
        <div
          className={clsx("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 text-center">
        <span className={clsx("font-mono text-sm", textColor)}>{formatINR(dayPnl)}</span>
      </div>
    </div>
  )
}
