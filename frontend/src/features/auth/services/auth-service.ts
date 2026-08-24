'use client'

import { z } from 'zod'

const loginSchema = z.object({
  username: z.string().min(1, 'Usuario requerido'),
  password: z.string().min(6, 'Minimo 6 caracteres'),
})

export type AuthResult = {
  error?: string
  ok?: boolean
  access_token?: string
  user_id?: number
}

const BACKEND_BASE =
  (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

type LoginResponseBody = {
  detail?: unknown
  access_token?: string
  user_id?: number
}

function formatAuthDetail(detail?: unknown): string {
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'msg' in item) return String((item as { msg: unknown }).msg)
        return ''
      })
      .filter(Boolean)
    if (parts.length) return parts.join('. ')
  }
  return ''
}

function formatLoginError(detail?: unknown): string {
  const text = formatAuthDetail(detail)
  if (!text) return 'No se pudo iniciar sesion'
  const normalized = text.toLowerCase().trim()
  if (normalized === 'invalid credentials' || normalized.includes('invalid credential')) {
    return 'Credenciales incorrectas'
  }
  return text
}

export type SetupStatus = {
  needs_setup: boolean
  extra_signup_allowed: boolean
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const response = await fetch(`${BACKEND_BASE}/auth/setup-status`)
  const data = (await response.json().catch(() => null)) as SetupStatus | null
  if (!response.ok || !data) {
    return { needs_setup: false, extra_signup_allowed: false }
  }
  return {
    needs_setup: Boolean(data.needs_setup),
    extra_signup_allowed: Boolean(data.extra_signup_allowed),
  }
}

export async function registerAccount(
  username: string,
  password: string,
  adminKey?: string,
): Promise<AuthResult> {
  const parsed = loginSchema.safeParse({ username, password })
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const response = await fetch(`${BACKEND_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: parsed.data.username,
      password: parsed.data.password,
      ...(adminKey?.trim() ? { admin_key: adminKey.trim() } : {}),
    }),
  })
  const data = (await response.json().catch(() => null)) as LoginResponseBody | null
  if (!response.ok) {
    return { error: formatAuthDetail(data?.detail) || 'No se pudo crear la cuenta' }
  }

  const token = data?.access_token
  if (!token) return { error: 'Respuesta invalida del servidor' }
  const uid = data?.user_id
  if (typeof uid !== 'number' || !Number.isFinite(uid)) {
    return { error: 'Respuesta invalida del servidor (falta user_id)' }
  }
  persistSession(token, uid)
  return { ok: true }
}

function persistSession(token: string, userIdFromServer?: number) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem('access_token', token)
  sessionStorage.setItem('auth_token', token)

  if (userIdFromServer != null && Number.isFinite(userIdFromServer)) {
    const id = String(userIdFromServer)
    localStorage.setItem('auth_user_id', id)
    sessionStorage.setItem('auth_user_id', id)
    sessionStorage.setItem('user_id', id)
  }

  window.dispatchEvent(new Event('auth-session-changed'))
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const parsed = loginSchema.safeParse({ username, password })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const response = await fetch(`${BACKEND_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
  })
  const data = (await response.json().catch(() => null)) as LoginResponseBody | null

  if (!response.ok) {
    return { error: formatLoginError(data?.detail) }
  }

  const token = data?.access_token
  if (!token) return { error: 'Respuesta invalida del servidor' }

  const uid = data?.user_id
  if (typeof uid !== 'number' || !Number.isFinite(uid)) {
    return { error: 'Respuesta invalida del servidor (falta user_id)' }
  }

  persistSession(token, uid)
  return { ok: true }
}

export async function logout() {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem('access_token')
  sessionStorage.removeItem('evoluciona_token')
  sessionStorage.removeItem('token')
  sessionStorage.removeItem('auth_token')
  sessionStorage.removeItem('user_id')
  sessionStorage.removeItem('evoluciona_user_id')
  sessionStorage.removeItem('auth_user_id')
  localStorage.removeItem('auth_user_id')
  window.dispatchEvent(new Event('auth-session-changed'))
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthResult> {
  if (!currentPassword.trim()) return { error: 'Contraseña actual requerida' }
  if (newPassword.length < 6) {
    return { error: 'La nueva contraseña debe tener al menos 6 caracteres' }
  }

  const token =
    (typeof window !== 'undefined' &&
      (sessionStorage.getItem('access_token') ||
        sessionStorage.getItem('evoluciona_token') ||
        sessionStorage.getItem('auth_token'))) ||
    ''

  const response = await fetch(`${BACKEND_BASE}/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  })
  const data = (await response.json().catch(() => null)) as LoginResponseBody | null
  if (!response.ok) {
    return { error: formatLoginError(data?.detail) }
  }
  if (data?.access_token && typeof data.user_id === 'number') {
    persistSession(data.access_token, data.user_id)
  }
  return { ok: true, access_token: data?.access_token, user_id: data?.user_id }
}
