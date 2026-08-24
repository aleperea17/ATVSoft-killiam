'use client'

import dynamic from 'next/dynamic'
import { PageLoading } from '@/shared/components/page-loading'

const TeamHistorialReportesPage = dynamic(() => import('./historial-reportes-view'), {
  loading: () => <PageLoading />,
})

export default function TeamHistorialReportesRoute() {
  return <TeamHistorialReportesPage />
}
