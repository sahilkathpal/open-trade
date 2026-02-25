"use client"

import clsx from "clsx"

interface TokenUsage {
  input_tokens: number
  output_tokens: number
  api_calls: number
  cost_usd: number
  by_job: Record<string, { input: number; output: number; calls: number }>
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toString()
}

const JOB_LABELS: Record<string, string> = {
  premarket: "Pre-market",
  execution: "Execution",
  heartbeat: "Heartbeat",
  eod: "EOD",
}

export function TokenUsageCard({ usage }: { usage: TokenUsage }) {
  const totalTokens = usage.input_tokens + usage.output_tokens
  const costINR = usage.cost_usd * 85 // rough USD→INR

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">
          LLM Token Usage Today
        </h3>
        <span className="font-mono text-sm text-text-primary">
          ${usage.cost_usd.toFixed(2)}{" "}
          <span className="text-text-muted text-xs">(~₹{costINR.toFixed(0)})</span>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <div className="text-text-muted text-xs">Input</div>
          <div className="font-mono text-sm text-text-primary">{formatTokens(usage.input_tokens)}</div>
        </div>
        <div>
          <div className="text-text-muted text-xs">Output</div>
          <div className="font-mono text-sm text-text-primary">{formatTokens(usage.output_tokens)}</div>
        </div>
        <div>
          <div className="text-text-muted text-xs">API calls</div>
          <div className="font-mono text-sm text-text-primary">{usage.api_calls}</div>
        </div>
      </div>

      {/* Per-job breakdown */}
      {Object.keys(usage.by_job).length > 0 && (
        <div className="border-t border-border pt-2 space-y-1">
          {Object.entries(usage.by_job).map(([job, data]) => {
            const jobTotal = data.input + data.output
            const pct = totalTokens > 0 ? (jobTotal / totalTokens) * 100 : 0
            return (
              <div key={job} className="flex items-center justify-between text-xs">
                <span className="text-text-muted">{JOB_LABELS[job] || job}</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 bg-border rounded-full overflow-hidden">
                    <div
                      className={clsx("h-full rounded-full", {
                        "bg-accent-green": job === "premarket" || job === "execution",
                        "bg-accent-amber": job === "heartbeat",
                        "bg-blue-400": job === "eod",
                      })}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="font-mono text-text-muted w-12 text-right">
                    {formatTokens(jobTotal)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {totalTokens === 0 && (
        <div className="text-text-muted text-xs text-center py-1">No API calls today</div>
      )}
    </div>
  )
}
