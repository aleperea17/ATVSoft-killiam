import { LoginPageClient } from '@/features/auth/components/login-page-client'

export default function LoginPage() {
  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold tracking-tight text-[var(--text)]">Iniciar sesion</h1>
      <LoginPageClient />
    </div>
  )
}
