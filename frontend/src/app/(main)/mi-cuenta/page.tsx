'use client'

import { FormEvent, useState } from 'react'
import { changePassword } from '@/features/auth/services/auth-service'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'

const LABEL =
  'mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]'
const INPUT =
  'w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text3)] focus:border-[var(--accent)]'
const CARD =
  'rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-6 shadow-[0_0_0_1px_rgba(200,70,80,0.12),0_0_28px_-8px_rgba(180,50,60,0.35)]'

function capitalizeFirstLetter(label: string): string {
  if (!label) return label
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export default function MiCuentaPage() {
  const { ready, userId, username } = useAuthUser()
  const { toast } = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const displayName = username?.trim() ? capitalizeFirstLetter(username) : 'Usuario'

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }
    if (newPassword.length < 6) {
      setError('La nueva contraseña debe tener al menos 6 caracteres.')
      return
    }
    setPending(true)
    const result = await changePassword(currentPassword, newPassword)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    toast('Contraseña actualizada.')
  }

  if (!ready) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Cargando sesión…</div>
  }

  if (!userId) {
    return (
      <div className="py-12 text-[13px] text-[var(--text3)]">
        Iniciá sesión para gestionar tu cuenta.
      </div>
    )
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold tracking-tight">Mi cuenta</h2>
      <p className="mt-1 text-[12px] text-[var(--text3)]">
        Gestioná la seguridad de tu sesión. Usuario actual:{' '}
        <span className="font-medium text-[var(--text2)]">{displayName}</span>
      </p>

      <div className={`mt-6 ${CARD}`}>
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]">
          Cambiar contraseña
        </h3>
        <p className="mt-1 mb-6 text-[12px] leading-relaxed text-[var(--text3)]">
          Ingresá tu contraseña actual y elegí una nueva. La próxima vez que inicies sesión vas a
          usar la nueva.
        </p>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="current-password" className={LABEL}>
              Contraseña actual
            </label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={INPUT}
              required
            />
          </div>
          <div>
            <label htmlFor="new-password" className={LABEL}>
              Nueva contraseña
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={INPUT}
              placeholder="Mínimo 6 caracteres"
              minLength={6}
              required
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className={LABEL}>
              Confirmar nueva contraseña
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={INPUT}
              minLength={6}
              required
            />
          </div>
          {error ? <p className="text-[12px] text-[var(--red)]">{error}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="auth-cta rounded-lg px-5 py-2.5 text-[12px] font-semibold uppercase tracking-wider disabled:opacity-50"
          >
            {pending ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </form>
      </div>
    </div>
  )
}
