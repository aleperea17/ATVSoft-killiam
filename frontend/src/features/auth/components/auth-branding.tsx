'use client'

import { useEffect, useState } from 'react'
import { BrandLogo } from '@/shared/components/brand-logo'
import { API_BASE } from '@/shared/lib/backend-public-url'

type PublicBrand = {
  companyName: string
  companyTagline: string
  logoUrl: string
}

export function AuthBranding() {
  const [brand, setBrand] = useState<PublicBrand>({
    companyName: 'ATV',
    companyTagline: '',
    logoUrl: '',
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/company-config/public`)
        const j = (await res.json().catch(() => ({}))) as {
          company_name?: string
          company_tagline?: string
          logo_url?: string
        }
        if (!res.ok || cancelled) return
        setBrand({
          companyName: String(j.company_name || 'ATV'),
          companyTagline: String(j.company_tagline || ''),
          logoUrl: String(j.logo_url || ''),
        })
      } catch {
        /* defaults */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mb-8 text-center">
      <BrandLogo
        alt={brand.companyName}
        src={brand.logoUrl}
        className="mx-auto h-24 w-auto max-w-[96px] object-contain"
      />
      {brand.companyTagline ? (
        <p className="mt-3 text-[12px] text-[var(--text3)]">{brand.companyTagline}</p>
      ) : null}
    </div>
  )
}
