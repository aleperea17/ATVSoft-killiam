'use client'

import dynamic from 'next/dynamic'
import { PageLoading } from '@/shared/components/page-loading'

const ReelsMetricsPanel = dynamic(
  () =>
    import('@/features/reels-metrics/components/reels-metrics-panel').then((m) => ({
      default: m.ReelsMetricsPanel,
    })),
  { loading: () => <PageLoading /> },
)

export default function MetricasReelsPage() {
  return <ReelsMetricsPanel />
}
