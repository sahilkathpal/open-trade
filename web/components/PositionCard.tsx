"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import clsx from "clsx"

interface Position {
  symbol: string
  entry_price: number
  current_price: number
  quantity: number
  pnl: number
  stop_loss_price: number
  target_price: number
}

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function PositionCard({ position }: { position: Position }) {
  const [confirming, setConfirming] = useState(false)

  const { symbol, entry_price, current_price, quantity, pnl, stop_loss_price, target_price } = position
  const pnlPct = entry_price > 0 ? (pnl / (entry_price * quantity)) * 100 : 0

  // Progress bar: how far from entry to target the CMP is
  const range = target_price - entry_price
  const progress = range !== 0 ? Math.max(0, Math.min(100, ((current_price - entry_price) / range) * 100)) : 0

  async function handleExit() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    // actual exit
    try {
      await fetch(`http://localhost:8000/api/exit/${symbol}`, { method: "POST" })
    } catch {
      // handle silently
    }
    setConfirming(false)
  }

  return (
    <div className="bg-surface rounded-lg border border-border p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-lg font-semibold text-text-primary">{symbol}</span>
        <motion.span
          key={pnl}
          initial={{ color: pnl >= 0 ? "#3FB950" : "#F85149" }}
          animate={{ color: pnl >= 0 ? "#3FB950" : "#F85149" }}
          className="font-mono text-lg font-semibold"
        >
          {formatINR(pnl)} <span className="text-sm">({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)</span>
        </motion.span>
      </div>

      <div className="grid grid-cols-4 gap-2 text-xs text-text-muted mb-3">
        <div>
          <div className="uppercase tracking-wider">Entry</div>
          <div className="font-mono text-text-primary">{formatINR(entry_price)}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider">CMP</div>
          <div className="font-mono text-text-primary">{formatINR(current_price)}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider">SL</div>
          <div className="font-mono text-text-primary">{formatINR(stop_loss_price)}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider">Target</div>
          <div className="font-mono text-text-primary">{formatINR(target_price)}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-1.5 rounded-full bg-border mb-3">
        <div className="h-full bg-accent-green/30 rounded-full" style={{ width: `${progress}%` }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-accent-green border-2 border-surface"
          style={{ left: `${progress}%` }}
        />
      </div>

      <button
        onClick={handleExit}
        onBlur={() => setConfirming(false)}
        className={clsx(
          "text-xs px-3 py-1.5 rounded border transition-colors",
          confirming
            ? "border-accent-red text-accent-red hover:bg-accent-red/20"
            : "border-border text-text-muted hover:text-text-primary"
        )}
      >
        {confirming ? "Confirm?" : "Exit Position"}
      </button>
    </div>
  )
}
