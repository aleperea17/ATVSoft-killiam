'use client'

import dynamic from 'next/dynamic'
import { PageLoading } from '@/shared/components/page-loading'

const LeadsPage = dynamic(
  () => import('@/features/leads/components/leads-page').then((m) => ({ default: m.LeadsPage })),
  { loading: () => <PageLoading /> },
)

export default function LeadsRoute() {
  return <LeadsPage />
}
