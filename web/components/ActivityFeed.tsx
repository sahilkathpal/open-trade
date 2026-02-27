"use client"

import { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"

interface ActivityEvent {
  ts: string
  type: string
  tool?: string
  symbol?: string
  summary: string
  dummy?: boolean
}

// Dummy events showing a realistic trading day — displayed when no live events yet
function makeDummyEvents(): ActivityEvent[] {
  const d = new Date()
  // Pin to today's date but fixed IST times
  function ist(h: number, m: number, s = 0): string {
    const dt = new Date(d)
    // IST = UTC+5:30; set UTC time so it lands at the right IST hour
    dt.setUTCHours(h - 5, m - 30, s, 0)
    return dt.toISOString()
  }

  return [
    // --- EOD wrap-up ---
    { ts: ist(15, 12), type: "trade",     symbol: "HDFCBANK",   summary: "SELL HDFCBANK ×15 @ ₹1,724 — MIS auto-exit (P&L: +₹435)" },
    { ts: ist(15, 11), type: "tool_call", tool: "exit_position", symbol: "HDFCBANK", summary: "Exiting HDFCBANK before MIS cutoff (3:10 PM)" },
    { ts: ist(15, 10), type: "tool_call", tool: "get_ltp",       symbol: "HDFCBANK", summary: "HDFCBANK LTP ₹1,724 · P&L +₹435 unrealized" },
    // --- Mid-day heartbeat ---
    { ts: ist(12, 45), type: "tool_call", tool: "get_positions",               summary: "Checking open positions: HDFCBANK ×15" },
    { ts: ist(12, 45), type: "tool_call", tool: "get_index_quote",              summary: "NIFTY 50: 23,814 (+0.4%) · BankNIFTY: 51,220 (+0.6%)" },
    { ts: ist(12, 44), type: "job_start",                                        summary: "Heartbeat — monitoring open positions" },
    // --- Morning trade ---
    { ts: ist(10, 2),  type: "trade",     symbol: "HDFCBANK",   summary: "BUY HDFCBANK ×15 @ ₹1,695 (MIS) — order confirmed" },
    { ts: ist(10, 1),  type: "proposal",  symbol: "HDFCBANK",   summary: "BUY HDFCBANK ×15 @ ₹1,695 approved by user" },
    { ts: ist(10, 0),  type: "proposal",  symbol: "HDFCBANK",   summary: "Proposing BUY HDFCBANK ×15 @ ₹1,695 — breakout above resistance" },
    { ts: ist(9, 58),  type: "tool_call", tool: "get_ltp",       symbol: "HDFCBANK", summary: "HDFCBANK at ₹1,696 — trigger condition met (> ₹1,692)" },
    { ts: ist(9, 35),  type: "tool_call", tool: "set_trigger",   symbol: "RELIANCE", summary: "Price trigger: alert if RELIANCE > ₹2,907 (5-min breakout)" },
    { ts: ist(9, 35),  type: "tool_call", tool: "set_trigger",   symbol: "HDFCBANK", summary: "Price trigger: alert if HDFCBANK > ₹1,692 with volume" },
    { ts: ist(9, 34),  type: "tool_call", tool: "add_to_watchlist", symbol: "HDFCBANK", summary: "Added HDFCBANK — consolidation near key resistance ₹1,692" },
    { ts: ist(9, 33),  type: "tool_call", tool: "add_to_watchlist", symbol: "RELIANCE", summary: "Added RELIANCE — gap-up 1.6%, strong sector momentum" },
    { ts: ist(9, 31),  type: "tool_call", tool: "get_ltp",       symbol: "HDFCBANK", summary: "HDFCBANK ₹1,688 · gap flat, watching resistance" },
    { ts: ist(9, 31),  type: "tool_call", tool: "get_ltp",       symbol: "RELIANCE", summary: "RELIANCE ₹2,902 · gap-up from ₹2,858 close" },
    // --- Pre-market ---
    { ts: ist(8, 51),  type: "job_end",                           summary: "Pre-market complete — 2 candidates, 2 triggers set" },
    { ts: ist(8, 50),  type: "tool_call", tool: "update_market_brief",          summary: "MARKET.md updated with today's macro + candidate list" },
    { ts: ist(8, 49),  type: "tool_call", tool: "get_index_quote",              summary: "NIFTY 50: 23,710 futures (+0.5%) · SGX signal: bullish open" },
    { ts: ist(8, 48),  type: "tool_call", tool: "search_candidates",            summary: "Scanning NIFTY 50 — filtering by overnight gap + volume" },
    { ts: ist(8, 47),  type: "job_start",                                        summary: "Pre-market screening started" },
  ].map((e) => ({ ...e, dummy: true }))
}

const DUMMY_EVENTS = makeDummyEvents()

const typeStyles: Record<string, string> = {
  trade:     "text-accent-green",
  proposal:  "text-accent-amber",
  error:     "text-accent-red",
  job_start: "text-text-muted",
  job_end:   "text-text-muted",
  tool_call: "text-text-muted",
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

  const displayEvents = events.length > 0 ? events : DUMMY_EVENTS
  const isDummy = events.length === 0

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
        <div className="flex items-center gap-2">
          {isDummy && (
            <span className="text-[10px] text-text-muted opacity-60">sample</span>
          )}
          <span
            className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-accent-green" : "bg-border"}`}
            title={connected ? "Live" : "Connecting…"}
          />
        </div>
      </div>

      <div ref={containerRef} className="overflow-y-auto max-h-72">
        <AnimatePresence initial={false}>
          {displayEvents.map((evt, i) => (
            <motion.div
              key={`${evt.ts}-${i}`}
              initial={isDummy ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className={[
                "flex items-start gap-3 px-4 py-2 text-xs border-b border-border/40 last:border-0",
                isDummy ? "opacity-50" : "",
              ].join(" ")}
            >
              <span className="font-mono text-text-muted shrink-0 tabular-nums">
                {formatTime(evt.ts)}
              </span>
              <span
                className={[
                  "font-mono shrink-0",
                  typeStyles[evt.type] ?? "text-text-muted",
                ].join(" ")}
              >
                {evt.tool ?? evt.type}
              </span>
              {evt.symbol && (
                <span className="font-mono text-text-primary shrink-0">{evt.symbol}</span>
              )}
              <span className="text-text-muted leading-relaxed">{evt.summary}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
