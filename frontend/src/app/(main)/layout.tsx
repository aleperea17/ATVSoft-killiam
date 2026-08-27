import { AppProviders } from '@/shared/components/app-providers'
import { AuthGuard } from '@/shared/components/auth-guard'
import { MainLayoutShell } from '@/shared/components/main-layout-shell'

/** Dashboard: no pre-renderizar ni cachear HTML un año (plays, cash, keywords cambian). */
export const dynamic = 'force-dynamic'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AppProviders>
      <AuthGuard>
        <MainLayoutShell>{children}</MainLayoutShell>
      </AuthGuard>
    </AppProviders>
  )
}
