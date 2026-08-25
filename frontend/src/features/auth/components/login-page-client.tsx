'use client'

import { getSetupStatus, login, type SetupStatus } from '@/features/auth/services/auth-service'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'

const LABEL_CLASS = 'mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]'
const INPUT_CLASS =
  'auth-input w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text3)]'
const CTA_CLASS =
  'auth-cta w-full rounded-lg px-4 py-3 text-sm font-semibold uppercase tracking-wider'

export function LoginPageClient() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [setup, setSetup] = useState<SetupStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void getSetupStatus().then((status) => {
      if (!cancelled) setSetup(status)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setPending(true)
    const formData = new FormData(event.currentTarget)
    const username = String(formData.get('username') || '')
    const password = String(formData.get('password') || '')
    const result = await login(username, password)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    router.replace('/sales-dashboard')
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {setup?.needs_setup ? (
        <div className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-center text-[13px] text-[var(--text2)]">
          Todavía no hay usuarios.{' '}
          <Link href="/signup" className="font-semibold text-[var(--accent)] hover:underline">
            Crear la primera cuenta
          </Link>
        </div>
      ) : null}

      <div>
        <label htmlFor="username" className={LABEL_CLASS}>
          Usuario
        </label>
        <input
          id="username"
          name="username"
          type="text"
          required
          autoComplete="username"
          className={INPUT_CLASS}
          placeholder="tu_usuario"
        />
      </div>

      <div>
        <label htmlFor="password" className={LABEL_CLASS}>
          Contrasena
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          minLength={6}
          className={INPUT_CLASS}
          placeholder="Minimo 6 caracteres"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-center text-sm font-medium text-red-500"
        >
          {error}
        </div>
      )}

      <button type="submit" disabled={pending} className={CTA_CLASS}>
        {pending ? 'Cargando…' : 'Iniciar sesion'}
      </button>
    </form>
  )
}
