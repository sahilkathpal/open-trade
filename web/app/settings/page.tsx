"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, ExternalLink } from "lucide-react"
import QRCode from "react-qr-code"
import { useAuth } from "@/lib/auth"

interface Settings {
  dhan_client_id?: string
  dhan_access_token_set?: boolean
  dhan_token_updated_at?: string
  seed_capital?: number
  daily_loss_limit?: number
  max_open_positions?: number
  strategy_allocations?: Record<string, number>
  autonomous?: boolean
  telegram_connected?: boolean
  telegram_username?: string
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-6">
      <h2 className="font-mono text-sm font-semibold text-text-primary uppercase tracking-wider mb-5">
        {title}
      </h2>
      {children}
    </div>
  )
}

function SaveButton({ onClick, loading, saved }: { onClick: () => void; loading: boolean; saved: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="mt-4 px-4 py-2 bg-accent-green text-background font-mono font-semibold text-sm rounded-md hover:bg-accent-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? "Saving..." : saved ? "Saved" : "Save"}
    </button>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const { authFetch, loading: authLoading, user } = useAuth()

  const [settings, setSettings] = useState<Settings>({})
  const [loadError, setLoadError] = useState<string | null>(null)

  // Broker section
  const [dhanClientId, setDhanClientId] = useState("")
  const [dhanToken, setDhanToken] = useState("")
  const [showToken, setShowToken] = useState(false)
  const [brokerSaving, setBrokerSaving] = useState(false)
  const [brokerSaved, setBrokerSaved] = useState(false)
  const [brokerError, setBrokerError] = useState<string | null>(null)
  const [brokerDisconnecting, setBrokerDisconnecting] = useState(false)

  // Risk section
  const [seedCapital, setSeedCapital] = useState(10000)
  const [dailyLossLimit, setDailyLossLimit] = useState(500)
  const [maxPositions, setMaxPositions] = useState(2)
  const [allocations, setAllocations] = useState<Record<string, number>>({})
  const [settingsStrategies, setSettingsStrategies] = useState<{id: string; name: string; status: string}[]>([])
  const [riskSaving, setRiskSaving] = useState(false)
  const [riskSaved, setRiskSaved] = useState(false)
  const [riskError, setRiskError] = useState<string | null>(null)

  // Autonomous section
  const [autonomous, setAutonomous] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [autonomousSaving, setAutonomousSaving] = useState(false)
  const [autonomousError, setAutonomousError] = useState<string | null>(null)

  // Telegram section
  const [telegramConnected, setTelegramConnected] = useState(false)
  const [telegramUsername, setTelegramUsername] = useState("")
  const [deepLink, setDeepLink] = useState<string | null>(null)
  const [deepLinkExpiry, setDeepLinkExpiry] = useState(0)
  const [telegramConnecting, setTelegramConnecting] = useState(false)
  const [telegramError, setTelegramError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadSettings = useCallback(async () => {
    try {
      const res = await authFetch("/api/settings")
      if (res.status === 401) {
        router.push("/login")
        return
      }
      if (!res.ok) throw new Error("Failed to load settings")
      const data: Settings = await res.json()
      setSettings(data)
      setDhanClientId(data.dhan_client_id ?? "")
      setSeedCapital(data.seed_capital ?? 10000)
      setDailyLossLimit(Math.abs(data.daily_loss_limit ?? 500))
      setMaxPositions(data.max_open_positions ?? 2)
      setAllocations(data.strategy_allocations ?? {})
      setAutonomous(data.autonomous ?? false)
      // Fetch strategies for dynamic allocation fields
      try {
        const sr = await authFetch("/api/strategies")
        if (sr.ok) setSettingsStrategies(await sr.json())
      } catch { /* silent */ }
      setTelegramConnected(data.telegram_connected ?? false)
      setTelegramUsername(data.telegram_username ?? "")
    } catch {
      setLoadError("Failed to load settings")
    }
  }, [authFetch, router])

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.push("/login")
      } else {
        loadSettings()
      }
    }
  }, [authLoading, user, router, loadSettings])

  // Token expiry display
  const tokenHoursAgo = settings.dhan_token_updated_at
    ? Math.floor((Date.now() - new Date(settings.dhan_token_updated_at).getTime()) / 3600000)
    : null

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  const disconnectBroker = async () => {
    setBrokerDisconnecting(true)
    setBrokerError(null)
    try {
      const res = await authFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dhan_client_id: "", dhan_access_token: "" }),
      })
      if (res.status === 401) { router.push("/login"); return }
      if (!res.ok) throw new Error("Disconnect failed")
      setDhanClientId("")
      setDhanToken("")
      await loadSettings()
    } catch {
      setBrokerError("Failed to disconnect broker")
    } finally {
      setBrokerDisconnecting(false)
    }
  }

  const saveBroker = async () => {
    setBrokerSaving(true)
    setBrokerError(null)
    setBrokerSaved(false)
    try {
      const body: Record<string, string> = { dhan_client_id: dhanClientId }
      if (dhanToken) body.dhan_access_token = dhanToken
      const res = await authFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.status === 401) { router.push("/login"); return }
      if (!res.ok) throw new Error("Save failed")
      setBrokerSaved(true)
      await loadSettings()
      setTimeout(() => setBrokerSaved(false), 3000)
    } catch {
      setBrokerError("Failed to save broker settings")
    } finally {
      setBrokerSaving(false)
    }
  }

  const saveRisk = async () => {
    const totalAllocated = Object.values(allocations).reduce((s, v) => s + (v || 0), 0)
    if (totalAllocated > seedCapital) {
      setRiskError(`Total allocated (₹${totalAllocated.toLocaleString("en-IN")}) exceeds total capital (₹${seedCapital.toLocaleString("en-IN")})`)
      return
    }
    setRiskSaving(true)
    setRiskError(null)
    setRiskSaved(false)
    try {
      const strategy_allocations = Object.fromEntries(
        Object.entries(allocations).filter(([, v]) => v > 0)
      )
      const res = await authFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seed_capital: seedCapital,
          daily_loss_limit: -Math.abs(dailyLossLimit),
          max_open_positions: maxPositions,
          strategy_allocations,
        }),
      })
      if (res.status === 401) { router.push("/login"); return }
      if (!res.ok) throw new Error("Save failed")
      setRiskSaved(true)
      setTimeout(() => setRiskSaved(false), 3000)
    } catch {
      setRiskError("Failed to save risk settings")
    } finally {
      setRiskSaving(false)
    }
  }

  const saveAutonomous = async (value: boolean) => {
    setAutonomousSaving(true)
    setAutonomousError(null)
    try {
      const res = await authFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autonomous: value }),
      })
      if (res.status === 401) { router.push("/login"); return }
      if (!res.ok) throw new Error("Save failed")
      setAutonomous(value)
    } catch {
      setAutonomousError("Failed to save autonomous setting")
    } finally {
      setAutonomousSaving(false)
    }
  }

  const handleAutonomousToggle = () => {
    if (!autonomous) {
      setShowConfirmModal(true)
    } else {
      saveAutonomous(false)
    }
  }

  const connectTelegram = async () => {
    setTelegramConnecting(true)
    setTelegramError(null)
    setDeepLink(null)
    try {
      const res = await authFetch("/api/telegram/connect", { method: "POST" })
      if (res.status === 401) { router.push("/login"); return }
      if (!res.ok) throw new Error("Failed to get Telegram link")
      const data: { deep_link: string; expires_in_seconds: number } = await res.json()
      setDeepLink(data.deep_link)
      setDeepLinkExpiry(data.expires_in_seconds)

      // Countdown timer
      if (countdownRef.current) clearInterval(countdownRef.current)
      countdownRef.current = setInterval(() => {
        setDeepLinkExpiry((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)

      // Poll for connection
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await authFetch("/api/settings")
          if (pollRes.ok) {
            const pollData: Settings = await pollRes.json()
            if (pollData.telegram_connected) {
              setTelegramConnected(true)
              setTelegramUsername(pollData.telegram_username ?? "")
              setDeepLink(null)
              if (pollRef.current) clearInterval(pollRef.current)
              if (countdownRef.current) clearInterval(countdownRef.current)
            }
          }
        } catch {
          // ignore poll errors
        }
      }, 5000)
    } catch {
      setTelegramError("Failed to generate Telegram link")
    } finally {
      setTelegramConnecting(false)
    }
  }

  const disconnectTelegram = async () => {
    try {
      const res = await authFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_connected: false, telegram_username: null }),
      })
      if (res.status === 401) { router.push("/login"); return }
      if (res.ok) {
        setTelegramConnected(false)
        setTelegramUsername("")
      }
    } catch {
      setTelegramError("Failed to disconnect Telegram")
    }
  }

  const minutesRemaining = Math.ceil(deepLinkExpiry / 60)

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-text-muted font-mono text-sm">Loading...</div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-accent-red font-mono text-sm">{loadError}</div>
      </div>
    )
  }

  return (
    <>
      {/* Autonomous confirm modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="font-mono text-base font-semibold text-text-primary mb-3">
              Enable Autonomous Trading?
            </h3>
            <p className="text-text-muted text-sm mb-6 leading-relaxed">
              By enabling autonomous trading, trades will be executed directly on your broker account
              without requiring your approval. You accept full responsibility for all trading outcomes.
              You can turn this off at any time from Settings.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 px-4 py-2 border border-border text-text-muted font-mono text-sm rounded-md hover:text-text-primary hover:border-text-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowConfirmModal(false)
                  await saveAutonomous(true)
                }}
                className="flex-1 px-4 py-2 bg-accent-amber text-background font-mono font-semibold text-sm rounded-md hover:bg-accent-amber/90 transition-colors"
              >
                I understand, enable autonomous
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6 max-w-2xl mx-auto">
        <div>
          <h1 className="font-mono text-lg font-semibold text-text-primary">Settings</h1>
          <p className="text-text-muted text-sm mt-1">Configure your trading agent</p>
        </div>

        {/* Section 1: Broker */}
        <SectionCard title="Broker">
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono">
                {settings.dhan_client_id && settings.dhan_access_token_set ? (
                  <span className="text-accent-green">Connected</span>
                ) : (
                  <span className="text-text-muted">Not connected</span>
                )}
              </span>
              {tokenHoursAgo !== null && settings.dhan_access_token_set && (
                <span className="text-xs text-text-muted font-mono">
                  · Token updated {tokenHoursAgo}h ago
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-mono text-text-muted mb-1.5 uppercase tracking-wider">
                Dhan Client ID
              </label>
              <input
                type="text"
                value={dhanClientId}
                onChange={(e) => setDhanClientId(e.target.value)}
                placeholder="Your client ID"
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent-green transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-text-muted mb-1.5 uppercase tracking-wider">
                Dhan Access Token
              </label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={dhanToken}
                  onChange={(e) => setDhanToken(e.target.value)}
                  placeholder={settings.dhan_access_token_set ? "••••••••  (set — enter new to update)" : "Paste access token"}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 pr-10 text-sm font-mono text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent-green transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                >
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="bg-background border border-border rounded-md p-4 space-y-4">
              <div>
                <p className="text-xs font-mono text-text-primary mb-1.5">Finding your Client ID</p>
                <ol className="text-xs text-text-muted space-y-1 list-none">
                  <li className="flex gap-2"><span className="text-accent-green font-mono">1.</span> Log in at web.dhan.co</li>
                  <li className="flex gap-2"><span className="text-accent-green font-mono">2.</span> Click your profile icon (top right) → My Profile</li>
                  <li className="flex gap-2"><span className="text-accent-green font-mono">3.</span> Your Client ID is displayed on the profile page</li>
                </ol>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-mono text-text-primary mb-1.5">Generating an Access Token</p>
                <ol className="text-xs text-text-muted space-y-1 list-none">
                  <li className="flex gap-2"><span className="text-accent-green font-mono">1.</span> From My Profile, go to the <span className="text-text-primary">DhanHQ Trading APIs</span> section</li>
                  <li className="flex gap-2"><span className="text-accent-green font-mono">2.</span> Click <span className="text-text-primary">Generate Access Token</span> — this creates a new token valid for 24 hours</li>
                  <li className="flex gap-2"><span className="text-accent-green font-mono">3.</span> Copy the token and paste it above. Make sure your token is active during market hours.</li>
                </ol>
              </div>
            </div>

            {brokerError && (
              <div className="text-accent-red text-xs font-mono bg-accent-red/10 border border-accent-red/20 rounded px-3 py-2">
                {brokerError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <SaveButton onClick={saveBroker} loading={brokerSaving} saved={brokerSaved} />
              {settings.dhan_client_id && settings.dhan_access_token_set && (
                <button
                  onClick={disconnectBroker}
                  disabled={brokerDisconnecting}
                  className="mt-4 px-4 py-2 border border-border text-text-muted font-mono text-sm rounded-md hover:text-accent-red hover:border-accent-red/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {brokerDisconnecting ? "Disconnecting..." : "Disconnect"}
                </button>
              )}
            </div>
          </div>
        </SectionCard>

        {/* Section 2: Risk Settings */}
        <SectionCard title="Risk Settings">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-text-muted mb-1.5 uppercase tracking-wider">
                Agent Capital (₹)
              </label>
              <input
                type="number"
                value={seedCapital}
                onChange={(e) => setSeedCapital(Number(e.target.value))}
                min={1000}
                step={1000}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:border-accent-green transition-colors"
              />
              <p className="text-xs text-text-muted font-mono mt-1.5 leading-relaxed">
                The amount of capital the agent is allowed to trade with. Position sizing, risk limits, and P&amp;L percentages are all calculated against this number.
              </p>
              <p className="text-xs text-text-muted font-mono mt-1 leading-relaxed">
                If your Dhan account balance is lower than this, the available balance takes precedence — the agent will never spend more than you actually have.
              </p>
            </div>

            <div>
              <label className="block text-xs font-mono text-text-muted mb-1.5 uppercase tracking-wider">
                Daily Loss Limit (₹)
              </label>
              <input
                type="number"
                value={dailyLossLimit}
                onChange={(e) => setDailyLossLimit(Math.abs(Number(e.target.value)))}
                min={100}
                step={100}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:border-accent-green transition-colors"
              />
              <p className="text-xs text-text-muted font-mono mt-1">
                Agent stops trading if day P&amp;L drops below -₹{dailyLossLimit.toLocaleString("en-IN")}
              </p>
            </div>

            <div>
              <label className="block text-xs font-mono text-text-muted mb-1.5 uppercase tracking-wider">
                Max Open Positions
              </label>
              <input
                type="number"
                value={maxPositions}
                onChange={(e) => setMaxPositions(Math.min(5, Math.max(1, Number(e.target.value))))}
                min={1}
                max={5}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:border-accent-green transition-colors"
              />
            </div>

            <div className="border-t border-border pt-4">
              <p className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Strategy Allocations</p>
              {settingsStrategies.length === 0 ? (
                <p className="text-xs text-text-muted font-mono">No strategies configured yet. Set one up via the Portfolio chat.</p>
              ) : (
                <div className="space-y-3">
                  {settingsStrategies.map((strategy) => (
                    <div key={strategy.id}>
                      <label className="block text-xs font-mono text-text-muted mb-1.5">
                        {strategy.name} (₹)
                      </label>
                      <input
                        type="number"
                        value={allocations[strategy.id] ?? 0}
                        onChange={(e) =>
                          setAllocations((prev) => ({ ...prev, [strategy.id]: Number(e.target.value) }))
                        }
                        min={0}
                        step={1000}
                        placeholder="0"
                        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent-green transition-colors"
                      />
                    </div>
                  ))}
                  {(() => {
                    const totalAllocated = Object.values(allocations).reduce((s, v) => s + (v || 0), 0)
                    const unallocated = seedCapital - totalAllocated
                    return (
                      <p className="text-xs text-text-muted font-mono">
                        ₹{totalAllocated.toLocaleString("en-IN")} allocated ·{" "}
                        <span className={unallocated < 0 ? "text-accent-red" : ""}>
                          ₹{Math.abs(unallocated).toLocaleString("en-IN")} {unallocated >= 0 ? "unallocated" : "over budget"}
                        </span>
                      </p>
                    )
                  })()}
                </div>
              )}
            </div>

            {riskError && (
              <div className="text-accent-red text-xs font-mono bg-accent-red/10 border border-accent-red/20 rounded px-3 py-2">
                {riskError}
              </div>
            )}

            <SaveButton onClick={saveRisk} loading={riskSaving} saved={riskSaved} />
          </div>
        </SectionCard>

        {/* Section 3: Autonomous Trading */}
        <SectionCard title="Autonomous Trading">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-primary font-mono">Autonomous trading</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {autonomous
                    ? "On — trades execute directly without approval"
                    : "Off — each proposal is sent to Telegram for your approval"}
                </p>
              </div>
              <button
                onClick={handleAutonomousToggle}
                disabled={autonomousSaving}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                  autonomous ? "bg-accent-green" : "bg-border"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    autonomous ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {autonomousError && (
              <div className="text-accent-red text-xs font-mono bg-accent-red/10 border border-accent-red/20 rounded px-3 py-2">
                {autonomousError}
              </div>
            )}
          </div>
        </SectionCard>

        {/* Section 4: Telegram */}
        <SectionCard title="Telegram">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {telegramConnected ? (
                <>
                  <span className="text-xs font-mono text-accent-green">Connected</span>
                  {telegramUsername && (
                    <span className="text-xs font-mono text-text-muted">as @{telegramUsername}</span>
                  )}
                </>
              ) : (
                <span className="text-xs font-mono text-text-muted">Not connected</span>
              )}
            </div>

            {telegramConnected ? (
              <button
                onClick={disconnectTelegram}
                className="px-4 py-2 border border-border text-text-muted font-mono text-sm rounded-md hover:text-accent-red hover:border-accent-red/50 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={connectTelegram}
                  disabled={telegramConnecting}
                  className="px-4 py-2 bg-accent-green text-background font-mono font-semibold text-sm rounded-md hover:bg-accent-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {telegramConnecting ? "Generating link..." : "Connect Telegram"}
                </button>

                {deepLink && (
                  <div className="flex items-start gap-5 p-4 bg-background border border-border rounded-lg">
                    <div className="p-2 bg-white rounded">
                      <QRCode value={deepLink} size={96} />
                    </div>
                    <div className="flex flex-col justify-between gap-3">
                      <p className="text-xs text-text-muted font-mono leading-relaxed">
                        Scan with your phone or tap the link to open in Telegram
                      </p>
                      <a
                        href={deepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-3 py-1.5 border border-accent-green/40 text-accent-green font-mono text-xs rounded-md hover:bg-accent-green/10 transition-colors w-fit"
                      >
                        Open in Telegram
                        <ExternalLink size={12} />
                      </a>
                      {deepLinkExpiry > 0 ? (
                        <p className="text-xs text-text-muted font-mono">
                          Expires in {minutesRemaining} min{minutesRemaining !== 1 ? "s" : ""}
                        </p>
                      ) : (
                        <p className="text-xs text-accent-amber font-mono">
                          Link expired — generate a new one.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {telegramError && (
              <div className="text-accent-red text-xs font-mono bg-accent-red/10 border border-accent-red/20 rounded px-3 py-2">
                {telegramError}
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </>
  )
}
