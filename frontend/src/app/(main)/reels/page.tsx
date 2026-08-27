import nextDynamic from 'next/dynamic'
import { PageLoading } from '@/shared/components/page-loading'

export const dynamic = 'force-dynamic'

const ReelsPage = nextDynamic(() => import('./reels-view'), {
  loading: () => <PageLoading />,
})

export default function ReelsRoute() {
  return <ReelsPage />
}
