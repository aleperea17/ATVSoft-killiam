import { AppProviders } from '@/shared/components/app-providers'
import { AuthGuard } from '@/shared/components/auth-guard'
import { MainLayoutShell } from '@/shared/components/main-layout-shell'

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
