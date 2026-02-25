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
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

export function RiskGauge({ dayPnl, limit }: RiskGaugeProps) {
  const loss = dayPnl < 0 ? Math.abs(dayPnl) : 0
  const consumed = Math.min((loss / limit) * 100, 100)
  const remaining = Math.max(limit - loss, 0)

  const isProfit = dayPnl >= 0
  const isCritical = consumed > 80
  const isWarning = consumed > 50

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <div className="text-text-muted text-xs uppercase tracking-wider mb-3">Daily Loss Limit</div>

      {isProfit ? (
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
          <span className="text-sm font-mono text-accent-green">No losses</span>
          {dayPnl > 0 && <span className="text-xs text-text-muted font-mono ml-auto">+{formatINR(dayPnl)}</span>}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className={clsx(
              "font-mono text-sm",
              isCritical ? "text-accent-red" : isWarning ? "text-accent-amber" : "text-text-primary"
            )}>
              {formatINR(remaining)} remaining
            </span>
            <span className="text-xs font-mono text-text-muted">
              {formatINR(-loss)} / -{formatINR(limit)}
            </span>
          </div>

          <div className="h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className={clsx(
                "h-full rounded-full transition-all",
                isCritical ? "bg-accent-red" : isWarning ? "bg-accent-amber" : "bg-accent-green"
              )}
              style={{ width: `${consumed}%` }}
            />
          </div>

          {isCritical && (
            <p className="text-xs text-accent-red font-mono mt-2">
              Agent will halt at -{formatINR(limit)}
            </p>
          )}
        </>
      )}
    </div>
  )
}
