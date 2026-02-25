"use client"
import { createContext, useContext, useEffect, useState, useCallback } from "react"
import { onAuthStateChanged, signOut as fbSignOut, User } from "firebase/auth"
import { auth } from "./firebase"

interface AuthCtx {
  user: User | null
  loading: boolean
  idToken: string | null
  signOut: () => Promise<void>
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [idToken, setIdToken] = useState<string | null>(null)

  useEffect(() => {
    if (!auth) {
      setLoading(false)
      return
    }
    return onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (u) {
        const token = await u.getIdToken()
        setIdToken(token)
      } else {
        setIdToken(null)
      }
      setLoading(false)
    })
  }, [])

  const signOut = useCallback(async () => {
    if (auth) await fbSignOut(auth)
  }, [])

  const authFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    // Always call getIdToken() — Firebase serves cached token if valid, refreshes if expired
    const token = user ? await user.getIdToken() : null
    return fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }, [user])

  return <Ctx.Provider value={{ user, loading, idToken, signOut, authFetch }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
