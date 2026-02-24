"use client"

import { useEffect, useState } from "react"
import { MarkdownRenderer } from "@/components/MarkdownRenderer"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

interface TradeEntry {
  raw: string
  pnl: number | null
  r: number | null
}

function parseTrades(content: string): TradeEntry[] {
  if (!content.trim()) return []
  const sections = content.split(/---+/).filter((s) => s.trim())
  return sections.map((raw) => {
    const pnlMatch = raw.match(/P&?L[:\s]*[^₹\d-]*([-₹\d,.]+)/i)
    const rMatch = raw.match(/(\d+\.?\d*)R\b/i)
    let pnl: number | null = null
    if (pnlMatch) {
      const cleaned = pnlMatch[1].replace(/[₹,]/g, "")
      pnl = parseFloat(cleaned)
      if (isNaN(pnl)) pnl = null
    }
    return {
      raw: raw.trim(),
      pnl,
      r: rMatch ? parseFloat(rMatch[1]) : null,
    }
  })
}

export default function JournalPage() {
  const [content, setContent] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function fetch_journal() {
      try {
        const res = await fetch("http://localhost:8000/api/memory/JOURNAL.md")
        if (!res.ok) throw new Error("fetch failed")
        const data = await res.json()
        setContent(data.content)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    fetch_journal()
  }, [])

  if (loading) return <div className="text-text-muted text-center py-12">Loading journal...</div>
  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-accent-red mb-2">Failed to load journal</div>
        <p className="text-text-muted text-sm">Could not fetch JOURNAL.md from the API</p>
      </div>
    )
  }

  const trades = parseTrades(content)
  const tradesWithPnl = trades.filter((t) => t.pnl !== null)
  const totalPnl = tradesWithPnl.reduce((s, t) => s + (t.pnl || 0), 0)
  const winRate =
    tradesWithPnl.length > 0
      ? (tradesWithPnl.filter((t) => (t.pnl || 0) > 0).length / tradesWithPnl.length) * 100
      : 0
  const tradesWithR = trades.filter((t) => t.r !== null)
  const avgR =
    tradesWithR.length > 0
      ? tradesWithR.reduce((s, t) => s + (t.r || 0), 0) / tradesWithR.length
      : 0

  // Cumulative P&L chart data
  let cumPnl = 0
  const chartData = tradesWithPnl.map((t, i) => {
    cumPnl += t.pnl || 0
    return { trade: i + 1, pnl: cumPnl }
  })

  if (trades.length === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-xl font-semibold text-text-primary mb-6">Trade Journal</h1>
        <div className="bg-surface rounded-lg border border-border p-12 text-center">
          <p className="text-text-muted">No trades yet. Come back after your first trade.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Trade Journal</h1>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-text-muted text-xs uppercase tracking-wider mb-1">Total P&L</div>
          <div className={`font-mono text-2xl ${totalPnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
            {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(totalPnl)}
          </div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-text-muted text-xs uppercase tracking-wider mb-1">Win Rate</div>
          <div className="font-mono text-2xl text-text-primary">{winRate.toFixed(1)}%</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-text-muted text-xs uppercase tracking-wider mb-1">Avg R</div>
          <div className="font-mono text-2xl text-text-primary">{avgR.toFixed(2)}R</div>
        </div>
      </div>

      {/* Cumulative P&L chart */}
      {chartData.length > 0 && (
        <div className="bg-surface rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">
            Cumulative P&L
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363D" />
              <XAxis dataKey="trade" stroke="#8B949E" fontSize={12} />
              <YAxis stroke="#8B949E" fontSize={12} />
              <Tooltip
                contentStyle={{ backgroundColor: "#161B22", border: "1px solid #30363D", borderRadius: "6px" }}
                labelStyle={{ color: "#8B949E" }}
              />
              <Line type="monotone" dataKey="pnl" stroke="#3FB950" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Trade list */}
      <div className="space-y-4">
        {trades.map((trade, i) => (
          <div key={i} className="bg-surface rounded-lg border border-border p-4">
            <MarkdownRenderer content={trade.raw} />
          </div>
        ))}
      </div>
    </div>
  )
}
