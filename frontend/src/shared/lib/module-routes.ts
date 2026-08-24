import type { CompanyModules } from '@/shared/components/app-providers'

export type ModuleOffInfo = {
  label: string
}

const PREFIXES: { prefix: string; key: keyof CompanyModules; label: string }[] = [
  { prefix: '/metrica-reels', key: 'moduleReels', label: 'Reels' },
  { prefix: '/reels', key: 'moduleReels', label: 'Reels' },
  { prefix: '/historias', key: 'moduleHistorias', label: 'Historias' },
  { prefix: '/youtube', key: 'moduleYoutube', label: 'YouTube' },
  { prefix: '/bio', key: 'moduleBio', label: 'BIO' },
  { prefix: '/metrica-keywords', key: 'moduleKeywords', label: 'Lead por reel' },
  { prefix: '/keywords', key: 'moduleKeywords', label: 'Lead por reel' },
  { prefix: '/dashboard', key: 'moduleMarketingDashboard', label: 'Dashboard marketing' },
]

export function moduleOffForPath(
  pathname: string,
  modules: CompanyModules,
  loaded: boolean,
): ModuleOffInfo | null {
  if (!loaded) return null
  const path = pathname || ''
  for (const row of PREFIXES) {
    if (path === row.prefix || path.startsWith(`${row.prefix}/`)) {
      if (!modules[row.key]) return { label: row.label }
      return null
    }
  }
  return null
}
