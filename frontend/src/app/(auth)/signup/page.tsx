import { SignupPageClient } from '@/features/auth/components/signup-page-client'

export default function SignupPage() {
  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold tracking-tight text-[var(--text)]">Crear cuenta</h1>
      <SignupPageClient />
    </div>
  )
}
