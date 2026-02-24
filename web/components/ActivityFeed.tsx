"use client"

import { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"

interface ActivityEvent {
  ts: string
  type: string
  tool?: string
  symbol?: string
  summary: string
}

const typeIcons: Record<string, string> = {
  tool_call: "\uD83D\uDD0D",
  job_start: "\u26A1",
  job_end: "\u2705",
  proposal: "\uD83D\uDCCA",
  trade: "\uD83D\uDCB8",
  error: "\u274C",
  ping: "\uD83D\uDFE2",
}

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [connected, setConnected] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let es: EventSource | null = null

    function connect() {
      es = new EventSource("http://localhost:8000/api/activity")

      es.onopen = () => setConnected(true)

      es.onmessage = (event) => {
        try {
          const data: ActivityEvent = JSON.parse(event.data)
          setEvents((prev) => [data, ...prev].slice(0, 50))
        } catch {
          // skip malformed events
        }
      }

      es.onerror = () => {
        setConnected(false)
        es?.close()
        setTimeout(connect, 5000)
      }
    }

    connect()
    return () => es?.close()
  }, [])

  function formatTime(ts: string) {
    return new Date(ts).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    })
  }

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-text-primary">Activity Feed</h3>
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-accent-green" : "bg-accent-red"}`} />
      </div>
      <div ref={containerRef} className="h-80 overflow-y-auto space-y-1">
        {events.length === 0 && (
          <p className="text-text-muted text-sm text-center py-8">No activity yet</p>
        )}
        <AnimatePresence initial={false}>
          {events.map((evt, i) => (
            <motion.div
              key={`${evt.ts}-${i}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2 text-xs py-1.5 border-b border-border/50 last:border-0"
            >
              <span className="font-mono text-text-muted shrink-0">{formatTime(evt.ts)}</span>
              <span className="shrink-0">{typeIcons[evt.type] || "\u2022"}</span>
              <span className="font-mono text-accent-amber shrink-0">{evt.tool || evt.type}</span>
              <span className="text-text-muted truncate">{evt.summary}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
