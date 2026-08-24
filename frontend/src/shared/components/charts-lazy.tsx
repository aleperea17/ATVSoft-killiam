'use client'

import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'

function ChartSkeleton() {
  return <div className="min-h-[120px] w-full animate-pulse rounded-lg bg-white/[0.04]" aria-hidden />
}

export const Line = dynamic(() => import('./charts-line').then((m) => ({ default: m.Line })), {
  ssr: false,
  loading: ChartSkeleton,
})
export const Bar = dynamic(() => import('./charts-bar').then((m) => ({ default: m.Bar })), {
  ssr: false,
  loading: ChartSkeleton,
})
export const Doughnut = dynamic(() => import('./charts-arc').then((m) => ({ default: m.Doughnut })), {
  ssr: false,
  loading: ChartSkeleton,
})
export const Pie = dynamic(() => import('./charts-arc').then((m) => ({ default: m.Pie })), {
  ssr: false,
  loading: ChartSkeleton,
})

export type LineChartProps = ComponentProps<typeof Line>
export type BarChartProps = ComponentProps<typeof Bar>
export type DoughnutChartProps = ComponentProps<typeof Doughnut>
export type PieChartProps = ComponentProps<typeof Pie>
