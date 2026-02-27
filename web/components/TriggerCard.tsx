"use client"

interface Trigger {
  id: string
  type: string
  reason: string
  expires_at: string
  symbol?: string
  threshold?: number
  at?: string
  buffer_pct?: number
  above_pct?: number
}

const TYPE_LABELS: Record<string, string> = {
  time:             "Time",
  price_above:      "Price ↑",
  price_below:      "Price ↓",
  index_above:      "Index ↑",
  index_below:      "Index ↓",
  near_stop:        "Near Stop",
  near_target:      "Near Target",
  day_pnl_above:    "P&L ↑",
  day_pnl_below:    "P&L ↓",
  position_pnl_pct: "Pos P&L %",
}

function conditionSummary(t: Trigger): string {
  switch (t.type) {
    case "time":
      return `at ${t.at} IST`
    case "price_above":
      return `${t.symbol} ≥ ₹${t.threshold?.toFixed(2)}`
    case "price_below":
      return `${t.symbol} ≤ ₹${t.threshold?.toFixed(2)}`
    case "index_above":
      return `${t.symbol ?? "NIFTY50"} ≥ ₹${t.threshold?.toFixed(2)}`
    case "index_below":
      return `${t.symbol ?? "NIFTY50"} ≤ ₹${t.threshold?.toFixed(2)}`
    case "near_stop":
      return `${t.symbol} within ${t.buffer_pct}% of stop`
    case "near_target":
      return `${t.symbol} within ${t.buffer_pct}% of target`
    case "day_pnl_above":
      return `Day P&L ≥ ₹${t.threshold?.toFixed(0)}`
    case "day_pnl_below":
      return `Day P&L ≤ ₹${t.threshold?.toFixed(0)}`
    case "position_pnl_pct":
      return `${t.symbol} position ≥ +${t.above_pct}%`
    default:
      return t.type
  }
}

export function TriggerCard({ trigger }: { trigger: Trigger }) {
  const label = TYPE_LABELS[trigger.type] ?? trigger.type
  const condition = conditionSummary(trigger)

  const exp = new Date(trigger.expires_at)
  const expStr = exp.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  })

  return (
    <div className="bg-surface rounded-lg border border-border p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-accent-amber border border-accent-amber/40 rounded px-1.5 py-0.5">
            {label}
          </span>
          <span className="font-mono text-sm text-text-primary">{condition}</span>
        </div>
        <span className="text-xs text-text-muted font-mono">exp {expStr}</span>
      </div>
      <p className="text-xs text-text-muted leading-relaxed">{trigger.reason}</p>
    </div>
  )
}
