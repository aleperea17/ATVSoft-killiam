'use client'

import Image from 'next/image'
import atvLogo from '@/assets/atv-logo.png'
import { useCompanyConfig } from '@/shared/components/app-providers'

type BrandLogoProps = {
  className?: string
  alt?: string
  src?: string
}

/** Logo de la empresa (URL de CompanyConfig) o el PNG por defecto. */
export function BrandLogo({
  className = 'h-10 w-auto max-w-[56px] flex-shrink-0 object-contain',
  alt,
  src,
}: BrandLogoProps) {
  const cfg = useCompanyConfig()
  const logoUrl = (src ?? cfg.logoUrl ?? '').trim()
  const name = alt || cfg.companyName || 'ATV'

  if (logoUrl) {
    return (
      // URL arbitraria del cliente: <img> evita configurar remotePatterns de next/image.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt={name} className={className} />
    )
  }

  return (
    <Image
      src={atvLogo}
      alt={name}
      width={atvLogo.width}
      height={atvLogo.height}
      className={className}
      sizes="120px"
      priority
    />
  )
}
