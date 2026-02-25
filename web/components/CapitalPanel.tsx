"use client"

import clsx from "clsx"

interface Capital {
  available_balance: number
  used_margin: number
}

interface AgentPnl {
  realized: number
  unrealized: number
  total: number
}

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function CapitalPanel({ capital, agentPnl, seedCapital, deployedNotional }: { capital: Capital; agentPnl: AgentPnl; seedCapital: number; deployedNotional: number }) {
  const deployedPct = seedCapital > 0 ? Math.min((deployedNotional / seedCapital) * 100, 100) : 0
  const pnlPct = seedCapital > 0 ? (agentPnl.total / seedCapital) * 100 : 0

  return (
    <div className="col-span-2 grid grid-cols-3 gap-4">
      {/* Balance */}
      <div className="bg-surface rounded-lg border border-border p-4">
        <div className="text-text-muted text-xs uppercase tracking-wider mb-1">Agent Capital</div>
        <div className="font-mono text-2xl text-text-primary">{formatINR(seedCapital)}</div>
        <div className="text-xs text-text-muted mt-1 font-mono">
          Account {formatINR(capital.available_balance)}
        </div>
      </div>

      {/* Agent P&L */}
      <div className="bg-surface rounded-lg border border-border p-4">
        <div className="text-text-muted text-xs uppercase tracking-wider mb-1">Agent P&amp;L</div>
        <div
          className={clsx(
            "font-mono text-2xl",
            agentPnl.total >= 0 ? "text-accent-green" : "text-accent-red"
          )}
        >
          {formatINR(agentPnl.total)}
          <span className="text-sm ml-2">
            ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
          </span>
        </div>
        <div className="text-xs text-text-muted mt-1 font-mono space-x-3">
          <span>Realized {formatINR(agentPnl.realized)}</span>
          <span>·</span>
          <span>Open {formatINR(agentPnl.unrealized)}</span>
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
            {formatINR(deployedNotional)} deployed / {formatINR(Math.max(seedCapital - deployedNotional, 0))} free
          </div>
        </div>
      </div>
    </div>
  )
}
