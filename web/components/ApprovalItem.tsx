"use client"

import { useState } from "react"
import { useAuth } from "@/lib/auth"
import { Approval } from "@/lib/types"

interface ApprovalItemProps {
  approval: Approval
  onRespond: () => void
}

function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return "expired"
  const min = Math.round(ms / 60000)
  if (min < 60) return `expires in ${min}m`
  const hr = Math.floor(min / 60)
  return `expires in ${hr}h ${min % 60}m`
}

export function ApprovalItem({ approval, onRespond }: ApprovalItemProps) {
  const { authFetch } = useAuth()
  const [loading, setLoading] = useState<"approve" | "deny" | null>(null)

  async function respond(approved: boolean) {
    setLoading(approved ? "approve" : "deny")
    try {
      await authFetch(`/api/approvals/${approval.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      })
      onRespond()
    } catch { /* silent */ }
    finally { setLoading(null) }
  }

  const rr = approval.entry_price && approval.stop_loss_price && approval.target_price && approval.entry_price !== approval.stop_loss_price
    ? ((approval.target_price - approval.entry_price) / (approval.entry_price - approval.stop_loss_price)).toFixed(1)
    : null

  return (
    <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
            approval.type === "trade"
              ? "border-accent-amber text-accent-amber"
              : "border-text-muted text-text-muted"
          }`}>
            {approval.type === "trade" ? "TRADE" : "TRIGGER"}
          </span>
          {approval.type === "trade" && approval.symbol && (
            <span className="font-mono text-sm font-semibold text-text-primary">{approval.symbol}</span>
          )}
          {approval.type === "hard_trigger" && approval.trigger_id && (
            <span className="font-mono text-sm text-text-muted">{approval.trigger_id}</span>
          )}
        </div>
        <span className="text-[10px] font-mono text-text-muted">{formatExpiry(approval.expires_at)}</span>
      </div>

      {/* Trade details */}
      {approval.type === "trade" && (
        <div className="space-y-1.5">
          <div className="flex gap-4 font-mono text-xs">
            <span className="text-text-muted">Entry</span>
            <span className="text-text-primary">{approval.entry_price?.toFixed(2)}</span>
            <span className="text-text-muted">SL</span>
            <span className="text-accent-red">{approval.stop_loss_price?.toFixed(2)}</span>
            <span className="text-text-muted">Target</span>
            <span className="text-accent-green">{approval.target_price?.toFixed(2)}</span>
          </div>
          <div className="flex gap-4 font-mono text-xs">
            <span className="text-text-muted">Qty</span>
            <span className="text-text-primary">{approval.quantity}</span>
            {rr && (
              <>
                <span className="text-text-muted">R:R</span>
                <span className="text-text-primary">{rr}:1</span>
              </>
            )}
          </div>
          {approval.thesis && (
            <p className="text-xs text-text-muted leading-relaxed">{approval.thesis}</p>
          )}
        </div>
      )}

      {/* Hard trigger details */}
      {approval.type === "hard_trigger" && (
        <div className="space-y-1">
          <p className="text-xs text-text-muted font-mono">Action: {approval.action}</p>
          {approval.reason && <p className="text-xs text-text-muted">{approval.reason}</p>}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => respond(true)}
          disabled={!!loading}
          className="flex-1 py-1.5 text-xs font-mono font-semibold bg-accent-green/10 text-accent-green border border-accent-green/30 rounded hover:bg-accent-green/20 transition-colors disabled:opacity-50"
        >
          {loading === "approve" ? "..." : "Accept"}
        </button>
        <button
          onClick={() => respond(false)}
          disabled={!!loading}
          className="flex-1 py-1.5 text-xs font-mono font-semibold bg-accent-red/10 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/20 transition-colors disabled:opacity-50"
        >
          {loading === "deny" ? "..." : "Reject"}
        </button>
      </div>
    </div>
  )
}
