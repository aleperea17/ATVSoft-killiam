'use client'

import dynamic from 'next/dynamic'
import { PageLoading } from '@/shared/components/page-loading'

const ReelsPage = dynamic(() => import('./reels-view'), {
  loading: () => <PageLoading />,
})

export default function ReelsRoute() {
  return <ReelsPage />
}
