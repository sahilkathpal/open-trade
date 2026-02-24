"use client"

import { useEffect, useState } from "react"
import { MarkdownRenderer } from "@/components/MarkdownRenderer"

export default function StrategyPage() {
  const [content, setContent] = useState<string>("")
  const [lastModified, setLastModified] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    fetchStrategy()
  }, [])

  async function fetchStrategy() {
    try {
      setLoading(true)
      const res = await fetch("/api/memory/STRATEGY.md")
      if (!res.ok) throw new Error("fetch failed")
      const data = await res.json()
      setContent(data.content)
      setLastModified(data.last_modified || "")
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  async function runEod() {
    setRunning(true)
    try {
      await fetch("/api/run/eod", { method: "POST" })
      setTimeout(fetchStrategy, 3000)
    } catch {
      // ignore
    } finally {
      setRunning(false)
    }
  }

  if (loading) return <div className="text-text-muted text-center py-12">Loading strategy...</div>
  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-accent-red mb-2">Failed to load strategy</div>
        <p className="text-text-muted text-sm">Could not fetch STRATEGY.md from the API</p>
      </div>
    )
  }

  const modifiedStr = lastModified
    ? new Date(lastModified).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : "Unknown"

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Strategy</h1>
          <p className="text-text-muted text-sm">Last updated: {modifiedStr}</p>
        </div>
        <button
          onClick={runEod}
          disabled={running}
          className="px-4 py-2 rounded-md bg-accent-amber/20 text-accent-amber text-sm font-medium hover:bg-accent-amber/30 transition-colors disabled:opacity-50"
        >
          {running ? "Running..." : "Run EOD"}
        </button>
      </div>

      <div className="bg-surface rounded-lg border border-border p-6">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  )
}
