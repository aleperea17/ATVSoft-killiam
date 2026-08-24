'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCompanyConfig } from '@/shared/components/app-providers'
import { moduleOffForPath } from '@/shared/lib/module-routes'

export function ModuleGate({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { modules, loaded } = useCompanyConfig()
  const off = moduleOffForPath(pathname, modules, loaded)

  if (!off) return <>{children}</>

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h2 className="text-lg font-semibold tracking-tight">Módulo apagado</h2>
      <p className="mt-2 text-[13px] text-[var(--text2)]">
        <span className="font-medium text-[var(--text)]">{off.label}</span> está desactivado para esta
        empresa. No está roto: activalo de nuevo cuando lo necesites.
      </p>
      <Link
        href="/ajustes/empresa"
        className="mt-6 inline-flex rounded-lg bg-[var(--auth-cta-bg)] px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--auth-cta-text)]"
      >
        Ir a Ajustes → Empresa
      </Link>
    </div>
  )
}
