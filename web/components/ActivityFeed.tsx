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

const typeStyles: Record<string, string> = {
  trade:              "text-accent-green",
  proposal:           "text-accent-amber",
  error:              "text-accent-red",
  guardrail_blocked:  "text-accent-red",
  job_start:          "text-text-muted",
  job_end:            "text-text-muted",
  tool_call:          "text-text-muted",
}

export function ActivityFeed({ className }: { className?: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [connected, setConnected] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

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
    <div className={["bg-surface rounded-lg border border-border", className].filter(Boolean).join(" ")}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">
          Agent Activity
        </h3>
        <span
          className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-accent-green" : "bg-border"}`}
          title={connected ? "Live" : "Connecting…"}
        />
      </div>

      <div ref={containerRef} className="overflow-y-auto max-h-72">
        {!connected && events.length === 0 ? (
          <p className="px-4 py-6 text-xs text-text-muted text-center font-mono">Connecting…</p>
        ) : connected && events.length === 0 ? (
          <p className="px-4 py-6 text-xs text-text-muted text-center font-mono">No activity yet today</p>
        ) : (
          <AnimatePresence initial={false}>
            {events.map((evt, i) => (
              <motion.div
                key={`${evt.ts}-${i}`}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className={[
                  "flex items-start gap-3 px-4 py-2 text-xs border-b border-border/40 last:border-0",
                  (evt.type === "guardrail_blocked" || evt.summary?.includes("GUARDRAIL BLOCKED"))
                    ? "bg-accent-red/5"
                    : "",
                ].join(" ")}
              >
                <span className="font-mono text-text-muted shrink-0 tabular-nums">
                  {formatTime(evt.ts)}
                </span>
                {evt.type === "guardrail_blocked" || evt.summary?.includes("GUARDRAIL BLOCKED") ? (
                  <span className="shrink-0 bg-accent-red/20 text-accent-red font-mono font-medium px-1.5 py-0.5 rounded text-[10px] uppercase">
                    Blocked
                  </span>
                ) : (
                  <span
                    className={[
                      "font-mono shrink-0",
                      typeStyles[evt.type] ?? "text-text-muted",
                    ].join(" ")}
                  >
                    {evt.tool ?? evt.type}
                  </span>
                )}
                {evt.symbol && (
                  <span className="font-mono text-text-primary shrink-0">{evt.symbol}</span>
                )}
                <span className={[
                  "leading-relaxed",
                  (evt.type === "guardrail_blocked" || evt.summary?.includes("GUARDRAIL BLOCKED"))
                    ? "text-accent-red"
                    : "text-text-muted",
                ].join(" ")}>{evt.summary}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}
