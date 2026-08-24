'use client'

import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { applyChartDefaults } from './chart-defaults'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)
applyChartDefaults()
ChartJS.defaults.elements.bar.borderRadius = 6

export { Bar }
