"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { SlidePanel } from "@/components/SlidePanel"

interface ActivityEvent {
  ts: string
  type: string
  tool?: string
  symbol?: string
  summary: string
}

const typeColors: Record<string, string> = {
  tool_call: "text-text-muted",
  job_start: "text-accent-amber",
  job_end: "text-accent-green",
  proposal: "text-accent-amber",
  trade: "text-accent-green",
  error: "text-accent-red",
  ping: "text-border",
}

const typeLabels: Record<string, string> = {
  tool_call: "tool",
  job_start: "start",
  job_end: "done",
  proposal: "proposal",
  trade: "trade",
  error: "error",
}

interface ActivityPanelProps {
  open: boolean
  onClose: () => void
}

export function ActivityPanel({ open, onClose }: ActivityPanelProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let es: EventSource | null = null

    function connect() {
      es = new EventSource("/api/activity")
      es.onopen = () => setConnected(true)
      es.onmessage = (event) => {
        try {
          const data: ActivityEvent = JSON.parse(event.data)
          if (data.type === "ping") return
          setEvents((prev) => [data, ...prev].slice(0, 100))
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
    <SlidePanel
      open={open}
      onClose={onClose}
      title="Agent Activity"
      width="w-[480px]"
    >
      {/* Connection status note */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <p className="text-text-muted text-xs leading-relaxed">
          Live feed of your agent&apos;s autonomous actions — heartbeat checks, tool calls,
          trades, and job completions.
        </p>
        <span
          className={`ml-3 w-2 h-2 rounded-full shrink-0 ${
            connected ? "bg-accent-green" : "bg-accent-red"
          }`}
        />
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto p-4">
        {events.length === 0 ? (
          <p className="text-text-muted text-sm text-center py-12">No activity yet</p>
        ) : (
          <div className="space-y-0.5">
            <AnimatePresence initial={false}>
              {events.map((evt, i) => (
                <motion.div
                  key={`${evt.ts}-${i}`}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-3 py-2 border-b border-border/40 last:border-0"
                >
                  <span className="font-mono text-[11px] text-text-muted shrink-0 pt-0.5">
                    {formatTime(evt.ts)}
                  </span>
                  <span
                    className={`font-mono text-[11px] shrink-0 pt-0.5 uppercase tracking-wider ${
                      typeColors[evt.type] ?? "text-text-muted"
                    }`}
                  >
                    {typeLabels[evt.type] ?? evt.type}
                  </span>
                  <span className="text-xs text-text-muted font-mono truncate">
                    {evt.tool && (
                      <span className="text-accent-amber mr-1.5">{evt.tool}</span>
                    )}
                    {evt.summary}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </SlidePanel>
  )
}
