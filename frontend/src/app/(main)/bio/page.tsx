'use client'

import dynamic from 'next/dynamic'
import { PageLoading } from '@/shared/components/page-loading'

const BioPage = dynamic(() => import('./bio-view'), {
  loading: () => <PageLoading />,
})

export default function BioRoute() {
  return <BioPage />
}
