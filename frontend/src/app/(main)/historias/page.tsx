'use client'

import dynamic from 'next/dynamic'
import { PageLoading } from '@/shared/components/page-loading'

const HistoriasPage = dynamic(() => import('./historias-view'), {
  loading: () => <PageLoading />,
})

export default function HistoriasRoute() {
  return <HistoriasPage />
}
