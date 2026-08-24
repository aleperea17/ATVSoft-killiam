'use client'

import dynamic from 'next/dynamic'
import { PageLoading } from '@/shared/components/page-loading'

const KeywordsMetricsPanel = dynamic(
  () =>
    import('@/features/keywords-metrics/components/keywords-metrics-panel').then((m) => ({
      default: m.KeywordsMetricsPanel,
    })),
  { loading: () => <PageLoading /> },
)

export default function MetricasKeywordsPage() {
  return <KeywordsMetricsPanel />
}
