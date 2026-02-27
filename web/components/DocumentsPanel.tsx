"use client"

import { useEffect, useState, useCallback } from "react"
import { FileText, RefreshCw, ChevronLeft } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { STRATEGY_CONFIGS, StrategyDocument } from "@/lib/types"
import { MarkdownRenderer } from "@/components/MarkdownRenderer"
import { SlidePanel } from "@/components/SlidePanel"

interface DocumentsPanelProps {
  open: boolean
  onClose: () => void
  strategy: string
}

export function DocumentsPanel({ open, onClose, strategy }: DocumentsPanelProps) {
  const { authFetch } = useAuth()
  const config = STRATEGY_CONFIGS[strategy]
  const documents: StrategyDocument[] = config?.documents ?? []

  const [selectedDoc, setSelectedDoc] = useState<StrategyDocument | null>(null)
  const [content, setContent] = useState<string>("")
  const [lastModified, setLastModified] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Reset when panel closes
  useEffect(() => {
    if (!open) {
      setSelectedDoc(null)
      setContent("")
      setLastModified("")
    }
  }, [open])

  const fetchDocument = useCallback(
    async (doc: StrategyDocument) => {
      setLoading(true)
      setErrorMsg(null)
      setContent("")
      try {
        const res = await authFetch(`/api/memory/${doc.file}`)
        if (!res.ok) {
          setErrorMsg("No content yet. Claude will write this document as it starts trading.")
          return
        }
        const text = await res.text()
        // API may return JSON { content, last_modified } or raw text
        try {
          const json = JSON.parse(text)
          setContent(json.content ?? "")
          setLastModified(json.last_modified ?? "")
        } catch {
          setContent(text)
        }
      } catch {
        setErrorMsg("No content yet. Claude will write this document as it starts trading.")
      } finally {
        setLoading(false)
      }
    },
    [authFetch]
  )

  const handleSelectDoc = useCallback(
    (doc: StrategyDocument) => {
      setSelectedDoc(doc)
      fetchDocument(doc)
    },
    [fetchDocument]
  )

  // When in document view, Escape backs to list; SlidePanel handles Escape → onClose
  const handleClose = useCallback(() => {
    if (selectedDoc) {
      setSelectedDoc(null)
    } else {
      onClose()
    }
  }, [selectedDoc, onClose])

  const modifiedStr = lastModified
    ? new Date(lastModified).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
        hour12: false,
      })
    : null

  const panelTitle = selectedDoc ? selectedDoc.title : "Strategy Documents"

  return (
    <SlidePanel
      open={open}
      onClose={handleClose}
      title={panelTitle}
      width="w-[640px]"
    >
      {!selectedDoc ? (
        /* Document list */
        <div className="p-4 space-y-3">
          {documents.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-12">
              No documents yet. Claude will create strategy-specific documents as it starts working.
            </p>
          ) : (
            documents.map((doc) => (
              <div
                key={doc.id}
                className="bg-background rounded-lg border border-border p-4 flex items-start justify-between gap-4"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <FileText size={15} className="text-text-muted shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary mb-0.5">
                      {doc.title}
                    </div>
                    <div className="text-xs text-text-muted leading-relaxed">
                      {doc.description}
                    </div>
                    <div className="text-[11px] font-mono text-text-muted mt-1.5 opacity-60">
                      {doc.file}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleSelectDoc(doc)}
                  className="shrink-0 bg-accent-green text-black text-xs font-semibold px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
                >
                  View
                </button>
              </div>
            ))
          )}
        </div>
      ) : (
        /* Document viewer */
        <div className="flex flex-col h-full">
          {/* Back + metadata bar */}
          <div className="px-4 py-3 border-b border-border shrink-0">
            <button
              onClick={() => setSelectedDoc(null)}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors mb-3"
            >
              <ChevronLeft size={14} />
              Back to documents
            </button>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-text-primary">{selectedDoc.title}</h3>
                <p className="text-[11px] font-mono text-text-muted mt-0.5">
                  {selectedDoc.file}
                  {modifiedStr && <span className="ml-2">· Last updated: {modifiedStr}</span>}
                </p>
              </div>
              {!loading && (
                <button
                  onClick={() => fetchDocument(selectedDoc)}
                  className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
                  title="Refresh"
                >
                  <RefreshCw size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <span className="text-text-muted text-sm font-mono">Loading...</span>
              </div>
            ) : errorMsg ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                <FileText size={32} className="text-border" />
                <p className="text-text-muted text-sm">{errorMsg}</p>
              </div>
            ) : !content.trim() ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                <FileText size={32} className="text-border" />
                <p className="text-text-muted text-sm">No content yet.</p>
                <p className="text-text-muted text-xs max-w-xs">
                  The agent will write to this file as it runs sessions.
                </p>
              </div>
            ) : (
              <MarkdownRenderer content={content} />
            )}
          </div>
        </div>
      )}
    </SlidePanel>
  )
}
