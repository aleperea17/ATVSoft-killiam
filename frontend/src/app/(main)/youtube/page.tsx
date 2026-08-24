'use client'

import dynamic from 'next/dynamic'
import { PageLoading } from '@/shared/components/page-loading'

const YouTubePage = dynamic(() => import('./youtube-view'), {
  loading: () => <PageLoading />,
})

export default function YouTubeRoute() {
  return <YouTubePage />
}
