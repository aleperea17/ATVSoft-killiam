'use client'

import { getSetupStatus, registerAccount, type SetupStatus } from '@/features/auth/services/auth-service'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'

const LABEL_CLASS = 'mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]'
const INPUT_CLASS =
  'auth-input w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text3)]'
const CTA_CLASS =
  'auth-cta w-full rounded-lg px-4 py-3 text-sm font-semibold uppercase tracking-wider'

export function SignupPageClient() {
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

  const closed = Boolean(setup && !setup.needs_setup && !setup.extra_signup_allowed)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setPending(true)
    const formData = new FormData(event.currentTarget)
    const username = String(formData.get('username') || '')
    const password = String(formData.get('password') || '')
    const confirm = String(formData.get('confirm') || '')
    const adminKey = String(formData.get('admin_key') || '')
    if (password !== confirm) {
      setPending(false)
      setError('Las contraseñas no coinciden.')
      return
    }
    const result = await registerAccount(username, password, setup?.needs_setup ? undefined : adminKey)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    router.replace(setup?.needs_setup ? '/team/equipo' : '/sales-dashboard')
  }

  if (setup === null) {
    return <p className="text-center text-[13px] text-[var(--text3)]">Cargando…</p>
  }

  if (closed) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-[13px] text-[var(--text2)]">El registro de cuentas nuevas está cerrado.</p>
        <Link href="/login" className="text-[13px] font-semibold text-[var(--accent)] hover:underline">
          Ir a iniciar sesión
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {!setup.needs_setup ? (
        <p className="text-[12px] leading-relaxed text-[var(--text3)]">
          Para crear una cuenta extra necesitás la clave de administrador configurada en el servidor.
        </p>
      ) : (
        <p className="text-[12px] leading-relaxed text-[var(--text3)]">
          Esta es la primera cuenta. Después vas a cargar el equipo, los programas y los leads.
        </p>
      )}

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
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          minLength={6}
          className={INPUT_CLASS}
          placeholder="Mínimo 6 caracteres"
        />
      </div>

      <div>
        <label htmlFor="confirm" className={LABEL_CLASS}>
          Confirmar contraseña
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
          minLength={6}
          className={INPUT_CLASS}
          placeholder="Repetí la contraseña"
        />
      </div>

      {!setup.needs_setup ? (
        <div>
          <label htmlFor="admin_key" className={LABEL_CLASS}>
            Clave de administrador
          </label>
          <input
            id="admin_key"
            name="admin_key"
            type="password"
            required
            autoComplete="off"
            className={INPUT_CLASS}
            placeholder="REGISTER_ADMIN_KEY"
          />
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-center text-sm font-medium text-red-500"
        >
          {error}
        </div>
      ) : null}

      <button type="submit" disabled={pending} className={CTA_CLASS}>
        {pending ? 'Creando…' : setup.needs_setup ? 'Crear la primera cuenta' : 'Crear cuenta'}
      </button>

      <p className="text-center text-[12px] text-[var(--text3)]">
        <Link href="/login" className="text-[var(--accent)] hover:underline">
          Ya tengo cuenta
        </Link>
      </p>
    </form>
  )
}
