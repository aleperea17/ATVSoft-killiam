'use client'

import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler } from 'chart.js'
import { Line } from 'react-chartjs-2'
import { applyChartDefaults } from './chart-defaults'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)
applyChartDefaults()
ChartJS.defaults.elements.line.borderCapStyle = 'round'
ChartJS.defaults.elements.line.borderJoinStyle = 'round'

export { Line }
