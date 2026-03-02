"use client"

import { useState } from "react"
import { ShieldCheck, Calendar, Bell, Zap, FileText } from "lucide-react"

export interface PermissionRequestItem {
  id: string
  tool: string
  inputs: Record<string, unknown>
  status: "pending" | "accepted" | "rejected"
}

// ── Cron → human readable ────────────────────────────────────────────────────

function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron
  const [min, hr, dom, month, dow] = parts
  if (dom !== "*" || month !== "*") return cron
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hr)) return cron
  const time = `${hr.padStart(2, "0")}:${min.padStart(2, "0")}`
  if (dow === "1-5") return `Weekdays · ${time}`
  if (dow === "0-6" || dow === "*") return `Daily · ${time}`
  return `${dow} · ${time}`
}

// ── Per-tool formatting ──────────────────────────────────────────────────────

type ToolFormat = {
  icon: React.ReactNode
  ask: string          // headline: what Claude is asking permission to do
  spec: string         // the specific action/name/target
  meta?: string        // timing or condition chip
  reason?: string      // why (expandable)
  detail?: string      // full content (expandable)
}

function formatTool(tool: string, inputs: Record<string, unknown>): ToolFormat {
  if (tool === "write_schedule") {
    const reason = String(inputs.reason ?? "")
    const cron = String(inputs.cron ?? "")
    const prompt = inputs.prompt ? String(inputs.prompt) : undefined
    const label = reason.split(":")[0] || String(inputs.id ?? "New job")
    return {
      icon: <Calendar size={14} className="text-accent-amber shrink-0" />,
      ask: "Claude wants to create a recurring job",
      spec: label,
      meta: cronToHuman(cron),
      reason: reason || undefined,
      detail: prompt,
    }
  }

  if (tool === "write_trigger") {
    const type = String(inputs.type ?? "")
    const mode = String(inputs.mode ?? "soft")
    const action = inputs.action ? String(inputs.action) : null
    const reason = String(inputs.reason ?? "")
    const symbol = inputs.symbol ? String(inputs.symbol) : null
    const at = inputs.at ? String(inputs.at) : null
    const threshold = inputs.threshold as number | undefined
    const bufferPct = inputs.buffer_pct as number | undefined

    if (mode === "hard") {
      if (action === "exit_all") {
        return {
          icon: <Zap size={14} className="text-accent-red shrink-0" />,
          ask: "Claude wants to set an automatic exit rule",
          spec: "Exit all positions",
          meta: at ? `at ${at} IST` : undefined,
          reason: reason || undefined,
        }
      }
      return {
        icon: <Zap size={14} className="text-accent-amber shrink-0" />,
        ask: "Claude wants to set an automatic action",
        spec: action ?? type,
        meta: at ? `at ${at} IST` : symbol ? `on ${symbol}` : undefined,
        reason: reason || undefined,
      }
    }

    // Soft monitor trigger
    const conditionLabels: Record<string, string> = {
      near_stop:     symbol ? `${symbol} within ${bufferPct ?? "?"}% of stop` : "Near stop",
      near_target:   symbol ? `${symbol} within ${bufferPct ?? "?"}% of target` : "Near target",
      price_above:   symbol && threshold != null ? `${symbol} ≥ ₹${threshold}` : "Price trigger",
      price_below:   symbol && threshold != null ? `${symbol} ≤ ₹${threshold}` : "Price trigger",
      time:          at ? `at ${at} IST` : "Time trigger",
      day_pnl_above: threshold != null ? `Day P&L ≥ ₹${threshold}` : "P&L trigger",
      day_pnl_below: threshold != null ? `Day P&L ≤ ₹${threshold}` : "P&L trigger",
    }
    return {
      icon: <Bell size={14} className="text-accent-amber shrink-0" />,
      ask: "Claude wants to set a price monitor",
      spec: conditionLabels[type] ?? type,
      reason: reason || undefined,
    }
  }

  if (tool === "write_memory") {
    const filename = String(inputs.filename ?? "memory")
    const content = inputs.content ? String(inputs.content) : undefined
    return {
      icon: <FileText size={14} className="text-accent-amber shrink-0" />,
      ask: "Claude wants to update your strategy playbook",
      spec: filename,
      detail: content,
    }
  }

  // Generic fallback
  const label = tool.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  return {
    icon: <ShieldCheck size={14} className="text-accent-amber shrink-0" />,
    ask: "Claude is requesting an action",
    spec: label,
    detail: JSON.stringify(inputs, null, 2),
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function PermissionCard({
  request,
  onRespond,
}: {
  request: PermissionRequestItem
  onRespond: (id: string, approved: boolean) => void
}) {
  const [showDetail, setShowDetail] = useState(false)
  const { icon, ask, spec, meta, reason, detail } = formatTool(request.tool, request.inputs)
  const isPending = request.status === "pending"
  return (
    <div className="flex justify-start">
      <div className="bg-surface border border-accent-amber/30 border-l-2 border-l-accent-amber rounded-xl px-4 py-3 max-w-lg w-full">

        {/* Ask — what Claude wants to do */}
        <div className="flex items-center gap-2 mb-2.5">
          {icon}
          <span className="text-sm font-medium text-text-primary">{ask}</span>
        </div>

        {/* Spec + meta — the specific action */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-text-secondary font-mono bg-background border border-border rounded px-2 py-0.5">
            {spec}
          </span>
          {meta && (
            <span className="text-[10px] text-text-muted border border-border rounded px-1.5 py-0.5">
              {meta}
            </span>
          )}
        </div>

        {/* Reason — always visible */}
        {reason && (
          <p className="text-xs text-text-muted leading-relaxed mb-3">{reason}</p>
        )}

        {/* Full content — expandable */}
        {detail && (
          <div className="mb-3">
            <button
              onClick={() => setShowDetail((v) => !v)}
              className="text-[11px] text-text-muted hover:text-text-primary transition-colors"
            >
              {showDetail ? "Hide full content ↑" : "Show full content ↓"}
            </button>
            {showDetail && (
              <pre className="mt-2 text-[11px] text-text-muted bg-background rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {detail}
              </pre>
            )}
          </div>
        )}

        {/* Actions */}
        {isPending ? (
          <div className="flex gap-2">
            <button
              onClick={() => onRespond(request.id, true)}
              className="px-3 py-1.5 text-xs font-medium bg-accent-green/20 text-accent-green border border-accent-green/30 rounded-lg hover:bg-accent-green/30 transition-colors"
            >
              Accept
            </button>
            <button
              onClick={() => onRespond(request.id, false)}
              className="px-3 py-1.5 text-xs font-medium text-text-muted border border-border rounded-lg hover:border-accent-red/40 hover:text-accent-red transition-colors"
            >
              Reject
            </button>
          </div>
        ) : (
          <span className={`text-xs font-medium ${request.status === "accepted" ? "text-accent-green" : "text-accent-red"}`}>
            {request.status === "accepted" ? "Accepted" : "Rejected"}
          </span>
        )}
      </div>
    </div>
  )
}
