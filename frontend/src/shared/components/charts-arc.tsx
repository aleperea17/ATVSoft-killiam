'use client'

import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut, Pie } from 'react-chartjs-2'
import { applyChartDefaults } from './chart-defaults'

ChartJS.register(ArcElement, Tooltip, Legend)
applyChartDefaults()

export { Doughnut, Pie }
