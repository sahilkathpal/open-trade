"use client"

import { X } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"

interface SlidePanelProps {
  open: boolean
  onClose: () => void
  title: string
  width?: string
  children: React.ReactNode
}

export function SlidePanel({
  open,
  onClose,
  title,
  width = "w-[480px]",
  children,
}: SlidePanelProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.2 }}
            className={`fixed right-0 top-0 h-full bg-surface border-l border-border flex flex-col shadow-2xl z-50 ${width}`}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-border shrink-0">
              <h2 className="text-sm font-medium text-text-primary">{title}</h2>
              <button
                onClick={onClose}
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
