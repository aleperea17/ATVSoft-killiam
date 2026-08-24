'use client'

import { useState, useEffect } from 'react'
import { resolveBackendUserId, resolveSessionUsername } from '@/lib/api'

const BACKEND_BASE =
  (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

function persistUserId(userId: number) {
  if (typeof window === 'undefined' || !Number.isFinite(userId)) return
  const id = String(userId)
  localStorage.setItem('auth_user_id', id)
  sessionStorage.setItem('auth_user_id', id)
  sessionStorage.setItem('user_id', id)
}

/** `user_id` entero del login FastAPI (string en el cliente), o null si no hay sesión. */
export function useAuthUser() {
  const [userId, setUserId] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    const sync = async () => {
      let uid = resolveBackendUserId()
      const uname = resolveSessionUsername()

      if (!uid && typeof window !== 'undefined') {
        const token =
          sessionStorage.getItem('access_token') ||
          sessionStorage.getItem('auth_token') ||
          sessionStorage.getItem('evoluciona_token') ||
          sessionStorage.getItem('token')
        if (token) {
          try {
            const res = await fetch(`${BACKEND_BASE}/auth/me`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (res.ok) {
              const data = (await res.json()) as { user_id?: number }
              if (typeof data.user_id === 'number' && Number.isFinite(data.user_id)) {
                persistUserId(data.user_id)
                uid = String(data.user_id)
              }
            }
          } catch {
            /* ignore */
          }
        }
      }

      if (cancelled) return
      setUserId(uid)
      setUsername(uname)
      setReady(true)
    }

    void sync()
    const onSessionChange = () => {
      void sync()
    }
    window.addEventListener('auth-session-changed', onSessionChange)
    window.addEventListener('storage', onSessionChange)
    return () => {
      cancelled = true
      window.removeEventListener('auth-session-changed', onSessionChange)
      window.removeEventListener('storage', onSessionChange)
    }
  }, [])

  return { userId, username, ready }
}
