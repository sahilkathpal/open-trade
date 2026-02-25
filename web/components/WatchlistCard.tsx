"use client"

interface WatchlistEntry {
  security_id: string
  entry_min: number
  entry_max: number
  stop_loss_price: number
  target_price: number
  quantity: number
  thesis: string
  rsi_max?: number
  candle_close_above?: number
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function WatchlistCard({
  symbol,
  entry,
}: {
  symbol: string
  entry: WatchlistEntry
}) {
  const risk = entry.entry_max - entry.stop_loss_price
  const reward = entry.target_price - entry.entry_min
  const rrr = risk > 0 ? (reward / risk).toFixed(1) : "—"

  return (
    <div className="bg-surface rounded-lg border border-border p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-lg font-semibold text-text-primary">{symbol}</span>
        <span className="text-xs font-mono text-accent-amber border border-accent-amber/40 rounded px-2 py-0.5">
          WATCHING
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 text-xs text-text-muted mb-3">
        <div>
          <div className="uppercase tracking-wider">Entry</div>
          <div className="font-mono text-text-primary">
            {fmt(entry.entry_min)}–{fmt(entry.entry_max)}
          </div>
        </div>
        <div>
          <div className="uppercase tracking-wider">SL</div>
          <div className="font-mono text-accent-red">{fmt(entry.stop_loss_price)}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider">Target</div>
          <div className="font-mono text-accent-green">{fmt(entry.target_price)}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider">R:R / Qty</div>
          <div className="font-mono text-text-primary">
            {rrr}R · {entry.quantity}
          </div>
        </div>
      </div>

      {(entry.rsi_max || entry.candle_close_above) && (
        <div className="flex gap-3 text-xs text-text-muted mb-2">
          {entry.rsi_max && (
            <span className="border border-border rounded px-2 py-0.5">
              RSI &lt; {entry.rsi_max}
            </span>
          )}
          {entry.candle_close_above && (
            <span className="border border-border rounded px-2 py-0.5">
              Close &gt; {fmt(entry.candle_close_above)}
            </span>
          )}
        </div>
      )}

      <p className="text-xs text-text-muted leading-relaxed">{entry.thesis}</p>
    </div>
  )
}
