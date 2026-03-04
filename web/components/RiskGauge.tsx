"use client"

interface RiskGaugeProps {
  seedCapital: number
  cumulativeRealized: number
  drawdownBaseline: number
  maxDrawdownPct: number
  tripped: boolean
  onReset: () => void
}

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

export function RiskGauge({
  seedCapital,
  cumulativeRealized,
  drawdownBaseline,
  maxDrawdownPct,
  tripped,
  onReset,
}: RiskGaugeProps) {
  const lossSinceReset = cumulativeRealized - drawdownBaseline
  const lossBudget = seedCapital * maxDrawdownPct / 100
  const usedPct = lossBudget > 0 ? Math.min(100, (Math.abs(Math.min(0, lossSinceReset)) / lossBudget) * 100) : 0

  const color = tripped ? "text-accent-red" : usedPct > 80 ? "text-accent-amber" : "text-text-muted"
  const barColor = tripped ? "bg-accent-red" : usedPct > 80 ? "bg-accent-amber" : "bg-accent-green"

  return (
    <div className={`bg-surface rounded-lg border p-4 ${tripped ? "border-accent-red/40" : "border-border"}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-text-muted text-xs uppercase tracking-wider">Loss Budget</div>
        {tripped && (
          <button
            onClick={onReset}
            className="text-[11px] font-medium text-accent-red underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            Reset circuit breaker
          </button>
        )}
      </div>

      {tripped ? (
        <p className="text-sm font-semibold text-accent-red font-mono mb-3">
          Circuit breaker tripped
        </p>
      ) : (
        <div className="flex items-baseline justify-between mb-3">
          <span className={`font-mono text-base ${color}`}>
            {lossSinceReset < 0 ? formatINR(lossSinceReset) : "—"} since last reset
          </span>
          <span className="text-xs text-text-muted font-mono">
            limit {formatINR(-lossBudget)}
          </span>
        </div>
      )}

      <div className="h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${usedPct}%` }}
        />
      </div>

      {tripped && (
        <p className="text-xs text-accent-red font-mono mt-2">
          {formatINR(Math.abs(lossSinceReset))} in realized losses — no new entries until you reset.
        </p>
      )}
    </div>
  )
}
