"use client"

import clsx from "clsx"

interface Capital {
  available_balance: number
  used_margin: number
  day_pnl: number
}

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function CapitalPanel({ capital }: { capital: Capital }) {
  const total = capital.available_balance + capital.used_margin
  const deployedPct = total > 0 ? (capital.used_margin / total) * 100 : 0
  const pnlPct = total > 0 ? (capital.day_pnl / total) * 100 : 0

  return (
    <div className="col-span-2 grid grid-cols-3 gap-4">
      {/* Available balance */}
      <div className="bg-surface rounded-lg border border-border p-4">
        <div className="text-text-muted text-xs uppercase tracking-wider mb-1">Available Balance</div>
        <div className="font-mono text-2xl text-text-primary">{formatINR(capital.available_balance)}</div>
      </div>

      {/* Day P&L */}
      <div className="bg-surface rounded-lg border border-border p-4">
        <div className="text-text-muted text-xs uppercase tracking-wider mb-1">Day P&L</div>
        <div
          className={clsx(
            "font-mono text-2xl",
            capital.day_pnl >= 0 ? "text-accent-green" : "text-accent-red"
          )}
        >
          {formatINR(capital.day_pnl)}
          <span className="text-sm ml-2">
            ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* Capital allocation */}
      <div className="bg-surface rounded-lg border border-border p-4">
        <div className="text-text-muted text-xs uppercase tracking-wider mb-1">Capital Allocation</div>
        <div className="mt-2">
          <div className="h-2 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-accent-green rounded-full transition-all"
              style={{ width: `${deployedPct}%` }}
            />
          </div>
          <div className="text-xs text-text-muted mt-1 font-mono">
            {formatINR(capital.used_margin)} deployed / {formatINR(capital.available_balance)} free
          </div>
        </div>
      </div>
    </div>
  )
}
