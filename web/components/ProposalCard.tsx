"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import clsx from "clsx"

interface ProposalCardProps {
  symbol: string
  transaction_type: string
  entry_price: number
  stop_loss_price: number
  target_price: number
  quantity: number
  thesis: string
  onApproved: () => void
  onDenied: () => void
}

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function ProposalCard({
  symbol,
  transaction_type,
  entry_price,
  stop_loss_price,
  target_price,
  quantity,
  thesis,
  onApproved,
  onDenied,
}: ProposalCardProps) {
  const [loading, setLoading] = useState<"approve" | "deny" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const risk = entry_price - stop_loss_price
  const reward = target_price - entry_price
  const rr = risk > 0 ? (reward / risk).toFixed(1) : "N/A"
  const totalValue = entry_price * quantity

  async function handleApprove() {
    setLoading("approve")
    setError(null)
    try {
      const res = await fetch(`/api/approve/${symbol}`, { method: "POST" })
      if (!res.ok) throw new Error("Approval failed")
      setDismissed(true)
      setTimeout(onApproved, 500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setLoading(null)
    }
  }

  async function handleDeny() {
    setLoading("deny")
    setError(null)
    try {
      const res = await fetch(`/api/deny/${symbol}`, { method: "POST" })
      if (!res.ok) throw new Error("Deny failed")
      setDismissed(true)
      setTimeout(onDenied, 500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setLoading(null)
    }
  }

  if (dismissed) {
    return (
      <motion.div
        initial={{ opacity: 1, scale: 1 }}
        animate={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.4 }}
        className="bg-surface rounded-lg border border-border p-4 text-center text-accent-green"
      >
        Order Submitted
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="bg-surface rounded-lg border border-border border-l-4 border-l-accent-amber p-5 shadow-[0_0_15px_rgba(240,136,62,0.1)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-semibold text-text-primary">{symbol}</span>
          <span className={clsx(
            "text-xs font-medium px-2 py-0.5 rounded",
            transaction_type === "BUY" ? "bg-accent-green/20 text-accent-green" : "bg-accent-red/20 text-accent-red"
          )}>
            {transaction_type}
          </span>
        </div>
        <span className="font-mono text-sm text-text-muted">R:R {rr}:1</span>
      </div>

      {/* Price details */}
      <div className="font-mono text-sm text-text-muted mb-3">
        Entry {formatINR(entry_price)} &middot; SL {formatINR(stop_loss_price)} &middot; Target{" "}
        {formatINR(target_price)} &middot; {quantity} shares &middot; {formatINR(totalValue)}
      </div>

      <div className="border-t border-border my-3" />

      {/* Thesis */}
      <p className="text-sm text-text-muted mb-3">{thesis}</p>

      <div className="border-t border-border my-3" />

      {/* Actions */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleApprove}
          disabled={loading !== null}
          className="flex-1 py-2 rounded-md bg-accent-green/20 text-accent-green font-medium text-sm hover:bg-accent-green/30 transition-colors disabled:opacity-50"
        >
          {loading === "approve" ? "Submitting..." : "APPROVE"}
        </button>
        <button
          onClick={handleDeny}
          disabled={loading !== null}
          className="flex-1 py-2 rounded-md bg-accent-red/20 text-accent-red font-medium text-sm hover:bg-accent-red/30 transition-colors disabled:opacity-50"
        >
          {loading === "deny" ? "Denying..." : "DENY"}
        </button>
      </div>

      {error && <p className="text-accent-red text-xs mt-2">{error}</p>}
    </motion.div>
  )
}
