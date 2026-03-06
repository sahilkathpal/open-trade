"use client"

import { useState } from "react"
import { TrendingUp } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { StrategyProposalItem } from "@/lib/types"

export function StrategyProposalCard({
  proposal,
  onRespond,
}: {
  proposal: StrategyProposalItem
  onRespond: (id: string, approved: boolean) => void
}) {
  const [showThesis, setShowThesis] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const { inputs } = proposal
  const isPending = proposal.status === "pending"
  const alloc = inputs.capital_allocation ?? 0
  const riskPct = inputs.risk_config?.max_risk_per_trade_pct ?? 2
  const maxPos = inputs.risk_config?.max_open_positions ?? 2

  return (
    <div className="flex justify-start">
      <div className="bg-surface border border-accent-green/30 border-l-2 border-l-accent-green rounded-xl px-4 py-3 max-w-lg w-full">

        {/* Header */}
        <div className="flex items-center gap-2 mb-2.5">
          <TrendingUp size={14} className="text-accent-green shrink-0" />
          <span className="text-sm font-medium text-text-primary">New strategy proposal</span>
        </div>

        {/* Strategy name */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-mono bg-background border border-border rounded px-2 py-0.5 text-text-secondary">
            {inputs.name}
          </span>
          <span className="text-[10px] text-text-muted border border-border rounded px-1.5 py-0.5">
            {inputs.id}
          </span>
        </div>

        {/* Capital allocation + risk config */}
        <div className="flex gap-2 mb-3 flex-wrap">
          {alloc > 0 && (
            <span className="text-[11px] text-text-muted border border-border rounded px-1.5 py-0.5 font-mono">
              ₹{alloc.toLocaleString("en-IN")} allocated
            </span>
          )}
          <span className="text-[11px] text-text-muted border border-border rounded px-1.5 py-0.5 font-mono">
            {riskPct}% max risk/trade
          </span>
          <span className="text-[11px] text-text-muted border border-border rounded px-1.5 py-0.5 font-mono">
            max {maxPos} positions
          </span>
        </div>

        {/* Thesis — expandable */}
        {inputs.thesis && (
          <div className="mb-2">
            <button
              onClick={() => setShowThesis((v) => !v)}
              className="text-[11px] text-text-muted hover:text-text-primary transition-colors"
            >
              {showThesis ? "Hide thesis ↑" : "Show thesis ↓"}
            </button>
            {showThesis && (
              <pre className="mt-2 text-[11px] text-text-muted bg-background rounded p-2 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {inputs.thesis}
              </pre>
            )}
          </div>
        )}

        {/* Rules — expandable */}
        {inputs.rules && (
          <div className="mb-3">
            <button
              onClick={() => setShowRules((v) => !v)}
              className="text-[11px] text-text-muted hover:text-text-primary transition-colors"
            >
              {showRules ? "Hide rules ↑" : "Show rules ↓"}
            </button>
            {showRules && (
              <pre className="mt-2 text-[11px] text-text-muted bg-background rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {inputs.rules}
              </pre>
            )}
          </div>
        )}

        {/* Actions */}
        {isPending ? (
          <div className="flex gap-2">
            <button
              onClick={() => onRespond(proposal.id, true)}
              className="px-3 py-1.5 text-xs font-medium bg-accent-green/20 text-accent-green border border-accent-green/30 rounded-lg hover:bg-accent-green/30 transition-colors"
            >
              Create Strategy
            </button>
            <button
              onClick={() => onRespond(proposal.id, false)}
              className="px-3 py-1.5 text-xs font-medium text-text-muted border border-border rounded-lg hover:border-accent-red/40 hover:text-accent-red transition-colors"
            >
              Reject
            </button>
          </div>
        ) : (
          <span className={`text-xs font-medium ${proposal.status === "accepted" ? "text-accent-green" : "text-accent-red"}`}>
            {proposal.status === "accepted" ? "Strategy created" : "Rejected"}
          </span>
        )}
      </div>
    </div>
  )
}


// Hook for responding to a strategy proposal via the API
export function useStrategyProposalResponder(authFetch: ReturnType<typeof useAuth>["authFetch"]) {
  return async (approvalId: string, approved: boolean): Promise<boolean> => {
    try {
      const res = await authFetch(`/api/approvals/${approvalId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      })
      if (!res.ok) return false
      if (approved) {
        window.dispatchEvent(new CustomEvent("strategies-updated"))
      }
      return true
    } catch {
      return false
    }
  }
}
